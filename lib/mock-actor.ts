import "server-only";
import { setTimeout as delay } from "node:timers/promises";
import { emptyState } from "./game";
import type { ActorReply, ActorResult, GameError, GameMethod, GameState, Seat } from "./game";

const scope = globalThis as typeof globalThis & { c4MockActors?: Map<string, GameState> };
const actors = scope.c4MockActors ??= new Map<string, GameState>();

function turn(state: GameState, method: GameMethod, body: Record<string, unknown>): ActorReply {
  const fail = (error: GameError): ActorReply => ({ ok: false, error, state });
  if (!body || Array.isArray(body) || typeof body !== "object") return fail("bad_request");
  const allowed = { join: ["player", "name"], drop: ["player", "column"] };
  if ((method === "join" || method === "drop") && Object.keys(body).some((key) => !allowed[method].includes(key))) return fail("bad_request");
  if (method === "join") {
    if (typeof body.player !== "string" || !body.player.trim() || typeof body.name !== "string" || !body.name.trim()) return fail("bad_request");
    if (!state.players.some((player) => player.id === body.player)) {
      if (state.players.length === 2) return fail("match_full");
      state.players.push({ id: body.player, name: body.name, seat: (state.players.length + 1) as Seat });
      if (state.players.length === 2) { state.status = "playing"; state.next = 1; }
    }
  } else if (method === "reset") {
    const players = state.players;
    Object.assign(state, emptyState(), { players, status: players.length === 2 ? "playing" : "waiting", next: players.length === 2 ? 1 : 0 });
    delete state.lastMove;
  } else if (method === "drop") {
    const column = body.column;
    if (typeof body.player !== "string" || !body.player.trim() || typeof column !== "number" || !Number.isSafeInteger(column)) return fail("bad_request");
    if (state.status !== "playing") return fail("not_playing");
    const player = state.players.find((player) => player.id === body.player);
    if (!player) return fail("unknown_player");
    if (player.seat !== state.next) return fail("not_your_turn");
    if (column < 0 || column > 6) return fail("bad_column");
    const row = state.board.findIndex((row) => row[column] === 0);
    if (row === -1) return fail("column_full");
    state.board[row][column] = player.seat;
    state.moves++;
    state.lastMove = { seat: player.seat, column, row };
    scan: for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
      for (let offset = 0; offset < 4; offset++) {
        const cells: [number, number][] = [];
        for (let step = 0; step < 4; step++) {
          const r = row + (step - offset) * dr, c = column + (step - offset) * dc;
          if (state.board[r]?.[c] !== player.seat) break;
          cells.push([r, c]);
        }
        if (cells.length === 4) {
          state.status = "won"; state.winner = player.seat; state.winningCells = cells; state.next = 0;
          break scan;
        }
      }
    }
    if (state.status !== "won") {
      state.status = state.moves === 42 ? "draw" : "playing";
      state.next = state.status === "draw" ? 0 : player.seat === 1 ? 2 : 1;
    }
  }
  return { ok: true, state };
}

export async function mockActor(actorId: string, method: GameMethod, body: object): Promise<ActorResult> {
  if (process.env.NODE_ENV === "production") throw new Error("mock_backend_disabled_in_production");
  const start = performance.now();
  const coldStart = !actors.has(actorId);
  if (coldStart) {
    // Deliberate, labelled simulation so the booth's waiting screen can be exercised offline.
    actors.set(actorId, emptyState());
    await delay(1200);
  }
  const state = actors.get(actorId)!;
  const reply = turn(state, method, body as Record<string, unknown>);
  return { reply: structuredClone(reply), activation: { attempts: 1, elapsedMs: Math.round(performance.now() - start), coldStart } };
}
