"use client";

import { useEffect, useRef, useState } from "react";

type SeatIndex = number;
const SEATS = [
  "Triangle",
  "Square",
  "Pentagon",
  "Hexagon",
  "Heptagon",
  "Octagon",
] as const;
const SKILL_NAMES = [
  "Imagist",
  "Metaphorist",
  "Juxtaposer",
  "Rhythm-keeper",
  "Compressor",
  "Polisher",
] as const;
const SIDES = [3, 4, 5, 6, 7, 8] as const;

const SEAT_XY: Array<{ x: number; y: number }> = [
  { x: 54.2, y: 71.7 },
  { x: 93.1, y: 91.2 },
  { x: 26.3, y: 54.4 },
  { x: 27.1, y: 69.9 },
  { x: 2.8, y: 57.2 },
  { x: 6.5, y: 75.1 },
];

type FeedItem = {
  id: number;
  kind:
    | "whisper"
    | "vote"
    | "reasoning"
    | "producer"
    | "consumer"
    | "resolve"
    | "system";
  text: string;
};

function Polygon({ sides, size }: { sides: number; size: number }) {
  const r = size / 2;
  const points = Array.from({ length: sides }, (_, i) => {
    const a = (Math.PI * 2 * i) / sides - Math.PI / 2;
    return `${r + r * Math.cos(a)},${r + r * Math.sin(a)}`;
  }).join(" ");
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <polygon points={points} fill="#fff" stroke="#fff" strokeWidth={1} />
    </svg>
  );
}

function AgentShape({ seat, active }: { seat: SeatIndex; active: boolean }) {
  const sides = SIDES[seat];
  return (
    <div className="flex flex-col items-center">
      <div
        className={
          "p-1 transition " +
          (active ? "bg-black rounded-full ring-2 ring-white" : "")
        }
      >
        <Polygon sides={sides} size={26} />
      </div>
      <div
        className="mt-1 text-[10px] text-white"
        style={{ fontFamily: "Arial, sans-serif" }}
      >
        {SEATS[seat]} · {SKILL_NAMES[seat]}
      </div>
    </div>
  );
}

