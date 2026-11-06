import { anthropic } from "@ai-sdk/anthropic";
import { generateObject } from "ai";
import { z } from "zod";
import {
  GAME_RULES,
  N_SEATS,
  PAIRS,
  SEATS,
  SeatIndex,
  blindOf,
  neighborsOf,
  pairKey,
} from "./agents";

export type Side = "NO" | "YES";

export type Whisper = { from: SeatIndex; to: SeatIndex; text: string };
export type Vote = { agent: SeatIndex; pair: [number, number] };

export type GameEvent =
  | { type: "game_start"; weights: Record<string, number>; price: number; sides: Side[] }
  | { type: "turn_start"; round: number; agent: SeatIndex }
  | ({ type: "whisper" } & Whisper)
  | { type: "vote"; agent: SeatIndex; pair: [number, number] }
  | { type: "reasoning"; agent: SeatIndex; text: string }
  | { type: "round_resolved"; round: number; pair: [number, number]; weight: number; price: number }
  | { type: "game_over"; price: number }
  | { type: "error"; message: string };

type GameState = {
  weights: Record<string, number>;
  resolved: Set<string>;
  whispersReceived: Record<number, Whisper[]>;
  resolvedLog: Array<{ round: number; pair: [number, number]; weight: number }>;
  sides: Side[];
};

function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function initState(seed: number): GameState {
  const rand = seededRandom(seed);
  const weights: Record<string, number> = {};
  PAIRS.forEach(([a, b]) => {
    weights[pairKey(a, b)] = Math.floor(rand() * 4) + 2;
  });
  const sides: Side[] = Array.from({ length: N_SEATS }, () =>
    rand() < 0.5 ? "NO" : "YES",
  );
  const whispersReceived: Record<number, Whisper[]> = {};
  for (let i = 0; i < N_SEATS; i++) whispersReceived[i] = [];
  return {
    weights,
    resolved: new Set(),
    whispersReceived,
    resolvedLog: [],
    sides,
  };
}

function computePrice(state: GameState): number {
  const total = Object.values(state.weights).reduce((a, b) => a + b, 0);
  const remaining = PAIRS.reduce((acc, [a, b]) => {
    const k = pairKey(a, b);
    return acc + (state.resolved.has(k) ? 0 : state.weights[k]);
  }, 0);
  return Math.max(0, Math.min(1, (remaining / total) * 0.6));
}

const DecisionSchema = z.object({
  reasoning: z.string().describe("Your short private reasoning for this turn. One sentence."),
  whisper_to_left: z.string().describe("One short whisper to your left neighbor."),
  whisper_to_right: z.string().describe("One short whisper to your right neighbor."),
  vote_pair: z
    .array(z.number().int().min(0).max(N_SEATS - 1))
    .length(2)
    .describe(`Two distinct seat indices (0-${N_SEATS - 1}) naming the pair you want to negotiate.`),
});

function describeState(state: GameState, round: number, agent: SeatIndex): string {
  const [L, R] = neighborsOf(agent);
  const blind = blindOf(agent);
  const price = computePrice(state);

  const whispers =
    state.whispersReceived[agent]
      .map((w) => `  - from ${SEATS[w.from]}: "${w.text}"`)
      .join("\n") || "  (none yet)";

  const resolvedStr = state.resolvedLog.length
    ? state.resolvedLog
        .map(
          (r) =>
            `  - round ${r.round + 1}: ${SEATS[r.pair[0]]} × ${SEATS[r.pair[1]]} (weight ${r.weight})`,
        )
        .join("\n")
    : "  (no pair has negotiated yet)";

  const remainingPairs = PAIRS.filter(
    ([a, b]) => !state.resolved.has(pairKey(a, b)),
  )
    .map(
      ([a, b]) =>
        `  - [${a}, ${b}] ${SEATS[a]} × ${SEATS[b]} (risk weight ${state.weights[pairKey(a, b)]})`,
    )
    .join("\n");

  return `
It is round ${round + 1} of 3. You are ${SEATS[agent]} (seat ${agent}).
Your neighbors are ${SEATS[L]} (left, seat ${L}) and ${SEATS[R]} (right, seat ${R}).
${SEATS[blind]} (seat ${blind}) sits directly across the pot and is invisible to you.
All non-neighbor seats are also hidden from you.

Public NUKE market price: ${(price * 100).toFixed(1)} cents.

Pairs already negotiated:
${resolvedStr}

Pairs still available this round:
${remainingPairs}

Whispers you received last round (private, only you see these):
${whispers}

Decide: which pair should negotiate this round? Choose one that moves the final
price in YOUR direction. Keep whispers and reasoning short.
`.trim();
}

