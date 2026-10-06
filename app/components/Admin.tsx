"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveProject, declineProject, removeProject, requestRescan, restoreProject, savePrefs, startProject, type Ignored } from "@/lib/actions";
import { Ack, enterCommits, useSubmit } from "./Submit";

export type Proposal = { id: string; name: string; folder?: string; dir?: string; tagline?: string };
export type Rescan = { status: "queued" | "running" | "done" | "failed"; requested_at?: string; started_at?: string; finished_at?: string; added?: string[]; proposed?: Proposal[]; archived?: string[]; total?: number; error?: string };

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
  else if (state?.status === "done") line = `Done${mounted && state.finished_at ? ` ${ago(state.finished_at)}` : ""}: ${state.proposed?.length ? `${state.proposed.length} new folder${state.proposed.length > 1 ? "s" : ""} waiting for your approval below` : state.added?.length ? `${state.added.length} new project${state.added.length > 1 ? "s" : ""} (${state.added.join(", ")})` : "no new folders"}${state.archived?.length ? `, ${state.archived.length} archived (folder gone)` : ""}${state.total != null ? ` · ${state.total} registered` : ""}.`;
  else if (state?.status === "failed") line = `Failed${mounted && state.finished_at ? ` ${ago(state.finished_at)}` : ""}: ${state.error || "unknown error"}`;
  return (
    <div className="rescan">
      <button className="btn" disabled={busy || pending} onClick={() => start(() => requestRescan())} title="Scans every folder under your projects folder. New folders are proposed for your approval, never added on their own. Existing projects are updated; nothing is deleted.">
        {busy || pending ? "Refreshing…" : "Refresh project folders"}
      </button>
      <span className={`mst ${state?.status === "failed" ? "err" : busy ? "wait" : "ok"}`} role="status">{line}</span>
      {offline && <span className="due late">{workerAt ? "The Mac worker is offline: the scan runs when your Mac wakes." : "The Mac worker isn't installed yet: the scan can't run."}</span>}
    </div>
  );
}

/** "Start new project": the Mac worker creates the folder, adds the project and runs the setup session on it. */
export function NewProject() {
  const [name, setName] = useState("");
  const sub = useSubmit();
  const send = (e: React.FormEvent) => {
    e.preventDefault();
    sub.submit(() => startProject(name), { ok: "Queued: the result arrives in your Inbox", onOk: () => setName("") });
  };
  return (
    <form className="newproj" onSubmit={send} data-track-section="Start new project">
      <label className="lbl" htmlFor="new-project-name">New project</label>
      <input className="input" id="new-project-name" type="text" maxLength={60} placeholder="Project name" autoComplete="off" value={name}
        onChange={(e) => { setName(e.target.value); if (sub.err) sub.clear(); }} />
      <button className="btn" type="submit" disabled={sub.pending || !name.trim()}
        title="Creates the folder in your projects folder on your Mac, adds it here, then Claude writes its first docs (PRD, CLAUDE.md, README…) and puts its questions for you on the checklist">
        {sub.pending ? "Starting…" : "Start new project"}
      </button>
      <Ack s={sub} busy="Starting…" />
    </form>
  );
}

/** New folders from the last refresh: each joins the dashboard only once approved; a declined one is never proposed again. */
export function Proposals({ list }: { list: Proposal[] }) {
  const [pending, start] = useTransition();
  if (!list.length) return null;
  return (
    <div className="proposals" data-track-section="New folders">
      <div className="note-line"><b>New folders found.</b> Approve the ones you want on the dashboard; declined folders stay on your Mac and are not proposed again (you can restore them below).</div>
      <table>
        <thead><tr><th>Folder</th><th>About</th><th /></tr></thead>
        <tbody>
          {list.map((p) => (
            <tr key={p.id}>
              <td><b>{p.name}</b><span className="dir-sub">{p.dir || p.folder}</span></td>
              <td>{p.tagline || "—"}</td>
              <td className="acts">
                <button className="btn sm" disabled={pending} onClick={() => start(() => approveProject(p.id))}>Approve</button>
                <button className="btn ghost sm" disabled={pending} onClick={() => start(() => declineProject(p.id))}>Decline</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Remove a project from Jarvis (two clicks, no browser dialog): archived, its data kept, and skipped by future scans. */
export function RemoveProject({ id, name }: { id: string; name: string }) {
  const [armed, setArmed] = useState(false);
  const [pending, start] = useTransition();
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 5000); return () => clearTimeout(t); }, [armed]);
  return armed
    ? <button className="btn sm danger" disabled={pending} aria-label={`Confirm removing ${name}`} onClick={() => start(() => removeProject(id))}>{pending ? "Removing…" : "Confirm remove"}</button>
    : <button className="btn ghost sm" aria-label={`Remove ${name} from Jarvis`} title="Takes it off the dashboard and out of every future folder scan. The folder on your Mac and the project's checklist history are kept; Restore brings it back." onClick={() => setArmed(true)}>Remove</button>;
}

/** Removed projects and declined folders, with Restore. */
export function IgnoredList({ list }: { list: Ignored[] }) {
  const [pending, start] = useTransition();
  if (!list.length) return null;
  return (
    <div className="ignored" data-track-section="Removed projects">
      <div className="note-line"><b>Removed and declined.</b> Jarvis skips these folders. Restore brings a removed project back as it was; a declined folder is proposed again on the next refresh.</div>
      <table>
        <tbody>
          {list.map((x) => (
            <tr key={x.id} className="archived">
              <td>{x.name}<span className="dir-sub">{x.folder || x.id}</span></td>
              <td>{x.reason === "removed" ? "removed" : "declined"} · {x.at.slice(0, 10)}</td>
              <td className="acts"><button className="btn ghost sm" disabled={pending} onClick={() => start(() => restoreProject(x.id))}>Restore</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Preferences kept on the site (kv "prefs"). Instance settings live in jarvis.config.json, not here. */
export function PrefsForm({ showDone, currency }: { showDone: boolean; currency: string }) {
  const [sd, setSd] = useState(showDone), [cur, setCur] = useState(currency);
  const sub = useSubmit();
  const save = (p: Parameters<typeof savePrefs>[0]) => sub.submit(() => savePrefs(p));
  return (
    <div className="psettings">
      <label className="toggle" title="Checklists open with finished and cancelled items visible instead of hidden behind “Show completed”">
        <input type="checkbox" checked={sd} onChange={(e) => { setSd(e.target.checked); save({ show_done_default: e.target.checked }); }} />
        Show completed items by default
      </label>
      <label className="hrs" title="Currency proposed when you add a recurring cost in Finance">
        <span>Default currency</span>
        <input className="input" value={cur} maxLength={3} placeholder="USD" style={{ width: 64, textTransform: "uppercase" }}
          onChange={(e) => setCur(e.target.value.toUpperCase())} onKeyDown={enterCommits}
          onBlur={() => { const v = cur.trim().toUpperCase(); if (v === currency) return; if (v.length === 3) save({ finance_currency: v }); else sub.submit(async () => ({ error: "Use a 3-letter currency code, like USD." })); }} />
      </label>
      <Ack s={sub} />
    </div>
  );
}
