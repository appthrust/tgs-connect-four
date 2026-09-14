import "server-only";
import { BackendError } from "./appthrust";
import type { Entry, Match, Store } from "./store";

interface MemoryMatch extends Match { pending: Promise<unknown> }
interface MemoryState { entries: Map<string, Entry>; matches: Map<string, MemoryMatch>; counter: number }
const scope = globalThis as typeof globalThis & { c4Booth?: MemoryState };
const state = scope.c4Booth ??= { entries: new Map(), matches: new Map(), counter: Date.now() % 100000 };

export const memoryStore: Store = {
  async reserve(player, name) {
    const existing = state.entries.get(player);
    if (existing && existing.status !== "error") {
      const match = existing.matchId ? state.matches.get(existing.matchId) : undefined;
      if (!match || (match.result.reply.state.status !== "won" && match.result.reply.state.status !== "draw")) return;
    }
    const now = Date.now();
    for (const [id, entry] of state.entries) {
      if (entry.status === "waiting" && now - entry.seenAt > 45_000) state.entries.delete(id);
    }
    const entry: Entry = { player, name, status: "waiting", startedAt: now, seenAt: now };
    state.entries.set(player, entry);
    const opponent = [...state.entries.values()].find((other) => other.player !== player && other.status === "waiting");
    if (!opponent) return;
    const id = `match-${++state.counter}`;
    Object.assign(opponent, { status: "spawning", matchId: id, seat: 1, startedAt: now });
    Object.assign(entry, { status: "spawning", matchId: id, seat: 2, startedAt: now });
    return { id, first: opponent, second: entry };
  },
  async queue(player) {
    const entry = state.entries.get(player);
    if (entry) entry.seenAt = Date.now();
    return { entry, match: entry?.matchId ? state.matches.get(entry.matchId) : undefined };
  },
  async createMatch(match) {
    state.matches.set(match.id, { ...match, pending: Promise.resolve() });
  },
  async finishPair(id, error) {
    for (const entry of state.entries.values()) {
      if (entry.matchId === id && entry.status === "spawning") {
        entry.status = error ? "error" : "matched";
        entry.error = error;
      }
    }
  },
  async withMatch(id, turn) {
    const match = state.matches.get(id);
    if (!match) throw new BackendError("match_not_found", 404);
    const next = match.pending.catch(() => {}).then(() => turn(match));
    match.pending = next;
    return next;
  },
  async wall() {
    return { total: state.matches.size, matches: [...state.matches.values()].reverse().slice(0, 24) };
  },
};
