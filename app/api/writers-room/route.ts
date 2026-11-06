import { runWritersRoom } from "@/app/lib/writers-engine";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const seedRaw =
    typeof body.seed === "string" && body.seed.trim().length > 0
      ? body.seed.trim()
      : "lantern";
  const seed = seedRaw.split(/\s+/)[0].slice(0, 32);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of runWritersRoom(seed)) {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        }
      } catch (err) {
        controller.enqueue(
          encoder.encode(
            JSON.stringify({
              type: "error",
              message: (err as Error).message,
            }) + "\n",
          ),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
