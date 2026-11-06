import { anthropic } from "@ai-sdk/anthropic";
import { generateObject } from "ai";
import { z } from "zod";
import { N_SEATS, SEATS, SeatIndex, neighborsOf, blindOf } from "./agents";
import { SKILLS, WRITERS_RULES, skillsTable, skillBrief } from "./writers";

export type Whisper = { from: SeatIndex; to: SeatIndex; text: string };
export type Vote = { agent: SeatIndex; pair: [number, number] };

export type WritersEvent =
  | { type: "game_start"; seed: string; artifact: string }
  | { type: "turn_start"; round: number; agent: SeatIndex }
  | { type: "reasoning"; agent: SeatIndex; text: string }
  | ({ type: "whisper" } & Whisper)
  | { type: "vote"; agent: SeatIndex; pair: [number, number] }
  | { type: "producer_start"; round: number; agent: SeatIndex }
  | { type: "producer_output"; round: number; agent: SeatIndex; artifact: string; note: string }
  | { type: "consumer_start"; round: number; agent: SeatIndex }
  | { type: "consumer_output"; round: number; agent: SeatIndex; artifact: string; note: string }
  | { type: "round_resolved"; round: number; pair: [number, number]; artifact: string }
  | { type: "game_over"; artifact: string }
  | { type: "error"; message: string };

type GameState = {
  artifact: string;
  whispersReceived: Record<number, Whisper[]>;
  usedPairs: Set<string>;
  history: Array<{ round: number; pair: [number, number]; artifact: string }>;
};

function orderedKey(a: number, b: number) {
  return `${a}->${b}`;
}

function initState(seed: string): GameState {
  const whispersReceived: Record<number, Whisper[]> = {};
  for (let i = 0; i < N_SEATS; i++) whispersReceived[i] = [];
  return {
    artifact: seed.trim(),
    whispersReceived,
    usedPairs: new Set(),
    history: [],
  };
}

const VoteSchema = z.object({
  reasoning: z.string().describe("One short sentence of private reasoning."),
  whisper_to_left: z.string().describe("Short whisper to your left neighbor."),
  whisper_to_right: z.string().describe("Short whisper to your right neighbor."),
  pair: z
    .array(z.number().int().min(0).max(N_SEATS - 1))
    .length(2)
    .describe(
      `Ordered pair [A, B] of distinct seat indices (0-${N_SEATS - 1}). A acts first, then B.`,
    ),
});

const TransformSchema = z.object({
  note: z.string().describe("One short line of private intent for this edit."),
  artifact: z
    .string()
    .describe("The transformed text. Return the full new artifact, not just the diff."),
});

function describeStateForVote(state: GameState, round: number, agent: SeatIndex): string {
  const [L, R] = neighborsOf(agent);
  const blind = blindOf(agent);
  const whispers =
    state.whispersReceived[agent]
      .map((w) => `  - from ${SEATS[w.from]}: "${w.text}"`)
      .join("\n") || "  (none yet)";

  const history = state.history.length
    ? state.history
        .map(
          (h) =>
            `  - round ${h.round + 1}: ${SEATS[h.pair[0]]} → ${SEATS[h.pair[1]]}`,
        )
        .join("\n")
    : "  (none yet)";

  return `
It is round ${round + 1} of 3. You are ${SEATS[agent]} (seat ${agent}).
Your skill: ${skillBrief(agent).name} — ${skillBrief(agent).description}

Your neighbors are ${SEATS[L]} (seat ${L}) and ${SEATS[R]} (seat ${R}).
${SEATS[blind]} (seat ${blind}) sits directly across the pot and is invisible to you.
You also cannot see any non-neighbor.

ALL SKILLS AT THE TABLE:
${skillsTable()}

CURRENT ARTIFACT:
>>>
${state.artifact}
>>>

Pair history (which ordered pair collaborated each past round):
${history}

Whispers you received last round:
${whispers}

Decide: which ordered pair (A, B) should collaborate THIS round so the artifact
moves toward a good poem? A acts first, then B takes A's output. Keep whispers short.
Reply with the schema.
`.trim();
}

function describeForProducer(state: GameState, agent: SeatIndex, partner: SeatIndex): string {
  const skill = skillBrief(agent);
  const partnerSkill = skillBrief(partner);
  return `
You are ${SEATS[agent]}. You are the FIRST writer in a pair this round.
Your skill: ${skill.name} — ${skill.description}

The group voted for the ordered pair: ${SEATS[agent]} → ${SEATS[partner]}.
After you transform the artifact, ${SEATS[partner]} (${partnerSkill.name}) will
take your output and apply their own skill. Do your job well so ${partnerSkill.name}
has good material to work with.

CURRENT ARTIFACT:
>>>
${state.artifact}
>>>

Apply ONLY your skill. Return the complete transformed artifact.
`.trim();
}

