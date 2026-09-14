import "server-only";
import type { Activation, ActorResult, QueueSnapshot, Seat } from "./game";
import { memoryStore } from "./store-memory";
import { postgresStore } from "./store-postgres";

export interface Entry {
  player: string;
  name: string;
  status: QueueSnapshot["status"];
  startedAt: number;
  seenAt: number;
  matchId?: string;
  seat?: Seat;
  error?: string;
}
export interface Match {
  id: string;
  createdAt: number;
  result: ActorResult;
  creation: Activation;
  lastTurnMs: number | null;
}
export interface Pair { id: string; first: Entry; second: Entry }
export interface Store {
  reserve(player: string, name: string): Promise<Pair | undefined>;
  queue(player: string): Promise<{ entry?: Entry; match?: Match }>;
  createMatch(match: Match): Promise<void>;
  finishPair(id: string, error?: string): Promise<void>;
  withMatch<T>(id: string, turn: (match: Match) => Promise<T>): Promise<T>;
  wall(): Promise<{ total: number; matches: Match[] }>;
}

export function getStore(): Store {
  return process.env.DATABASE_URL ? postgresStore : memoryStore;
}
