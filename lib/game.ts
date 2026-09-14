export type Seat = 1 | 2;
export type Cell = 0 | Seat;
export type GameMethod = "join" | "state" | "drop" | "reset";
export type GameError = "bad_request" | "match_full" | "not_playing" | "not_your_turn" | "bad_column" | "column_full" | "unknown_player";
export interface GameState {
  version: 1;
  status: "waiting" | "playing" | "won" | "draw";
  players: { id: string; name: string; seat: Seat }[];
  board: Cell[][];
  next: Cell;
  winner: Cell;
  winningCells: [number, number][];
  moves: number;
  lastMove?: { seat: Seat; column: number; row: number };
}
export interface Activation { attempts: number; elapsedMs: number; coldStart: boolean }
export interface ActorReply { ok: boolean; error?: GameError; state: GameState }
export interface ActorResult { reply: ActorReply; activation: Activation }
export interface MatchSnapshot extends ActorReply {
  matchId: string;
  seat: Cell;
  activation: Activation;
  creation: Activation;
  lastTurnMs: number | null;
  backend: "mock" | "platform-api";
}
export interface QueueSnapshot {
  status: "idle" | "waiting" | "spawning" | "matched" | "error";
  elapsedMs: number;
  matchId?: string;
  seat?: Seat;
  error?: string;
  state: GameState | null;
  activation: Activation | null;
}
export interface WallSnapshot {
  total: number;
  backend: "mock" | "platform-api";
  matches: (Omit<MatchSnapshot, "seat"> & { createdAt: number })[];
}
export function emptyState(): GameState {
  return { version: 1, status: "waiting", players: [], board: Array.from({ length: 6 }, () => Array<Cell>(7).fill(0)), next: 0, winner: 0, winningCells: [], moves: 0 };
}