function describeForConsumer(
  prevArtifact: string,
  producedArtifact: string,
  agent: SeatIndex,
  producer: SeatIndex,
): string {
  const skill = skillBrief(agent);
  const producerSkill = skillBrief(producer);
  return `
You are ${SEATS[agent]}. You are the SECOND writer in a pair this round.
Your skill: ${skill.name} — ${skill.description}

${SEATS[producer]} (${producerSkill.name}) just transformed the artifact. Here's
what they started with and what they produced:

BEFORE (${producerSkill.name} received):
>>>
${prevArtifact}
>>>

AFTER (${producerSkill.name}'s output, your input):
>>>
${producedArtifact}
>>>

Apply ONLY your skill to the AFTER text. Return the complete transformed artifact.
`.trim();
}

function tallyOrdered(votes: Vote[]): [number, number] {
  const counts: Record<string, number> = {};
  const parsed: Record<string, [number, number]> = {};
  for (const v of votes) {
    const k = orderedKey(v.pair[0], v.pair[1]);
    counts[k] = (counts[k] || 0) + 1;
    parsed[k] = [v.pair[0], v.pair[1]];
  }
  let winner: [number, number] = votes[0].pair;
  let best = -1;
  for (const [k, c] of Object.entries(counts)) {
    if (c > best) {
      best = c;
      winner = parsed[k];
    }
  }
  return winner;
}

export async function* runWritersRoom(seed: string): AsyncGenerator<WritersEvent> {
  const state = initState(seed);
  yield { type: "game_start", seed: state.artifact, artifact: state.artifact };

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
          system: [
            `You are ${SEATS[seat]}, a writer in a six-writer ensemble.`,
            `Your skill: ${skillBrief(seat).name} — ${skillBrief(seat).description}`,
            "",
            WRITERS_RULES,
          ].join("\n"),
          prompt: describeStateForVote(state, round, seat),
          schema: VoteSchema,
          temperature: 0.7,
        });
        decision = result.object;
      } catch (err) {
        yield {
          type: "error",
          message: `Vote failed for ${SEATS[seat]}: ${(err as Error).message}`,
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

      let [a, b] = decision.pair;
      if (a === b) b = (b + 1) % N_SEATS;
      votes.push({ agent: seat, pair: [a, b] });
      yield { type: "vote", agent: seat, pair: [a, b] };
    }

    state.whispersReceived = nextWhispers;

    let winner = tallyOrdered(votes);
    if (state.usedPairs.has(orderedKey(winner[0], winner[1]))) {
      const seen = new Set<string>();
      const candidates = votes
        .map((v) => v.pair as [number, number])
        .filter((p) => {
          const k = orderedKey(p[0], p[1]);
          if (state.usedPairs.has(k) || seen.has(k)) return false;
          seen.add(k);
          return true;
        });
      if (candidates.length > 0) winner = candidates[0];
    }
    state.usedPairs.add(orderedKey(winner[0], winner[1]));

    const [producer, consumer] = winner;
    const prevArtifact = state.artifact;

    yield { type: "producer_start", round, agent: producer };
    let producerOutput: { note: string; artifact: string };
    try {
      const result = await generateObject({
        model: anthropic("claude-haiku-4-5-20251001"),
        system: `You are ${SEATS[producer]}, applying your single writing skill as the first half of a chained collaboration.`,
        prompt: describeForProducer(state, producer, consumer),
        schema: TransformSchema,
        temperature: 0.8,
      });
      producerOutput = result.object;
    } catch (err) {
      yield { type: "error", message: `Producer ${SEATS[producer]} failed: ${(err as Error).message}` };
      return;
    }
    yield {
      type: "producer_output",
      round,
      agent: producer,
      artifact: producerOutput.artifact,
      note: producerOutput.note,
    };

    yield { type: "consumer_start", round, agent: consumer };
    let consumerOutput: { note: string; artifact: string };
    try {
      const result = await generateObject({
        model: anthropic("claude-haiku-4-5-20251001"),
        system: `You are ${SEATS[consumer]}, applying your single writing skill as the second half of a chained collaboration.`,
        prompt: describeForConsumer(prevArtifact, producerOutput.artifact, consumer, producer),
        schema: TransformSchema,
        temperature: 0.8,
      });
      consumerOutput = result.object;
    } catch (err) {
      yield { type: "error", message: `Consumer ${SEATS[consumer]} failed: ${(err as Error).message}` };
      return;
    }
    yield {
      type: "consumer_output",
      round,
      agent: consumer,
      artifact: consumerOutput.artifact,
      note: consumerOutput.note,
    };

    state.artifact = consumerOutput.artifact;
    state.history.push({ round, pair: winner, artifact: state.artifact });
    yield {
      type: "round_resolved",
      round,
      pair: winner,
      artifact: state.artifact,
    };
  }

  yield { type: "game_over", artifact: state.artifact };
}
