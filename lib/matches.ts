import "server-only";
import { after } from "next/server";
import { BackendError, createActor, invokeActor } from "./appthrust";
import { mockActor } from "./mock-actor";
import { getStore } from "./store";
import type { Match, Pair, Store } from "./store";
import type { ActorResult, Cell, GameMethod, MatchSnapshot, QueueSnapshot, WallSnapshot } from "./game";

export function backend(): "mock" | "platform-api" {
  const value = process.env.ACTOR_BACKEND || "platform-api";
  if (value !== "mock" && value !== "platform-api") throw new BackendError("backend_not_configured", 503);
  if (value === "mock" && process.env.NODE_ENV === "production") throw new BackendError("mock_backend_disabled_in_production", 503);
  return value;
}
async function actor(id: string, method: GameMethod, body: object, create = false): Promise<ActorResult> {
  if (backend() === "mock") return mockActor(id, method, body);
  return create ? createActor(id, method, body) : invokeActor(id, method, body);
}

async function spawn(store: Store, { id, first, second }: Pair): Promise<void> {
  try {
    const created = await actor(id, "join", { player: first.player, name: first.name }, true);
    await store.createMatch({ id, createdAt: Date.now(), result: created, creation: created.activation, lastTurnMs: null });
    if (!created.reply.ok) throw new BackendError(created.reply.error || "actor_request_failed", 409);
    const joined = await store.withMatch(id, async (match) => {
      match.result = await actor(id, "join", { player: second.player, name: second.name });
      return match.result;
    });
    if (!joined.reply.ok) throw new BackendError(joined.reply.error || "actor_request_failed", 409);
    await store.finishPair(id);
  } catch (error) {
    await store.finishPair(id, error instanceof BackendError ? error.code : "actor_unavailable");
  }
}

export async function queueStatus(player: string): Promise<QueueSnapshot> {
  const { entry, match } = await getStore().queue(player);
  if (!entry) return { status: "idle", elapsedMs: 0, state: null, activation: null };
  return { status: entry.status, elapsedMs: Date.now() - entry.startedAt, matchId: entry.matchId, seat: entry.seat, error: entry.error, state: match?.result.reply.state ?? null, activation: match?.creation ?? null };
}

export async function enqueue(player: string, name: string): Promise<QueueSnapshot> {
  backend();
  const store = getStore();
  const pair = await store.reserve(player, name);
  // Keep the non-blocking spawn attached to Next's request lifecycle, including shutdown.
  if (pair) after(() => spawn(store, pair));
  return queueStatus(player);
}

function snapshot(match: Match, player: string): MatchSnapshot {
  return { ...match.result.reply, matchId: match.id, seat: match.result.reply.state.players.find((p) => p.id === player)?.seat ?? 0, activation: match.result.activation, creation: match.creation, lastTurnMs: match.lastTurnMs, backend: backend() };
}

export async function matchTurn(id: string, player: string, method: "state" | "drop" | "reset", body: object = {}): Promise<MatchSnapshot> {
  return getStore().withMatch(id, async (match) => {
    const seat: Cell = match.result.reply.state.players.find((p) => p.id === player)?.seat ?? 0;
    if (method !== "state" && !seat) return { ...snapshot(match, player), ok: false, error: "unknown_player" as const };
    match.result = await actor(id, method, method === "drop" ? { ...body, player } : {});
    if (method === "drop") match.lastTurnMs = match.result.activation.elapsedMs;
    return snapshot(match, player);
  });
}

export async function wall(): Promise<WallSnapshot> {
  const result = await getStore().wall();
  return { total: result.total, backend: backend(), matches: result.matches.map((match) => {
    const { seat: _seat, ...view } = snapshot(match, "");
    void _seat;
    return { ...view, createdAt: match.createdAt };
  }) };
}