export default function WritersRoom() {
  const [seed, setSeed] = useState("lantern");
  const [running, setRunning] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [artifact, setArtifact] = useState("");
  const [round, setRound] = useState(0);
  const [activeSeat, setActiveSeat] = useState<SeatIndex | null>(null);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const feedIdRef = useRef(0);
  const feedEndRef = useRef<HTMLDivElement>(null);
  const windowRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ offsetX: number; offsetY: number } | null>(null);
  const [winPos, setWinPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [feed]);

  function onHeaderPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const el = windowRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    dragStartRef.current = {
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
    };
    const onMove = (ev: PointerEvent) => {
      if (!dragStartRef.current) return;
      const { offsetX, offsetY } = dragStartRef.current;
      const width = el.offsetWidth;
      const height = el.offsetHeight;
      const maxX = window.innerWidth - width;
      const maxY = window.innerHeight - height;
      setWinPos({
        x: Math.min(Math.max(0, ev.clientX - offsetX), maxX),
        y: Math.min(Math.max(0, ev.clientY - offsetY), maxY),
      });
    };
    const onUp = () => {
      dragStartRef.current = null;
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    e.preventDefault();
  }

  function push(item: Omit<FeedItem, "id">) {
    feedIdRef.current += 1;
    const id = feedIdRef.current;
    setFeed((f) => [...f, { id, ...item }]);
  }

  async function start() {
    setRunning(true);
    setGameOver(false);
    setFeed([]);
    setArtifact(seed.trim() || "lantern");
    setRound(0);
    setActiveSeat(null);
    feedIdRef.current = 0;

    try {
      const res = await fetch("/api/writers-room", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seed: seed.trim() || "lantern" }),
      });
      if (!res.ok || !res.body) {
        push({ kind: "system", text: `Request failed (${res.status}).` });
        setRunning(false);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            handle(JSON.parse(line));
          } catch {}
        }
      }
    } catch (err) {
      push({ kind: "system", text: `Stream error: ${(err as Error).message}` });
    } finally {
      setRunning(false);
    }
  }

  function handle(ev: any) {
    switch (ev.type) {
      case "game_start":
        setArtifact(ev.artifact);
        push({ kind: "system", text: `Seed: "${ev.seed}". Writers' room opens.` });
        break;
      case "turn_start":
        setActiveSeat(ev.agent);
        setRound(ev.round);
        break;
      case "reasoning":
        push({
          kind: "reasoning",
          text: `(${SEATS[ev.agent as number]} thinks) ${ev.text}`,
        });
        break;
      case "whisper":
        push({
          kind: "whisper",
          text: `${SEATS[ev.from as number]} → ${SEATS[ev.to as number]}: "${ev.text}"`,
        });
        break;
      case "vote":
        push({
          kind: "vote",
          text: `${SEATS[ev.agent as number]} votes: ${SEATS[ev.pair[0] as number]} → ${SEATS[ev.pair[1] as number]}`,
        });
        break;
      case "producer_start":
        setActiveSeat(ev.agent);
        push({
          kind: "producer",
          text: `${SEATS[ev.agent as number]} (${SKILL_NAMES[ev.agent as number]}) takes the artifact…`,
        });
        break;
      case "producer_output":
        setArtifact(ev.artifact);
        push({
          kind: "producer",
          text: `↳ ${SEATS[ev.agent as number]}: ${ev.note}`,
        });
        break;
      case "consumer_start":
        setActiveSeat(ev.agent);
        push({
          kind: "consumer",
          text: `${SEATS[ev.agent as number]} (${SKILL_NAMES[ev.agent as number]}) takes it next…`,
        });
        break;
      case "consumer_output":
        setArtifact(ev.artifact);
        push({
          kind: "consumer",
          text: `↳ ${SEATS[ev.agent as number]}: ${ev.note}`,
        });
        break;
      case "round_resolved":
        setActiveSeat(null);
        push({
          kind: "resolve",
          text: `— Round ${ev.round + 1} closed. ${SEATS[ev.pair[0] as number]} → ${SEATS[ev.pair[1] as number]}`,
        });
        break;
      case "game_over":
        setGameOver(true);
        setActiveSeat(null);
        setArtifact(ev.artifact);
        push({ kind: "system", text: `Final poem above.` });
        break;
      case "error":
        push({ kind: "system", text: `Error: ${ev.message}` });
        break;
    }
  }

  return (
    <div
      className="fixed inset-0 overflow-hidden bg-black"
      style={{ fontFamily: "Arial, sans-serif" }}
    >
      {SEATS.map((_, i) => {
        const pos = SEAT_XY[i];
        const seat = i as SeatIndex;
        return (
          <div
            key={i}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
          >
            <AgentShape seat={seat} active={activeSeat === seat} />
          </div>
        );
      })}

      <div
        ref={windowRef}
        className="absolute w-[420px] max-w-[calc(100vw-2rem)] bg-black text-white border border-white/20 shadow-xl select-none"
        style={
          winPos
            ? { left: `${winPos.x}px`, top: `${winPos.y}px`, right: "auto", bottom: "auto" }
            : { left: "1rem", top: "1rem" }
        }
      >
        <div
          onPointerDown={onHeaderPointerDown}
          className="flex items-center justify-between px-3 py-2 border-b border-white/15 text-xs cursor-move"
        >
          <div>Writers&apos; room · round {Math.min(round + 1, 3)} / 3</div>
          <div className="text-neutral-400">drag to move</div>
        </div>

        <div className="px-3 py-3 border-b border-white/15 bg-white/[0.04]">
          <div className="text-[10px] text-neutral-400 mb-1">Artifact</div>
          <div className="whitespace-pre-wrap text-[14px] leading-6 min-h-[48px]">
            {artifact || <span className="text-neutral-500">(none)</span>}
          </div>
        </div>

        <div className="h-[220px] overflow-auto px-3 py-2 text-[12px] leading-5">
          {feed.length === 0 ? (
            <div className="text-neutral-400">
              Type a seed word and press start.
            </div>
          ) : (
            feed.map((f) => (
              <div
                key={f.id}
                className={
                  "mb-1 " +
                  (f.kind === "resolve"
                    ? "text-white font-semibold"
                    : f.kind === "reasoning"
                      ? "text-neutral-400 italic"
                      : f.kind === "system"
                        ? "text-neutral-300"
                        : f.kind === "producer" || f.kind === "consumer"
                          ? "text-white"
                          : "text-white")
                }
              >
                {f.text}
              </div>
            ))
          )}
          <div ref={feedEndRef} />
        </div>

        <div className="px-3 py-2 border-t border-white/15 flex items-center gap-2">
          <input
            type="text"
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
            disabled={running}
            placeholder="seed word"
            className="flex-1 bg-transparent border border-white/30 px-2 py-1 text-xs placeholder-neutral-500 focus:outline-none focus:border-white/60"
          />
          <button
            onClick={start}
            disabled={running}
            className="border border-white/40 hover:bg-white hover:text-black transition px-3 py-1.5 text-xs disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {running ? "Writing…" : gameOver ? "New poem" : "Start"}
          </button>
        </div>
      </div>
    </div>
  );
}
