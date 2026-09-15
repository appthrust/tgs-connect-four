"use client";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { Board } from "./board";
import type { WallSnapshot } from "@/lib/game";
const STALE_MS = 6_000;
const FALLBACK_POLL_MS = 2_000;

export function Wall({ scan }: { scan: ReactNode }) {
  const [wall, setWall] = useState<WallSnapshot | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let streamAt = 0;
    let timer: number;
    const accept = (snapshot: WallSnapshot) => { setWall(snapshot); setError(false); };
    // Primary: server-sent events push every board change (~0.5 s after a
    // move) and a ping every 5 s. The browser reconnects the stream itself.
    const events = new EventSource("/api/wall/stream");
    events.addEventListener("wall", (event) => { streamAt = Date.now(); accept(JSON.parse((event as MessageEvent<string>).data)); });
    events.addEventListener("ping", () => { streamAt = Date.now(); });
    // Safety net: plain polling once the stream has been silent for a while,
    // so a proxy that buffers or cuts long responses still leaves the TV live.
    async function poll() {
      if (Date.now() - streamAt > STALE_MS) {
        try {
          const response = await fetch("/api/wall", { cache: "no-store", signal: controller.signal });
          if (!response.ok) throw new Error();
          accept(await response.json());
        } catch { if (!controller.signal.aborted) setError(true); }
      }
      if (!controller.signal.aborted) timer = window.setTimeout(poll, FALLBACK_POLL_MS);
    }
    void poll();
    return () => { controller.abort(); events.close(); window.clearTimeout(timer); };
  }, []);
  return <main className="wall-layout">
    <header className="wall-heading"><div><div className="wall-live"><span className="status-dot" />{error ? "RECONNECTING" : "LIVE FROM THE BOOTH"}{wall?.backend === "mock" && " · LOCAL SIMULATION"}</div><h1>The match wall<span>.</span></h1><p lang="ja">ここから生まれる、すべての対戦。</p></div>{scan}<div className="spawn-total"><strong>{wall?.total ?? "—"}</strong><span>MATCHES SPAWNED</span></div></header>
    {error && <p role="alert" className="error-message">Connection interrupted. Showing the last received boards.</p>}
    {!wall?.matches.length && <div className="wall-empty"><div className="four-mark" aria-hidden="true"><i /><i /><i /><i /></div><h2>{wall ? "The next great match starts with you." : "Connecting to the booth…"}</h2><Link href="/" className="primary-button">Find a match <span aria-hidden="true">↗</span></Link></div>}
    <div className="wall-grid">{wall?.matches.map((match) => {
      const { state } = match;
      const winner = state.players.find((player) => player.seat === state.winner);
      const status = state.status === "won" ? winner?.name + " wins" : state.status === "draw" ? "Draw" : state.status === "playing" ? "In play" : "Waiting";
      return <Link key={match.matchId} href={`/play/${match.matchId}`} className="wall-match"><div className="wall-match-top"><code>{match.matchId}</code><span className={`match-status status-${state.status}`}>{status}</span></div><div className="wall-names">{state.players.map((player, index) => <span key={player.id}>{index > 0 && <em>vs</em>}<i className={`player-disc seat-${player.seat}`} />{player.name}</span>)}</div><Board state={state} mini /><div className="wall-match-footer"><span>{state.moves} moves</span><span>{match.creation.elapsedMs.toLocaleString()} ms to start · {match.creation.attempts}×</span></div></Link>;
    })}</div>
    <footer className="wall-footer">A new actor for every match. <span>No shared board. No shared fate.</span><Link href="/">Play at the booth ↗</Link></footer>
  </main>;
}
