import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { BackendError } from "./appthrust";

export function playerId(request: NextRequest): string {
  const player = request.cookies.get("c4pid")?.value;
  if (!player) throw new BackendError("player_cookie_required", 401);
  return player;
}
export function sameOrigin(request: NextRequest): void {
  const origin = request.headers.get("origin");
  if (request.headers.get("sec-fetch-site") === "cross-site") throw new BackendError("cross_origin_request", 403);
  if (!origin) return; // Non-browser clients (including curl) do not send Origin.
  // Next's internal URL may use localhost behind a reverse proxy. Host is the public request authority.
  const parsed = URL.canParse(origin) ? new URL(origin) : null;
  if (!parsed || !["http:", "https:"].includes(parsed.protocol) || parsed.host !== request.headers.get("host")) throw new BackendError("cross_origin_request", 403);
}
export async function jsonBody(request: NextRequest, keys: string[]): Promise<Record<string, unknown>> {
  // Bound the actual stream, not just a caller-controlled Content-Length header.
  const reader = request.body?.getReader();
  if (!reader) throw new BackendError("bad_request", 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 1024) { await reader.cancel(); throw new BackendError("bad_request", 400); }
    chunks.push(value);
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString());
    if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).some((key) => !keys.includes(key))) throw new Error();
    return data;
  } catch { throw new BackendError("bad_request", 400); }
}
export function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}
export function failure(error: unknown): NextResponse {
  return json({ ok: false, error: error instanceof BackendError ? error.code : "backend_unavailable", state: null, activation: null }, error instanceof BackendError ? error.status : 503);
}
