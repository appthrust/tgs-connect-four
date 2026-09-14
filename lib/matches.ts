import "server-only";
import { BackendError, createActor, invokeActor } from "./appthrust";
import { mockActor } from "./mock-actor";
import type { Activation, ActorResult, Cell, GameMethod, MatchSnapshot, QueueSnapshot, Seat, WallSnapshot } from "./game";

interface Entry { player: string; name: string; status: QueueSnapshot["status"]; startedAt: number; seenAt: number; matchId?: string; seat?: Seat; error?: string }
interface Match { id: string; createdAt: number; result: ActorResult; creation: Activation; lastTurnMs: number | null; pending: Promise<unknown> }
interface Store { entries: Map<string, Entry>; matches: Map<string, Match>; counter: number }
const scope = globalThis as typeof globalThis & { c4Booth?: Store };
const store: Store = scope.c4Booth ??= { entries: new Map(), matches: new Map(), counter: Date.now() % 100000 };

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

async function spawn(first: Entry, second: Entry): Promise<void> {
  const id = `match-${++store.counter}`;
  for (const [index, entry] of [first, second].entries()) {
    entry.status = "spawning"; entry.matchId = id; entry.seat = (index + 1) as Seat; entry.startedAt = Date.now();
  }
  try {
    const created = await actor(id, "join", { player: first.player, name: first.name }, true);
    const match: Match = { id, createdAt: Date.now(), result: created, creation: created.activation, lastTurnMs: null, pending: Promise.resolve() };
    store.matches.set(id, match);
    if (!created.reply.ok) throw new BackendError(created.reply.error || "actor_request_failed", 409);
    const joining = actor(id, "join", { player: second.player, name: second.name }).then((result) => { match.result = result; });
    match.pending = joining;
    await joining;
    if (!match.result.reply.ok) throw new BackendError(match.result.reply.error || "actor_request_failed", 409);
    first.status = second.status = "matched";
  } catch (error) {
    for (const entry of [first, second]) {
      entry.status = "error";
      entry.error = error instanceof BackendError ? error.code : "actor_unavailable";
    }
  }
}

export function queueStatus(player: string): QueueSnapshot {
  const entry = store.entries.get(player);
  if (!entry) return { status: "idle", elapsedMs: 0, state: null, activation: null };
  entry.seenAt = Date.now();
  const match = entry.matchId ? store.matches.get(entry.matchId) : undefined;
  return { status: entry.status, elapsedMs: Date.now() - entry.startedAt, matchId: entry.matchId, seat: entry.seat, error: entry.error, state: match?.result.reply.state ?? null, activation: match?.creation ?? null };
}

export function enqueue(player: string, name: string): QueueSnapshot {
  backend();
  const existing = store.entries.get(player);
  if (existing && existing.status !== "error") {
    const match = existing.matchId ? store.matches.get(existing.matchId) : undefined;
    if (!match || (match.result.reply.state.status !== "won" && match.result.reply.state.status !== "draw")) return queueStatus(player);
  }
  for (const [id, entry] of store.entries) {
    if (entry.status === "waiting" && Date.now() - entry.seenAt > 45_000) store.entries.delete(id);
  }
  const entry: Entry = { player, name, status: "waiting", startedAt: Date.now(), seenAt: Date.now() };
  store.entries.set(player, entry);
  const opponent = [...store.entries.values()].find((other) => other.player !== player && other.status === "waiting");
  if (opponent) void spawn(opponent, entry);
  return queueStatus(player);
}

function snapshot(match: Match, player: string): MatchSnapshot {
  return { ...match.result.reply, matchId: match.id, seat: match.result.reply.state.players.find((p) => p.id === player)?.seat ?? 0, activation: match.result.activation, creation: match.creation, lastTurnMs: match.lastTurnMs, backend: backend() };
}

export async function matchTurn(id: string, player: string, method: "state" | "drop" | "reset", body: object = {}): Promise<MatchSnapshot> {
  const match = store.matches.get(id);
  if (!match) throw new BackendError("match_not_found", 404);
  // Serialize this process's reads and writes, so a slow state poll cannot overwrite a newer turn on the wall.
  const next = match.pending.catch(() => {}).then(async () => {
    const seat: Cell = match.result.reply.state.players.find((p) => p.id === player)?.seat ?? 0;
    if (method !== "state" && !seat) return { ...snapshot(match, player), ok: false, error: "unknown_player" as const };
    match.result = await actor(id, method, method === "drop" ? { ...body, player } : {});
    if (method === "drop") match.lastTurnMs = match.result.activation.elapsedMs;
    return snapshot(match, player);
  });
  match.pending = next;
  return next;
}

export function wall(): WallSnapshot {
  return { total: store.matches.size, backend: backend(), matches: [...store.matches.values()].reverse().map((match) => {
    const { seat: _seat, ...view } = snapshot(match, "");
    void _seat;
    return { ...view, createdAt: match.createdAt };
  }) };
}
