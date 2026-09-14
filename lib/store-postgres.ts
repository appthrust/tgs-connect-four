import "server-only";
import { Pool } from "pg";
import type { PoolClient, QueryResultRow } from "pg";
import { BackendError } from "./appthrust";
import type { Entry, Match, Store } from "./store";

interface PlayerRow extends QueryResultRow {
  player: string; name: string; status: Entry["status"]; started_at: Date; seen_at: Date;
  match_id: string | null; seat: Entry["seat"] | null; error: string | null;
}
interface MatchRow extends QueryResultRow {
  id: string; created_at: Date; creation: Match["creation"]; result: Match["result"]; last_turn_ms: number | null;
}
const scope = globalThis as typeof globalThis & { c4Pool?: Pool; c4Bootstrap?: Promise<void> };

async function database(): Promise<Pool> {
  try {
    if (!scope.c4Pool) {
      const url = new URL(process.env.DATABASE_URL!);
      // Use libpq semantics: require encrypts without CA verification unless a root CA is supplied.
      if (url.searchParams.has("sslmode") && !url.searchParams.has("uselibpqcompat")) url.searchParams.set("uselibpqcompat", "true");
      scope.c4Pool = new Pool({ connectionString: url.toString(), max: 5, connectionTimeoutMillis: 5000 });
      // pg removes broken idle clients; handle their event without exposing connection details.
      scope.c4Pool.on("error", () => { console.error("store_unavailable"); });
    }
    const pool = scope.c4Pool;
    scope.c4Bootstrap ??= bootstrap(pool).catch((error) => { scope.c4Bootstrap = undefined; throw error; });
    await scope.c4Bootstrap;
    return pool;
  } catch { throw new BackendError("store_unavailable", 503); }
}

async function bootstrap(pool: Pool): Promise<void> {
  const client = await pool.connect();
  let broken = false;
  try {
    await client.query("BEGIN");
    // IF NOT EXISTS alone can still race in PostgreSQL's catalogs across fresh replicas.
    await client.query("SELECT pg_advisory_xact_lock($1, $2)", [44004, 0]);
    await client.query("CREATE SCHEMA IF NOT EXISTS booth");
    await client.query(`DO $$ BEGIN
      IF to_regclass('booth.match_seq') IS NULL THEN
        CREATE SEQUENCE booth.match_seq;
        PERFORM setval('booth.match_seq', floor(random() * 90000 + 10000)::bigint, false);
      END IF;
    END $$`);
    await client.query(`CREATE TABLE IF NOT EXISTS booth.players (
      player text PRIMARY KEY, name text NOT NULL, status text NOT NULL,
      started_at timestamptz NOT NULL, seen_at timestamptz NOT NULL,
      match_id text, seat int, error text
    )`);
    await client.query(`CREATE TABLE IF NOT EXISTS booth.matches (
      id text PRIMARY KEY, created_at timestamptz NOT NULL, creation jsonb NOT NULL,
      result jsonb NOT NULL, last_turn_ms int, updated_at timestamptz NOT NULL
    )`);
    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { broken = true; }
    throw error;
  } finally { client.release(broken); }
}

async function query<T extends QueryResultRow>(client: Pool | PoolClient, sql: string, values: unknown[] = []) {
  try { return await client.query<T>(sql, values); }
  catch { throw new BackendError("store_unavailable", 503); }
}

async function transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const pool = await database();
  let client: PoolClient;
  try { client = await pool.connect(); } catch { throw new BackendError("store_unavailable", 503); }
  let broken = false;
  try {
    await query(client, "BEGIN");
    const result = await work(client);
    await query(client, "COMMIT");
    return result;
  } catch (error) {
    try { await query(client, "ROLLBACK"); } catch { broken = true; }
    throw error;
  } finally { client.release(broken); }
}

function entryFrom(row: PlayerRow): Entry {
  return {
    player: row.player, name: row.name, status: row.status,
    startedAt: row.started_at.getTime(), seenAt: row.seen_at.getTime(),
    matchId: row.match_id ?? undefined, seat: row.seat ?? undefined, error: row.error ?? undefined,
  };
}
function matchFrom(row: MatchRow): Match {
  return { id: row.id, createdAt: row.created_at.getTime(), creation: row.creation, result: row.result, lastTurnMs: row.last_turn_ms };
}