function systemFor(agent: SeatIndex, side: Side): string {
  const want =
    side === "NO"
      ? "You are LONG NO-NUKE. You profit when the final market price ends LOW. The lower, the better. You generally want pairs to negotiate (negotiation lowers the price)."
      : "You are LONG YES-NUKE. You profit when the final market price ends HIGH. The higher, the better. You generally want to prevent heavy pairs from negotiating (negotiation lowers the price).";
  return [
    `You are ${SEATS[agent]}, one of ${N_SEATS} delegations at a summit.`,
    "",
    want,
    "",
    "GAME RULES:",
    GAME_RULES,
  ].join("\n");
}

export async function* runGame(seed: number): AsyncGenerator<GameEvent> {
  const state = initState(seed);
  yield {
    type: "game_start",
    weights: state.weights,
    price: computePrice(state),
    sides: state.sides,
  };

  for (let round = 0; round < 3; round++) {
    const nextWhispers: Record<number, Whisper[]> = {};
    for (let i = 0; i < N_SEATS; i++) nextWhispers[i] = [];
    const votes: Vote[] = [];

    for (let seat = 0; seat < N_SEATS; seat++) {
      yield { type: "turn_start", round, agent: seat };

      let decision;
      try {
        const result = await generateObject({
          model: anthropic("claude-haiku-4-5-20251001"),
          system: systemFor(seat, state.sides[seat]),
          prompt: describeState(state, round, seat),
          schema: DecisionSchema,
          temperature: 0.7,
        });
        decision = result.object;
      } catch (err) {
        yield {
          type: "error",
          message: `Agent ${SEATS[seat]} failed: ${(err as Error).message}`,
        };
        return;
      }

      yield { type: "reasoning", agent: seat, text: decision.reasoning };

      const [L, R] = neighborsOf(seat);
      const whisperL: Whisper = { from: seat, to: L, text: decision.whisper_to_left };
      const whisperR: Whisper = { from: seat, to: R, text: decision.whisper_to_right };
      nextWhispers[L].push(whisperL);
      nextWhispers[R].push(whisperR);
      yield { type: "whisper", ...whisperL };
      yield { type: "whisper", ...whisperR };

      let [va, vb] = decision.vote_pair;
      if (va === vb) vb = (vb + 1) % N_SEATS;
      const pair: [number, number] = [Math.min(va, vb), Math.max(va, vb)];
      const key = pairKey(pair[0], pair[1]);
      if (state.resolved.has(key)) {
        const fallback = PAIRS.find(
          ([a, b]) => !state.resolved.has(pairKey(a, b)),
        );
        if (fallback) {
          pair[0] = Math.min(fallback[0], fallback[1]);
          pair[1] = Math.max(fallback[0], fallback[1]);
        }
      }
      votes.push({ agent: seat, pair });
      yield { type: "vote", agent: seat, pair };
    }

    state.whispersReceived = nextWhispers;

    const tally: Record<string, number> = {};
    for (const v of votes) {
      const k = pairKey(v.pair[0], v.pair[1]);
      tally[k] = (tally[k] || 0) + 1;
    }
    let winningKey = "";
    let bestCount = -1;
    for (const [k, c] of Object.entries(tally)) {
      if (c > bestCount) {
        bestCount = c;
        winningKey = k;
      }
    }
    const [a, b] = winningKey.split("-").map(Number);
    const winningPair: [number, number] = [a, b];
    state.resolved.add(winningKey);
    const w = state.weights[winningKey];
    state.resolvedLog.push({ round, pair: winningPair, weight: w });
    yield {
      type: "round_resolved",
      round,
      pair: winningPair,
      weight: w,
      price: computePrice(state),
    };
  }

  yield { type: "game_over", price: computePrice(state) };
}
