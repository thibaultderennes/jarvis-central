"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { requestRescan, savePrefs } from "@/lib/actions";

export type Rescan = { status: "queued" | "running" | "done" | "failed"; requested_at?: string; started_at?: string; finished_at?: string; added?: string[]; archived?: string[]; total?: number; error?: string };

const ago = (t: string) => { const m = Math.round((Date.now() - +new Date(t)) / 6e4); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };

/** "Refresh project folders": queues a scan for the Mac worker and shows how it went. */
export function RescanButton({ state, workerAt }: { state: Rescan | null; workerAt: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const busy = state?.status === "queued" || state?.status === "running";
  useEffect(() => { if (!busy) return; const t = setInterval(() => router.refresh(), 5000); return () => clearInterval(t); }, [busy, router]);
  const offline = mounted && (!workerAt || Date.now() - +new Date(workerAt) > 5 * 60_000);
  let line = "Never scanned from here.";
  if (state?.status === "queued") line = "Queued: the Mac worker picks it up within a minute.";
  else if (state?.status === "running") line = `Scanning your projects folder…${mounted && state.started_at ? ` (started ${ago(state.started_at)})` : ""}`;
  else if (state?.status === "done") line = `Done${mounted && state.finished_at ? ` ${ago(state.finished_at)}` : ""}: ${state.added?.length ? `${state.added.length} new project${state.added.length > 1 ? "s" : ""} (${state.added.join(", ")})` : "no new projects"}${state.archived?.length ? `, ${state.archived.length} archived (folder gone)` : ""}${state.total != null ? ` · ${state.total} registered` : ""}.`;
  else if (state?.status === "failed") line = `Failed${mounted && state.finished_at ? ` ${ago(state.finished_at)}` : ""}: ${state.error || "unknown error"}`;
  return (
    <div className="rescan">
      <button className="btn" disabled={busy || pending} onClick={() => start(() => requestRescan())} title="Scans every folder under your projects folder and registers the ones that aren't projects yet. Existing projects are left as they are; nothing is deleted.">
        {busy || pending ? "Refreshing…" : "Refresh project folders"}
      </button>
      <span className={`mst ${state?.status === "failed" ? "err" : busy ? "wait" : "ok"}`} role="status">{line}</span>
      {offline && <span className="due late">{workerAt ? "The Mac worker is offline: the scan runs when your Mac wakes." : "The Mac worker isn't installed yet: the scan can't run."}</span>}
    </div>
  );
}

/** Preferences kept on the site (kv "prefs"). Instance settings live in jarvis.config.json, not here. */
export function PrefsForm({ showDone, currency }: { showDone: boolean; currency: string }) {
  const [sd, setSd] = useState(showDone), [cur, setCur] = useState(currency);
  const [msg, setMsg] = useState(""), [, start] = useTransition();
  const save = (p: Parameters<typeof savePrefs>[0]) => start(async () => {
    try { await savePrefs(p); setMsg("Saved"); setTimeout(() => setMsg(""), 1500); } catch { setMsg("Couldn't save. Try again."); }
  });
  return (
    <div className="psettings">
      <label className="toggle" title="Checklists open with finished and cancelled items visible instead of hidden behind “Show completed”">
        <input type="checkbox" checked={sd} onChange={(e) => { setSd(e.target.checked); save({ show_done_default: e.target.checked }); }} />
        Show completed items by default
      </label>
      <label className="hrs" title="Currency proposed when you add a recurring cost in Finance">
        <span>Default currency</span>
        <input className="input" value={cur} maxLength={3} placeholder="USD" style={{ width: 64, textTransform: "uppercase" }}
          onChange={(e) => setCur(e.target.value.toUpperCase())}
          onBlur={() => { const v = cur.trim().toUpperCase(); if (v.length === 3 && v !== currency) save({ finance_currency: v }); }} />
      </label>
      <span className="saved" role="status">{msg}</span>
    </div>
  );
}
