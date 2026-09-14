import type { NextRequest } from "next/server";
import { wall } from "@/lib/matches";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Server-sent events for the booth TV. The store is shared by every replica,
// so each stream simply re-reads it and pushes a snapshot whenever it changes.
// A named ping event lets the client tell "quiet" from "disconnected".
const REFRESH_MS = 500;
const HEARTBEAT_MS = 5_000;

export function GET(request: NextRequest) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let last = "";
      let heartbeatAt = Date.now();
      const send = (chunk: string) => controller.enqueue(encoder.encode(chunk));
      while (!request.signal.aborted) {
        try {
          const payload = JSON.stringify(await wall());
          if (payload !== last) {
            last = payload;
            send(`event: wall\ndata: ${payload}\n\n`);
            heartbeatAt = Date.now();
          } else if (Date.now() - heartbeatAt >= HEARTBEAT_MS) {
            send("event: ping\ndata: {}\n\n");
            heartbeatAt = Date.now();
          }
        } catch {
          // The client keeps its last snapshot and EventSource reconnects if we close.
          controller.close();
          return;
        }
        const { promise, resolve } = Promise.withResolvers<void>();
        const timer = setTimeout(resolve, REFRESH_MS);
        request.signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
        await promise;
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" },
  });
}
