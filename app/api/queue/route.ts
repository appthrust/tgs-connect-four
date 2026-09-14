import type { NextRequest } from "next/server";
import { enqueue, queueStatus } from "@/lib/matches";
import { BackendError } from "@/lib/appthrust";
import { failure, json, jsonBody, playerId, sameOrigin } from "@/lib/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try { const result = await queueStatus(playerId(request)); return json(result, result.status === "error" ? 409 : 200); }
  catch (error) { return failure(error); }
}
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const body = await jsonBody(request, ["name"]);
    if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 24) throw new BackendError("bad_name", 400);
    const result = await enqueue(playerId(request), body.name.trim());
    return json(result, result.status === "error" ? 409 : 200);
  } catch (error) { return failure(error); }
}
