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
  seat: SeatIndex | null;
  kind: "whisper" | "trade" | "vote" | "reasoning" | "resolve" | "system";
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
      <polygon points={points} fill="#000" stroke="#000" strokeWidth={1} />
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
          (active ? "bg-white rounded-full ring-2 ring-black" : "")
        }
      >
        <Polygon sides={sides} size={26} />
      </div>
      <div
        className="mt-1 text-[10px] text-black bg-white/90 px-1.5 py-0.5"
        style={{ fontFamily: "Arial, sans-serif" }}
      >
        {SEATS[seat]}
      </div>
    </div>
  );
}

export default function Home() {
  const [running, setRunning] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [price, setPrice] = useState(0.5);
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

  async function startSummit() {
    setRunning(true);
    setGameOver(false);
    setFeed([]);
    setPrice(0.5);
    setRound(0);
    setActiveSeat(null);
    feedIdRef.current = 0;

    try {
      const res = await fetch("/api/game", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seed: Math.floor(Math.random() * 1_000_000) }),
      });

      if (!res.ok || !res.body) {
        push({
          seat: null,
          kind: "system",
          text: `Request failed (${res.status}).`,
        });
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
            handleEvent(JSON.parse(line));
          } catch {}
        }
      }
    } catch (err) {
      push({
        seat: null,
        kind: "system",
        text: `Stream error: ${(err as Error).message}`,
      });
    } finally {
      setRunning(false);
    }
  }

  function handleEvent(ev: any) {
    switch (ev.type) {
      case "game_start":
        setPrice(ev.price);
        push({ seat: null, kind: "system", text: "Summit opens." });
        break;
      case "turn_start":
        setActiveSeat(ev.agent);
        setRound(ev.round);
        break;
      case "reasoning":
        push({
          seat: ev.agent,
          kind: "reasoning",
          text: `(${SEATS[ev.agent as SeatIndex]} thinks) ${ev.text}`,
        });
        break;
      case "whisper":
        push({
          seat: ev.from,
          kind: "whisper",
          text: `${SEATS[ev.from as SeatIndex]} → ${SEATS[ev.to as SeatIndex]}: "${ev.text}"`,
        });
        break;
      case "vote":
        push({
          seat: ev.agent,
          kind: "vote",
          text: `${SEATS[ev.agent as SeatIndex]} votes: ${SEATS[ev.pair[0] as SeatIndex]} × ${SEATS[ev.pair[1] as SeatIndex]}`,
        });
        break;
      case "round_resolved":
        setPrice(ev.price);
        setActiveSeat(null);
        push({
          seat: null,
          kind: "resolve",
          text: `— Round ${ev.round + 1} closed. ${SEATS[ev.pair[0] as SeatIndex]} × ${SEATS[ev.pair[1] as SeatIndex]} negotiated (weight ${ev.weight}). Market: ${(ev.price * 100).toFixed(1)}¢`,
        });
        break;
      case "game_over":
        setPrice(ev.price);
        setGameOver(true);
        setActiveSeat(null);
        push({
          seat: null,
          kind: "system",
          text: `Summit adjourns. Final: ${(ev.price * 100).toFixed(1)}¢`,
        });
        break;
      case "error":
        push({ seat: null, kind: "system", text: `Error: ${ev.message}` });
        break;
    }
  }

  return (
    <div
      className="fixed inset-0 overflow-hidden"
      style={{ fontFamily: "Arial, sans-serif" }}
    >
      <img
        src="/background.jpeg"
        alt=""
        className="absolute inset-0 w-full h-full object-cover"
      />

      {/* Shapes on chairs */}
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

      {/* Single info/transcript window (draggable by its header) */}
      <div
        ref={windowRef}
        className="absolute w-[360px] max-w-[calc(100vw-2rem)] bg-black text-white border border-white/20 shadow-xl select-none"
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
          <div>Round {Math.min(round + 1, 3)} / 3</div>
          <div className="tabular-nums">
            Market {(price * 100).toFixed(1)}¢
          </div>
        </div>
        <div className="h-[280px] overflow-auto px-3 py-2 text-[12px] leading-5">
          {feed.length === 0 ? (
            <div className="text-neutral-400">
              Press start to open the summit.
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
                        : "text-white")
                }
              >
                {f.text}
              </div>
            ))
          )}
          <div ref={feedEndRef} />
        </div>
        <div className="px-3 py-2 border-t border-white/15">
          <button
            onClick={startSummit}
            disabled={running}
            className="w-full border border-white/40 hover:bg-white hover:text-black transition px-3 py-1.5 text-xs disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {running
              ? "Summit in session…"
              : gameOver
                ? "New summit"
                : "Start summit"}
          </button>
        </div>
      </div>
    </div>
  );
}