export const postgresStore: Store = {
  async reserve(player, name) {
    return transaction(async (client) => {
      // Serialize only the short reservation transaction, not actor work. Without this,
      // simultaneous first arrivals can both miss each other's uncommitted waiting row.
      await query(client, "SELECT pg_advisory_xact_lock($1, $2)", [44004, 1]);
      const existing = (await query<PlayerRow>(client, "SELECT * FROM booth.players WHERE player = $1 FOR UPDATE", [player])).rows[0];
      if (existing && existing.status !== "error") {
        const match = existing.match_id ? (await query<MatchRow>(client, "SELECT * FROM booth.matches WHERE id = $1", [existing.match_id])).rows[0] : undefined;
        if (!match || (match.result.reply.state.status !== "won" && match.result.reply.state.status !== "draw")) return;
      }
      await query(client, "DELETE FROM booth.players WHERE status = $1 AND seen_at < clock_timestamp() - $2::interval", ["waiting", "45 seconds"]);
      const entry = (await query<PlayerRow>(client, `INSERT INTO booth.players (player, name, status, started_at, seen_at)
        VALUES ($1, $2, $3, clock_timestamp(), clock_timestamp())
        ON CONFLICT (player) DO UPDATE SET name = EXCLUDED.name, status = EXCLUDED.status,
          started_at = EXCLUDED.started_at, seen_at = EXCLUDED.seen_at, match_id = NULL, seat = NULL, error = NULL
        RETURNING *`, [player, name, "waiting"])).rows[0];
      const opponent = (await query<PlayerRow>(client, `SELECT * FROM booth.players
        WHERE status = $1 AND player <> $2 ORDER BY started_at, player LIMIT 1 FOR UPDATE SKIP LOCKED`, ["waiting", player])).rows[0];
      if (!opponent) return;
      const id = (await query<{ id: string }>(client, "SELECT 'match-' || nextval('booth.match_seq') AS id")).rows[0].id;
      const players = (await query<PlayerRow>(client, `UPDATE booth.players SET status = $1, match_id = $2,
        seat = CASE WHEN player = $3 THEN 1 ELSE 2 END, started_at = clock_timestamp()
        WHERE player IN ($3, $4) RETURNING *`, ["spawning", id, opponent.player, entry.player])).rows;
      return { id, first: entryFrom(players.find((row) => row.player === opponent.player)!), second: entryFrom(players.find((row) => row.player === entry.player)!) };
    });
  },
  async queue(player) {
    return transaction(async (client) => {
      const row = (await query<PlayerRow>(client, "UPDATE booth.players SET seen_at = clock_timestamp() WHERE player = $1 RETURNING *", [player])).rows[0];
      if (!row) return {};
      const match = row.match_id ? (await query<MatchRow>(client, "SELECT * FROM booth.matches WHERE id = $1", [row.match_id])).rows[0] : undefined;
      return { entry: entryFrom(row), match: match ? matchFrom(match) : undefined };
    });
  },
  async createMatch(match) {
    await query(await database(), `INSERT INTO booth.matches (id, created_at, creation, result, last_turn_ms, updated_at)
      VALUES ($1, $2, $3, $4, $5, clock_timestamp())`, [match.id, new Date(match.createdAt), match.creation, match.result, match.lastTurnMs]);
  },
  async finishPair(id, error) {
    await query(await database(), "UPDATE booth.players SET status = $1, error = $2 WHERE match_id = $3 AND status = $4", [error ? "error" : "matched", error ?? null, id, "spawning"]);
  },
  async withMatch(id, turn) {
    return transaction(async (client) => {
      const row = (await query<MatchRow>(client, "SELECT * FROM booth.matches WHERE id = $1 FOR UPDATE", [id])).rows[0];
      if (!row) throw new BackendError("match_not_found", 404);
      const match = matchFrom(row);
      const result = await turn(match);
      await query(client, "UPDATE booth.matches SET result = $1, last_turn_ms = $2, updated_at = clock_timestamp() WHERE id = $3", [match.result, match.lastTurnMs, id]);
      return result;
    });
  },
  async wall() {
    const result = await query<{ total: string; matches: MatchRow[] }>(await database(), `SELECT
      (SELECT count(*) FROM booth.matches) AS total,
      COALESCE((SELECT jsonb_agg(recent ORDER BY created_at DESC, id DESC) FROM
        (SELECT * FROM booth.matches ORDER BY created_at DESC, id DESC LIMIT $1) recent), '[]'::jsonb) AS matches`, [24]);
    const row = result.rows[0];
    // Nested JSON timestamps are strings rather than pg's top-level timestamptz Dates.
    return { total: Number(row.total), matches: row.matches.map((match) => matchFrom({ ...match, created_at: new Date(match.created_at) })) };
  },
};
