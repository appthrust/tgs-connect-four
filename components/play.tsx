"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Board } from "./board";
import type { MatchSnapshot } from "@/lib/game";

const errors: Record<string, string> = {
  not_your_turn: "It’s your opponent’s turn. Your move is next.", column_full: "That column is full. Choose another one.",
  not_playing: "This round has finished.", unknown_player: "You’re watching this match. Join the queue to play.",
  bad_column: "Choose a column from 1 to 7.", match_not_found: "This match isn’t available on this server. Find a new match.",
};

function isFinished(status: MatchSnapshot["state"]["status"] | undefined): boolean {
  return status === "won" || status === "draw";
}

export function Play({ matchId }: { matchId: string }) {
  const [match, setMatch] = useState<MatchSnapshot | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const mutation = useRef(false);
  const serial = useRef(0);
  // Every poll is a `state` call on the match actor, which keeps it awake.
  // Stop polling once the round is decided so an idle actor can go to sleep;
  // "Play again" bumps the round to resume.
  const [round, setRound] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let timer: number;
    async function poll() {
      let settled = false;
      if (!mutation.current) {
        const request = ++serial.current;
        try {
          const response = await fetch(`/api/match/${matchId}`, { cache: "no-store", signal: controller.signal });
          const data = await response.json();
          if (request === serial.current) {
            if (data.state) setMatch(data);
            if (!response.ok) setError(errors[data.error] || "The actor is unavailable. Reconnecting…");
            else setError("");
            settled = isFinished(data.state?.status);
          }
        } catch { if (!controller.signal.aborted && request === serial.current) setError("Connection interrupted. Reconnecting…"); }
      }
      if (!controller.signal.aborted && !settled) timer = window.setTimeout(poll, 800);
    }
    void poll();
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [matchId, round]);

  async function act(method: "drop" | "reset", column?: number) {
    if (mutation.current) return;
    mutation.current = true; ++serial.current; setBusy(true); setError("");
    try {
      if (method === "reset") {
        // Polling stopped when the round ended, so the opponent may already
        // have started the rematch. Re-read before wiping the board.
        const current = await fetch(`/api/match/${matchId}`, { cache: "no-store" });
        const data = await current.json();
        if (current.ok && data.state && !isFinished(data.state.status)) { setMatch(data); setRound((value) => value + 1); return; }
      }
      const response = await fetch(`/api/match/${matchId}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(method === "drop" ? { column } : {}) });
      const data = await response.json();
      if (data.state) setMatch(data);
      if (!response.ok) setError(errors[data.error] || "That move didn’t go through. Please try again.");
      else if (method === "reset") setRound((value) => value + 1);
    } catch { setError("Connection interrupted. Checking the board before your next move…"); }
    finally { mutation.current = false; setBusy(false); }
  }

  if (!match) return <div className="loading-screen"><span className="loading-dot" /><h1>Opening your match…</h1><p>{error || "Connecting to your actor"}</p>{error && <Link href="/" className="text-link">Back to the lobby ↗</Link>}</div>;
  const { state, seat } = match;
  const ownTurn = state.status === "playing" && state.next === seat;
  const nextName = state.players.find((player) => player.seat === state.next)?.name;
  const winner = state.players.find((player) => player.seat === state.winner)?.name;
  let title = ownTurn ? "Your move." : `${nextName || "Player two"}’s move.`;
  let subtitle = ownTurn ? "Pick a column. Make it count." : "A little patience. A little strategy.";
  if (!seat && state.status === "playing") subtitle = "You’re in the audience. Enjoy the match.";
  if (state.status === "won") { title = state.winner === seat ? "That’s four. You win!" : `${winner} connects four!`; subtitle = "Good game. One more round?"; }
  if (state.status === "draw") { title = "A perfect standoff."; subtitle = "It’s a draw. Time for a rematch."; }
  if (state.status === "waiting") { title = "Waiting for player two…"; subtitle = "Your actor is ready."; }
  const finished = isFinished(state.status);

  return <main className="play-layout">
    <section className="game-area" aria-label="Your match">
      <div className="match-heading"><span className="match-label">{seat ? `YOU ARE PLAYER ${seat}` : "SPECTATOR"}</span><span className="turn-count">TURN {String(state.moves + (finished ? 0 : 1)).padStart(2, "0")}</span></div>
      <div className="turn-announcement" aria-live="polite"><h1>{busy ? "Sending your move…" : title}</h1><p>{subtitle}</p></div>
      <div className="players">{state.players.map((player) => <div key={player.id} className={`player ${state.next === player.seat ? "active-player" : ""}`}>
        <span className={`player-disc seat-${player.seat}`} aria-hidden="true">{player.seat === 1 ? "·" : "="}</span><div><span className="player-name">{player.name}</span><span className="player-meta">PLAYER {player.seat}{seat === player.seat ? " · YOU" : ""}</span></div>{state.next === player.seat && <span className="turn-dot" aria-label="Current turn" />}
      </div>)}</div>
      <Board state={state} seat={seat} onDrop={(column) => void act("drop", column)} disabled={busy} />
      <div className="board-caption">{finished ? "Four in a row. A moment to remember." : ownTurn ? "Tap a number above the board to drop your piece." : "The board updates live. No refresh needed."}</div>
      {error && <p className="error-message" role="alert">{error}</p>}
      {finished && seat !== 0 && <button className="primary-button rematch" disabled={busy} onClick={() => void act("reset")}>Play again <span aria-hidden="true">↻</span></button>}
    </section>
    <aside className="actor-card">
      <div className="actor-card-heading"><span className="status-dot" />{match.backend === "mock" ? "LOCAL SIMULATION" : "POWERED BY AN ACTOR"}</div>
      <h2>One match.<br /> One little world.</h2>
      <p>{match.backend === "mock" ? "You’re playing the development mock. These timings are simulated, not Platform measurements." : "This board has its own AppThrust actor. Every move runs there. Your browser just plays along."}</p>
      <div className="actor-id"><span>ACTOR ID</span><code>{matchId}</code></div>
      <dl className="actor-metrics"><div><dt>{match.creation.coldStart ? "Cold start" : "Activation"}</dt><dd>{match.creation.elapsedMs.toLocaleString()} <small>ms</small></dd></div><div><dt>Start attempts</dt><dd>{match.creation.attempts}</dd></div><div><dt>Last turn</dt><dd>{match.lastTurnMs === null ? "—" : match.lastTurnMs.toLocaleString()} <small>{match.lastTurnMs === null ? "" : "ms"}</small></dd></div><div><dt>Last call</dt><dd>{match.activation.elapsedMs.toLocaleString()} <small>ms · {match.activation.attempts}×{match.activation.coldStart ? " cold" : ""}</small></dd></div></dl>
      <div className="actor-route">Your phone <span>→</span> AppThrust <span>→</span> Your actor</div>
      <p className="japanese" lang="ja">対戦ごとに、ひとつのアクター。</p>
      <Link href="/wall" className="text-link">See the live match wall <span aria-hidden="true">↗</span></Link>
    </aside>
  </main>;
}
