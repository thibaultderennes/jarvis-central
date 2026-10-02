"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { archiveMessage, markOpened, markTreated, sendMessage } from "@/lib/actions";
import { inboxGroup, type Message } from "@/lib/data";
import { Ack, enterSends, useSubmit } from "./Submit";

type P = { id: string; name: string; color: string };
const ST: Record<string, [string, string]> = {
  new: ["Waiting for the Mac worker", "wait"], seen: ["Picked up", "wait"], working: ["Working…", "wait"],
  answered: ["Answered", "ok"], done: ["Done", "ok"], needs_you: ["Needs you", "err"], error: ["Failed", "err"],
};
const ago = (t: string) => { const m = Math.round((Date.now() - +new Date(t)) / 6e4); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };
type Group = "new" | "pending" | "treated";
const GROUPS: [Group, string, string][] = [["new", "New", "Replies you haven't opened, and work still with Claude"], ["pending", "Pending", "Opened, not yet treated"], ["treated", "Treated", "Marked treated or hidden"]];

/**
 * Conversations in three groups. A reply moves from New to Pending once it has been on screen; "Mark treated"
 * moves it to Treated. Work still with Claude (new/seen/working) stays in New until it is answered.
 */
export default function Inbox({ messages, projects, defaultProject, workerAt }: { messages: Message[]; projects: P[]; defaultProject: string; workerAt: string | null }) {
  const router = useRouter();
  const [text, setText] = useState(""), [proj, setProj] = useState(defaultProject);
  const [, start] = useTransition();
  const s = useSubmit(), pending = s.pending;
  const [mounted, setMounted] = useState(false);
  const [tab, setTab] = useState<Group>("new");
  const pmap = Object.fromEntries(projects.map((p) => [p.id, p]));
  const busy = messages.some((m) => ["new", "seen", "working"].includes(m.status));
  useEffect(() => setMounted(true), []);
  // While something is in flight, refresh every 10 s so replies appear without reloading.
  useEffect(() => { if (!busy) return; const t = setInterval(() => router.refresh(), 10000); return () => clearInterval(t); }, [busy, router]);
  // Conversations: a first message plus its replies, newest activity first. A thread's group follows its latest turn.
  const byRoot = new Map<string, Message[]>();
  for (const m of [...messages].sort((x, y) => x.created_at.localeCompare(y.created_at))) {
    const k = m.thread_id || m.id;
    if (!byRoot.has(k)) byRoot.set(k, []);
    byRoot.get(k)!.push(m);
  }
  const threads = [...byRoot.values()].filter((t) => !t[0].thread_id) // the root must be loaded
    .map((turns) => ({ root: turns[0], turns, last: turns[turns.length - 1], group: inboxGroup(turns[turns.length - 1]) }))
    .sort((a, b) => b.last.created_at.localeCompare(a.last.created_at));
  const counts = { new: 0, pending: 0, treated: 0 };
  for (const t of threads) counts[t.group]++;
  // Replies now on screen count as opened: they move to Pending on the next render (after a short delay, so a glance isn't a read).
  const unopened = threads.filter((t) => t.group === "new" && !["new", "seen", "working"].includes(t.last.status)).map((t) => t.last.id).join(",");
  useEffect(() => {
    if (!unopened || tab !== "new") return;
    const t = setTimeout(() => markOpened(unopened.split(",")).catch(() => {}), 4000);
    return () => clearTimeout(t);
  }, [unopened, tab]);
  const offline = mounted && (!workerAt || Date.now() - +new Date(workerAt) > 5 * 60_000);
  const send = (mode: "discuss" | "build") => {
    const v = text.trim(); if (!v || s.pending) return;
    s.submit(() => sendMessage(v, proj || null, { mode }), { ok: "Sent", onOk: () => { setText(""); setTab("new"); } });
  };
  const shown = threads.filter((t) => t.group === tab);
  return (
    <section className="panel">
      <form className="composer" onSubmit={(e) => { e.preventDefault(); send("discuss"); }}>
        <label className="lbl" htmlFor="msg">Message</label>
        <textarea id="msg" className="textarea" rows={4} value={text} onChange={(e) => setText(e.target.value)}
          placeholder={"Plan my Tuesday around the 2 pm appointment · What should I cut this week? · Why is item r05 blocked? · Move the launch items one week"}
          onKeyDown={enterSends} title="Enter sends · Shift+Enter for a new line" />
        <div className="crow">
          <label className="lbl" htmlFor="msg-proj">About</label>
          <select id="msg-proj" className="select" value={proj} onChange={(e) => setProj(e.target.value)}>
            <option value="">Everything / planning</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <span className="sp" />
          <Ack s={s} busy="Sending…" />
          {offline && <span className="due late">{workerAt ? "The Mac worker is offline: it answers when your Mac wakes." : "The Mac worker isn't installed yet."}</span>}
          <button type="button" className="btn ghost" disabled={pending || !text.trim()} onClick={() => send("build")} title="Works on a new git branch and opens a pull request">Build it (PR)</button>
          <button className="btn" disabled={pending || !text.trim()}>{pending ? "Sending…" : "Ask / discuss"}</button>
        </div>
      </form>
      <div className="chips" role="tablist" aria-label="Inbox groups" style={{ padding: "10px 14px", borderBottom: "1px solid var(--line-2)" }}>
        {GROUPS.map(([g, label, hint]) => <button key={g} role="tab" className="chip" aria-pressed={tab === g} aria-selected={tab === g} title={hint} onClick={() => setTab(g)}>{label} ({counts[g]})</button>)}
      </div>
      <div>
        {!messages.length && <div className="empty">No messages yet.</div>}
        {messages.length > 0 && !shown.length && <div className="empty">{tab === "new" ? "Nothing new. Replies you opened are under Pending." : tab === "pending" ? "Nothing pending: every reply you opened is treated." : "Nothing treated yet."}</div>}
        {shown.map(({ root, turns, last, group }) => {
          const p = root.project_id ? pmap[root.project_id] : null;
          return (
            <article className="msg" key={root.id} data-c={p?.color || "other"}>
              <div className="mh">
                {p && <span style={{ display: "flex", gap: 6, alignItems: "center" }}><i className="dot" />{p.name}</span>}
                <span>{root.mode === "build" ? "build" : root.mode === "plan" ? "project plan" : (root.meta as { kind?: string }).kind === "refine" ? "new item" : (root.meta as { kind?: string }).kind === "comment" ? "your comment" : "discuss"}{root.review_id ? " · on a review" : ""}{root.item_id ? ` · item ${root.item_id}` : ""}</span>
                <span>{mounted ? ago(last.created_at) : ""}</span>
                {turns.length > 1 && <span>{turns.length} messages</span>}
                <span className="sp" />
                {group !== "treated" && !["new", "seen", "working"].includes(last.status) && <button className="x" onClick={() => start(() => markTreated(last.id, true))}>Mark treated</button>}
                {group === "treated" && last.treated_at && <button className="x" onClick={() => start(() => markTreated(last.id, false))}>Back to pending</button>}
                {!root.archived && <button className="x" onClick={() => start(() => archiveMessage(root.id))}>Hide</button>}
              </div>
              {turns.map((m) => <Turn key={m.id} m={m} mounted={mounted} />)}
              <Reply rootId={root.id} projectId={root.project_id} />
            </article>
          );
        })}
      </div>
    </section>
  );
}

