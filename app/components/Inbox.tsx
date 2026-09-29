"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { archiveMessage, sendMessage } from "@/lib/actions";
import type { Message } from "@/lib/data";

type P = { id: string; name: string; color: string };
const ST: Record<string, [string, string]> = {
  new: ["Waiting for the Mac worker", "wait"], seen: ["Picked up", "wait"], working: ["Working…", "wait"],
  answered: ["Answered", "ok"], done: ["Done", "ok"], needs_you: ["Needs you", "err"], error: ["Failed", "err"],
};
const ago = (t: string) => { const m = Math.round((Date.now() - +new Date(t)) / 6e4); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };

export default function Inbox({ messages, projects, defaultProject, workerAt }: { messages: Message[]; projects: P[]; defaultProject: string; workerAt: string | null }) {
  const router = useRouter();
  const [text, setText] = useState(""), [proj, setProj] = useState(defaultProject), [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const [mounted, setMounted] = useState(false);
  const pmap = Object.fromEntries(projects.map((p) => [p.id, p]));
  const busy = messages.some((m) => ["new", "seen", "working"].includes(m.status));
  useEffect(() => setMounted(true), []);
  // While something is in flight, refresh every 10 s so replies appear without reloading.
  useEffect(() => { if (!busy) return; const t = setInterval(() => router.refresh(), 10000); return () => clearInterval(t); }, [busy, router]);
  const send = (mode: "discuss" | "build") => {
    const v = text.trim(); if (!v) return;
    start(async () => { try { await sendMessage(v, proj || null, { mode }); setText(""); setErr(""); } catch { setErr("Couldn't send. Try again."); } });
  };
  const offline = mounted && (!workerAt || Date.now() - +new Date(workerAt) > 5 * 60_000);
  return (
    <section className="panel">
      <form className="composer" onSubmit={(e) => { e.preventDefault(); send("discuss"); }}>
        <label className="lbl" htmlFor="msg">Message</label>
        <textarea id="msg" className="textarea" rows={4} value={text} onChange={(e) => setText(e.target.value)}
          placeholder={"Plan my Tuesday around the 2 pm appointment · What should I cut this week? · Why is item r05 blocked? · Move the launch items one week"}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) (e.currentTarget.form as HTMLFormElement).requestSubmit(); }} />
        <div className="crow">
          <label className="lbl" htmlFor="msg-proj">About</label>
          <select id="msg-proj" className="select" value={proj} onChange={(e) => setProj(e.target.value)}>
            <option value="">Everything / planning</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <span className="sp" />
          {offline && <span className="due late">{workerAt ? "The Mac worker is offline: it answers when your Mac wakes." : "The Mac worker isn't installed yet."}</span>}
          <button type="button" className="btn ghost" disabled={pending || !text.trim()} onClick={() => send("build")} title="Works on a new git branch and opens a pull request">Build it (PR)</button>
          <button className="btn" disabled={pending || !text.trim()}>{pending ? "Sending…" : "Ask / discuss"}</button>
        </div>
        {err && <div className="due late" role="alert">{err}</div>}
      </form>
      <div>
        {!messages.length && <div className="empty">No messages yet.</div>}
        {messages.map((m) => {
          const [label, cls] = ST[m.status] || [m.status, ""];
          const p = m.project_id ? pmap[m.project_id] : null;
          const meta = m.meta as { pr_url?: string; branch?: string; cost_usd?: number; duration_s?: number };
          return (
            <article className="msg" key={m.id} data-c={p?.color || "other"}>
              <div className="mh">
                {p && <span style={{ display: "flex", gap: 6, alignItems: "center" }}><i className="dot" />{p.name}</span>}
                <span className={`mst ${cls}`}>{label}</span>
                <span>{m.mode === "build" ? "build" : "discuss"}{m.review_id ? " · on a review" : ""}</span>
                <span>{mounted ? ago(m.created_at) : ""}</span>
                {meta.duration_s ? <span>{Math.round(meta.duration_s / 60) || "<1"} min</span> : null}
                <button className="x" onClick={() => start(() => archiveMessage(m.id))}>Hide</button>
              </div>
              <div className="q">{m.text}</div>
              {m.reply && <div className="a" style={{ whiteSpace: "pre-wrap" }}>{m.reply}</div>}
              {meta.pr_url && <div className="a"><a href={meta.pr_url} target="_blank" rel="noopener noreferrer">Pull request: {meta.pr_url.replace("https://github.com/", "")} ↗</a> · not merged, review it on GitHub</div>}
            </article>
          );
        })}
      </div>
    </section>
  );
}
