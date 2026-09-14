import type { NextRequest } from "next/server";
import { matchTurn } from "@/lib/matches";
import { failure, json, playerId, sameOrigin } from "@/lib/http";
export const runtime = "nodejs";
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    sameOrigin(request);
    const { id } = await context.params;
    const result = await matchTurn(id, playerId(request), "reset");
    return json(result, result.ok ? 200 : 409);
  } catch (error) { return failure(error); }
}
