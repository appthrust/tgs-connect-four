"use client";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { QueueSnapshot } from "@/lib/game";

export function Lobby() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [queue, setQueue] = useState<QueueSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const waiting = queue?.status === "waiting" || queue?.status === "spawning";

  useEffect(() => {
    if (!waiting) return;
    const controller = new AbortController();
    let timer: number;
    async function poll() {
      try {
        const response = await fetch("/api/queue", { cache: "no-store", signal: controller.signal });
        const data: QueueSnapshot = await response.json();
        if (data.status === "matched" && data.matchId) { router.push(`/play/${data.matchId}`); return; }
        setQueue(data);
        if (!response.ok || data.status === "error") { setError("Your match couldn’t start. Please try again."); return; }
        if (data.status === "idle") { setError("Your place in line expired. Find a match again."); return; }
        setError("");
      } catch { if (!controller.signal.aborted) setError("Connection interrupted. Reconnecting…"); }
      if (!controller.signal.aborted) timer = window.setTimeout(poll, 500);
    }
    timer = window.setTimeout(poll, 300);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [waiting, router]);

  useEffect(() => {
    if (!waiting || !queue) return;
    const started = Date.now() - queue.elapsedMs;
    const timer = setInterval(() => setElapsed(Date.now() - started), 100);
    return () => clearInterval(timer);
  }, [waiting, queue]);

  async function join(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/queue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
      const data: QueueSnapshot = await response.json();
      if (!response.ok) throw new Error();
      if (data.status === "matched" && data.matchId) router.push(`/play/${data.matchId}`);
      else setQueue(data);
    } catch { setError("We couldn’t join the queue. Check your connection and try again."); }
    finally { setBusy(false); }
  }

  if (waiting) return <div className="waiting-panel" aria-live="polite">
    <div className="waiting-chips" aria-hidden="true"><span /><span /><span /></div>
    <h2>{queue.status === "spawning" ? "Spawning your match actor…" : "Finding your player two…"}</h2>
    <p>{queue.status === "spawning" ? "A little world, just for your match." : "Keep this screen open. Your next rival is nearby."}</p>
    <div className="waiting-readout"><span>{(elapsed / 1000).toFixed(1)} s elapsed</span><span>{queue.activation ? `${queue.activation.attempts} attempt${queue.activation.attempts === 1 ? "" : "s"}` : queue.status === "spawning" ? "Attempts after activation" : "Waiting for a player"}</span></div>
    <p className="japanese" lang="ja">{queue.status === "spawning" ? "あなたの対戦専用アクターを起動中" : "対戦相手を探しています"}</p>
    {error && <p className="error-message" role="alert">{error}</p>}
  </div>;

  return <form className="join-form" onSubmit={join}>
    <label htmlFor="player-name">What should we call you?</label>
    <input id="player-name" name="name" autoComplete="nickname" placeholder="Your player name" maxLength={24} required value={name} onChange={(event) => setName(event.target.value)} disabled={busy} />
    <button className="primary-button" type="submit" disabled={busy || !name.trim()}>{busy ? "Joining the queue…" : "Find a match"}<span aria-hidden="true">↗</span></button>
    <p className="form-note">No account. Just a name and a little friendly rivalry.</p>
    {error && <p className="error-message" role="alert">{error}</p>}
  </form>;
}
