import type { NextRequest } from "next/server";
import { matchTurn } from "@/lib/matches";
import { failure, json, playerId } from "@/lib/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const result = await matchTurn(id, playerId(request), "state");
    return json(result, result.ok ? 200 : 409);
  } catch (error) { return failure(error); }
}