function Turn({ m, mounted }: { m: Message; mounted: boolean }) {
  const [label, cls] = ST[m.status] || [m.status, ""];
  const meta = m.meta as { pr_url?: string; duration_s?: number };
  return (
    <div className="turn" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div className="q">{m.thread_id && <span className="pill" style={{ marginRight: 8 }}>{m.mode === "build" ? "build" : "you"}</span>}{m.text}</div>
      {m.reply ? <div className="a" style={{ whiteSpace: "pre-wrap" }}>{m.reply}</div>
        : <div className={`mst ${cls}`} style={{ fontFamily: "var(--mono)", fontSize: 11 }}>{label}{mounted && meta.duration_s ? ` · ${Math.round(meta.duration_s / 60) || "<1"} min` : ""}</div>}
      {meta.pr_url && <div className="a"><a href={meta.pr_url} target="_blank" rel="noopener noreferrer">Pull request: {meta.pr_url.replace("https://github.com/", "")} ↗</a> · {m.item_id ? "approve it from the checklist item" : "not merged, review it on GitHub"}</div>}
    </div>
  );
}

/** Reply inside a conversation: Claude gets the whole thread before answering. */
function Reply({ rootId, projectId }: { rootId: string; projectId: string | null }) {
  const [open, setOpen] = useState(false), [text, setText] = useState("");
  const s = useSubmit(), pending = s.pending;
  if (!open) return <span className="crow"><button className="more" style={{ alignSelf: "flex-start" }} onClick={() => { s.clear(); setOpen(true); }}>Reply</button>{s.ok && <Ack s={s} />}</span>;
  const send = (mode: "discuss" | "build") => {
    const v = text.trim(); if (!v || s.pending) return;
    s.submit(() => sendMessage(v, projectId, { mode, thread_id: rootId }), { ok: "Sent", onOk: () => { setText(""); setOpen(false); } });
  };
  return (
    <form className="composer" style={{ padding: 0, border: 0 }} onSubmit={(e) => { e.preventDefault(); send("discuss"); }}>
      <textarea id={`reply-${rootId}`} className="textarea" rows={2} autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Answer, push back, or ask for the next step…"
        onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); else enterSends(e); }} title="Enter sends · Shift+Enter for a new line" />
      <div className="crow">
        <button type="button" className="more" onClick={() => setOpen(false)}>Cancel</button>
        <span className="sp" />
        <Ack s={s} busy="Sending…" />
        <button type="button" className="btn ghost sm" disabled={pending || !text.trim()} onClick={() => send("build")}>Build it (PR)</button>
        <button className="btn sm" disabled={pending || !text.trim()}>{pending ? "Sending…" : "Reply"}</button>
      </div>
    </form>
  );
}
