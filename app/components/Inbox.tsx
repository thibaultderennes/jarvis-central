"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { archiveMessage, laterMessage, markOpened, markTreated, markUnread, sendMessage } from "@/lib/actions";
import type { Message } from "@/lib/data";
import { bundles, handled, inFlight, kindLabel, laneOf, LANES, laterUntil, summaryOf, tomorrowMorning, type Lane } from "@/lib/inboxLanes";
import { Ack, enterSends, useSubmit } from "./Submit";
import { EmptyArt } from "./brand";
import { isTyping } from "./keys";
import "./inbox.css";

type P = { id: string; name: string; color: string };
const ST: Record<string, [string, string]> = {
  new: ["Waiting for the Mac worker", "wait"], seen: ["Picked up", "wait"], working: ["Working…", "wait"],
  answered: ["Answered", "ok"], done: ["Done", "ok"], needs_you: ["Needs you", "err"], error: ["Failed", "err"],
};
const ago = (t: string) => { const m = Math.round((Date.now() - +new Date(t)) / 6e4); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };
type View = "open" | "later" | "handled";
type Thread = { root: Message; turns: Message[]; last: Message; lane: Lane; summary: string; later: string | null; handled: boolean };
const SWIPE = 80; // px of horizontal travel that commits a swipe
const EMPTY: Record<Lane, string> = {
  needs: "Nothing needs you. When Claude stops for a decision, it lands here.",
  shipped: "No pull requests waiting to be read.",
  reports: "No new reports.",
  fyi: "No notes to read.",
  claude: "Nothing is with Claude right now.",
};

/**
 * Conversations in five lanes (lib/inboxLanes.ts), bundled by project, one line each. Expanding a line shows the whole
 * thread and counts as opened. "Got it" (e, swipe right) treats it; "Later" (h, swipe left) hides it until tomorrow
 * morning. Treated and later conversations stay reachable under each lane.
 */
export default function Inbox({ messages, projects, defaultProject, workerAt }: { messages: Message[]; projects: P[]; defaultProject: string; workerAt: string | null }) {
  const router = useRouter();
  const [text, setText] = useState(""), [proj, setProj] = useState(defaultProject);
  const [, start] = useTransition();
  const s = useSubmit(), pending = s.pending;
  const [mounted, setMounted] = useState(false);
  const pmap = Object.fromEntries(projects.map((p) => [p.id, p]));
  const busy = messages.some(inFlight);
  useEffect(() => setMounted(true), []);
  // While something is in flight, refresh every 10 s so replies appear without reloading.
  useEffect(() => { if (!busy) return; const t = setInterval(() => router.refresh(), 10000); return () => clearInterval(t); }, [busy, router]);
  // Conversations: a first message plus its replies, newest activity first. A thread's lane follows its latest turn.
  const byRoot = new Map<string, Message[]>();
  for (const m of [...messages].sort((x, y) => x.created_at.localeCompare(y.created_at))) {
    const k = m.thread_id || m.id;
    if (!byRoot.has(k)) byRoot.set(k, []);
    byRoot.get(k)!.push(m);
  }
  const threads: Thread[] = [...byRoot.values()].filter((t) => !t[0].thread_id) // the root must be loaded
    .map((turns) => { const root = turns[0], last = turns[turns.length - 1]; return { root, turns, last, lane: laneOf(root, last), summary: summaryOf(last, root), later: laterUntil(last), handled: handled(last) }; })
    .sort((a, b) => b.last.created_at.localeCompare(a.last.created_at));
  const viewOf = (t: Thread): View => (t.handled ? "handled" : t.later ? "later" : "open");
  const count = (l: Lane, v: View = "open") => threads.filter((t) => t.lane === l && viewOf(t) === v).length;

  const [lane, setLane] = useState<Lane>(() => LANES.find((l) => count(l.id))?.id || "needs");
  const [view, setView] = useState<View>("open");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [seen, setSeen] = useState<Set<string>>(() => new Set()); // opened in this visit, before the server says so
  const [focus, setFocus] = useState<string | null>(null);
  const [replyFor, setReplyFor] = useState<string | null>(null);

  const shown = threads.filter((t) => t.lane === lane && viewOf(t) === view);
  const groups = bundles(shown);
  const flat = groups.flatMap((g) => g.threads);
  const unread = (t: Thread) => !!t.last.reply && !t.last.opened_at && !seen.has(t.last.id) && !t.handled;

  const toggle = (t: Thread, force?: boolean) => {
    const open = force ?? !expanded.has(t.root.id);
    setExpanded((x) => { const n = new Set(x); if (open) n.add(t.root.id); else n.delete(t.root.id); return n; });
    if (open && unread(t)) { setSeen((x) => new Set(x).add(t.last.id)); markOpened([t.last.id]).catch(() => {}); }
  };
  // After a line leaves the list, focus moves to the one below it (or above, at the end).
  const stepPast = (ids: string[]) => {
    const rest = flat.filter((t) => !ids.includes(t.root.id)), i = flat.findIndex((t) => t.root.id === focus);
    if (!focus || !ids.includes(focus)) return;
    setFocus(rest[Math.min(Math.max(i, 0), rest.length - 1)]?.root.id || null);
  };
  const gotIt = (t: Thread) => { if (inFlight(t.last) || t.handled) return; stepPast([t.root.id]); start(() => markTreated(t.last.id, true)); };
  // Bulk "Got it" (a project bundle, ⇧E, or the whole lane) shows a short Undo.
  const [undo, setUndo] = useState<{ ids: string[]; label: string } | null>(null);
  useEffect(() => { if (!undo) return; const t = setTimeout(() => setUndo(null), 8000); return () => clearTimeout(t); }, [undo]);
  const plural = (n: number) => `${n} conversation${n === 1 ? "" : "s"}`;
  const gotItAll = (ts: Thread[]) => {
    const ok = ts.filter((t) => !inFlight(t.last) && !t.handled); if (!ok.length) return;
    stepPast(ok.map((t) => t.root.id));
    start(async () => {
      const r = await markTreated(ok.map((t) => t.last.id), true).catch(() => null);
      setUndo(r ? (r.ids.length ? { ids: r.ids, label: `Got it: ${plural(r.ids.length)}` } : null) : { ids: [], label: "Couldn't mark them: check your connection and try again." });
    });
  };
  const restore = () => { const ids = undo?.ids || []; setUndo(null); if (ids.length) start(async () => { await markTreated(ids, false).catch(() => {}); }); };
  const later = (t: Thread) => { if (t.handled) return; stepPast([t.root.id]); start(async () => { await laterMessage(t.last.id, t.later ? null : tomorrowMorning().toISOString()); }); };
  const back = (t: Thread) => { stepPast(t.handled || t.later ? [t.root.id] : []); setSeen((x) => { const n = new Set(x); n.delete(t.last.id); return n; }); start(() => markUnread(t.last.id)); };
  const reply = (t: Thread) => { toggle(t, true); setReplyFor(t.root.id); };
  const pickLane = (l: Lane) => { setLane(l); setView("open"); setFocus(null); };

  // Keyboard: j/k move, o open, e got it, ⇧E got it for the project, r reply, h later, u unread, 1–5 lanes.
  const keys = useRef({ flat, focus, groups, toggle, gotIt, gotItAll, later, back, reply, pickLane });
  useEffect(() => { keys.current = { flat, focus, groups, toggle, gotIt, gotItAll, later, back, reply, pickLane }; });
  useEffect(() => {
    let gAt = 0; // "g" starts a page jump (Shortcuts.tsx): the next letter is not ours
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || e.defaultPrevented || e.isComposing || isTyping(e.target)) return;
      if (document.querySelector(".cmdk, .keys-sheet")) return;
      if (e.key === "g" && !e.shiftKey) { gAt = Date.now(); return; }
      if (Date.now() - gAt < 1500) { gAt = 0; return; }
      const k = keys.current, i = k.flat.findIndex((t) => t.root.id === k.focus), cur = i >= 0 ? k.flat[i] : null;
      const go = (j: number) => { const t = k.flat[Math.max(0, Math.min(k.flat.length - 1, j))]; if (t) setFocus(t.root.id); };
      const n = "12345".indexOf(e.key);
      if (n >= 0 && !e.shiftKey) { e.preventDefault(); k.pickLane(LANES[n].id); return; }
      const act: Record<string, () => void> = {
        j: () => go(i + 1), k: () => go(i < 0 ? 0 : i - 1),
        o: () => cur && k.toggle(cur), e: () => cur && k.gotIt(cur),
        E: () => { if (cur) k.gotItAll(k.groups.find((g) => g.threads.includes(cur))!.threads); },
        r: () => cur && k.reply(cur), h: () => cur && k.later(cur), u: () => cur && k.back(cur),
      };
      const f = act[e.key];
      if (f) { e.preventDefault(); f(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // The focused line takes the browser focus too, so screen readers follow j/k and Enter opens it.
  useEffect(() => {
    if (!focus) return;
    const el = document.getElementById(`ib-${focus}`);
    if (el && document.activeElement !== el && !isTyping(document.activeElement)) { el.focus({ preventScroll: true }); el.scrollIntoView({ block: "nearest" }); }
  }, [focus]);

  const offline = mounted && (!workerAt || Date.now() - +new Date(workerAt) > 5 * 60_000);
  const send = (mode: "discuss" | "build") => {
    const v = text.trim(); if (!v || s.pending) return;
    s.submit(() => sendMessage(v, proj || null, { mode }), { ok: "Sent", onOk: () => { setText(""); pickLane("claude"); } });
  };
  const nLater = count(lane, "later"), nHandled = count(lane, "handled");
  const laneAll = view === "open" && lane !== "claude" ? shown.filter((t) => !inFlight(t.last)) : [];
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
      <div className="ib-lanes">
        <div className="chips" role="tablist" aria-label="Inbox lanes">
          {LANES.map((l, i) => <button key={l.id} role="tab" className="chip" aria-pressed={lane === l.id} aria-selected={lane === l.id} title={`${l.hint} (key ${i + 1})`} onClick={() => pickLane(l.id)}>{l.label} ({count(l.id)})</button>)}
        </div>
        {(nLater > 0 || nHandled > 0 || view !== "open") && (
          <div className="ib-views" role="group" aria-label="Show">
            {view !== "open" && <button className="more" onClick={() => { setView("open"); setFocus(null); }}>Back to the lane</button>}
            {view !== "later" && nLater > 0 && <button className="more" onClick={() => { setView("later"); setFocus(null); }}>Later ({nLater})</button>}
            {view !== "handled" && nHandled > 0 && <button className="more" onClick={() => { setView("handled"); setFocus(null); }}>Got it ({nHandled})</button>}
            {laneAll.length > 1 && <button className="more" onClick={() => gotItAll(laneAll)}>Got it for all {laneAll.length} in {LANES.find((l) => l.id === lane)!.label}</button>}
          </div>
        )}
      </div>
      <p className="ib-keys" aria-label="Keyboard shortcuts">
        <kbd>j</kbd><kbd>k</kbd> move · <kbd>o</kbd> open · <kbd>e</kbd> got it · <kbd>⇧E</kbd> got it for the project · <kbd>r</kbd> reply · <kbd>h</kbd> later · <kbd>u</kbd> unread · <kbd>1</kbd>–<kbd>5</kbd> lanes
      </p>
      <div>
        {!messages.length && <div className="empty"><EmptyArt kind="inbox" /><b>No messages yet.</b></div>}
        {messages.length > 0 && !shown.length && <div className="empty">{view === "later" ? "Nothing put off for later." : view === "handled" ? "Nothing marked got it yet." : EMPTY[lane]}</div>}
        {groups.map((g) => {
          const p = g.project_id ? pmap[g.project_id] : null;
          const canAll = view === "open" && g.threads.some((t) => !inFlight(t.last));
          return (
            <section className="ib-bundle" key={g.project_id || "-"} data-c={p?.color || "other"} aria-label={p?.name || "Everything"}>
              <div className="ib-bh">
                <i className="dot" /><span>{p?.name || "Everything / planning"}</span><span className="ib-n">{g.threads.length}</span>
                <span className="sp" />
                {canAll && g.threads.length > 1 && <button className="x" onClick={() => gotItAll(g.threads)} title="Shift+E">Got it for all {g.threads.length}</button>}
              </div>
              <ul className="ib-list">
                {g.threads.map((t) => <Row key={t.root.id} t={t} view={view} mounted={mounted} open={expanded.has(t.root.id)} focused={focus === t.root.id} unread={unread(t)}
                  replyOpen={replyFor === t.root.id} setReplyOpen={(v) => setReplyFor(v ? t.root.id : null)}
                  onFocus={() => setFocus(t.root.id)} onToggle={() => toggle(t)} onGotIt={() => gotIt(t)} onLater={() => later(t)} onBack={() => back(t)}
                  onHide={() => { stepPast([t.root.id]); start(() => archiveMessage(t.root.id)); }} />)}
              </ul>
            </section>
          );
        })}
      </div>
      {undo && (
        <div className="toast" role="status">
          <span>{undo.label}</span>
          {undo.ids.length > 0 && <button type="button" onClick={restore}>Undo</button>}
          <button type="button" aria-label="Dismiss" onClick={() => setUndo(null)}>✕</button>
        </div>
      )}
    </section>
  );
}

type RowProps = {
  t: Thread; view: View; mounted: boolean; open: boolean; focused: boolean; unread: boolean; replyOpen: boolean; setReplyOpen: (v: boolean) => void;
  onFocus: () => void; onToggle: () => void; onGotIt: () => void; onLater: () => void; onBack: () => void; onHide: () => void;
};
/** One line per conversation; swipe right = got it, left = later (touch only). */
function Row({ t, view, mounted, open, focused, unread, replyOpen, setReplyOpen, onFocus, onToggle, onGotIt, onLater, onBack, onHide }: RowProps) {
  const { root, turns, last } = t;
  const [dx, setDx] = useState(0);
  const drag = useRef<{ x: number; y: number; on: boolean } | null>(null), swiped = useRef(false);
  const flying = inFlight(last);
  const [label, cls] = ST[last.status] || [last.status, ""];
  const canSwipe = view !== "handled" && !flying;
  const down = (e: React.PointerEvent) => { if (e.pointerType === "touch" && canSwipe) drag.current = { x: e.clientX, y: e.clientY, on: false }; };
  const move = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    const x = e.clientX - d.x, y = e.clientY - d.y;
    if (!d.on) {
      if (Math.abs(y) > 12) { drag.current = null; return; }
      if (Math.abs(x) <= 12) return;
      d.on = true; e.currentTarget.setPointerCapture(e.pointerId);
    }
    setDx(Math.max(-SWIPE * 1.5, Math.min(SWIPE * 1.5, x)));
  };
  const up = () => {
    const d = drag.current; drag.current = null;
    if (d?.on) { swiped.current = true; setTimeout(() => { swiped.current = false; }, 300); if (dx >= SWIPE) onGotIt(); else if (dx <= -SWIPE) onLater(); }
    setDx(0);
  };
  // A swipe ends with a click on the line: it must not also open it.
  const noClick = (e: React.MouseEvent) => { if (swiped.current) { swiped.current = false; e.preventDefault(); e.stopPropagation(); } };
  return (
    <li className="ib-row" data-focus={focused || undefined} data-open={open || undefined}>
      <div className="ib-track">
        {dx !== 0 && <span className="ib-swipe" data-dir={dx > 0 ? "r" : "l"} aria-hidden="true">{dx > 0 ? "Got it" : view === "later" ? "Back now" : "Later"}</span>}
        <div className="ib-line" style={dx ? { transform: `translateX(${dx}px)` } : undefined} data-drag={dx !== 0 || undefined}
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { drag.current = null; setDx(0); }} onClickCapture={noClick}>
          <button id={`ib-${root.id}`} className="ib-open" aria-expanded={open} onClick={onToggle} onFocus={onFocus} data-unread={unread || undefined}>
            <span className="pill">{kindLabel(root)}</span>
            <span className="ib-sum">{unread && <span className="ib-new">Unread: </span>}{t.summary || "(empty)"}</span>
          </button>
          {(flying || ["needs_you", "error"].includes(last.status)) && <span className={`mst ${cls} ib-st`}>{label}</span>}
          <span className="ib-when">{mounted ? (t.later && view === "later" ? `back ${new Date(t.later).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}` : ago(last.created_at)) : ""}</span>
          <span className="ib-acts">
            {view === "handled" ? <button className="x" onClick={onBack} title="u">Back</button> : <>
              {!flying && <button className="x" onClick={onGotIt} title="e">Got it</button>}
              <button className="x" onClick={onLater} title="h">{view === "later" ? "Back now" : "Later"}</button>
            </>}
          </span>
        </div>
      </div>
      {open && (
        <div className="ib-body">
          <div className="mh">
            <span>{kindLabel(root)}{root.review_id ? " · on a review" : ""}{root.item_id ? ` · item ${root.item_id}` : ""}</span>
            {turns.length > 1 && <span>{turns.length} messages</span>}
            <span className="sp" />
            {!t.handled && !flying && last.reply &&<button className="x" onClick={onBack} title="u">Mark unread</button>}
            {!root.archived && <button className="x" onClick={onHide}>Hide</button>}
          </div>
          {turns.map((m) => <Turn key={m.id} m={m} mounted={mounted} />)}
          <Reply rootId={root.id} projectId={root.project_id} open={replyOpen} setOpen={setReplyOpen} />
        </div>
      )}
    </li>
  );
}

function Turn({ m, mounted }: { m: Message; mounted: boolean }) {
  const [label, cls] = ST[m.status] || [m.status, ""];
  const meta = m.meta as { pr_url?: string; duration_s?: number };
  return (
    <div className="turn" style={{ display: "flex", flexDirection: "column", gap: "var(--s-2)" }}>
      <div className="q">{m.thread_id && <span className="pill" style={{ marginRight: "var(--s-2)" }}>{m.mode === "build" ? "build" : "you"}</span>}{m.text}</div>
      {m.reply ? <div className="a" style={{ whiteSpace: "pre-wrap" }}>{m.reply}</div>
        : <div className={`mst ${cls}`} style={{ fontFamily: "var(--mono)", fontSize: 11 }}>{label}{mounted && meta.duration_s ? ` · ${Math.round(meta.duration_s / 60) || "<1"} min` : ""}</div>}
      {meta.pr_url && <div className="a"><a href={meta.pr_url} target="_blank" rel="noopener noreferrer">Pull request: {meta.pr_url.replace("https://github.com/", "")} ↗</a> · {m.item_id ? "approve it from the checklist item" : "not merged, review it on GitHub"}</div>}
    </div>
  );
}

/** Reply inside a conversation: Claude gets the whole thread before answering. Opened by the button or the r key. */
function Reply({ rootId, projectId, open, setOpen }: { rootId: string; projectId: string | null; open: boolean; setOpen: (v: boolean) => void }) {
  const [text, setText] = useState("");
  const s = useSubmit(), pending = s.pending;
  if (!open) return <span className="crow"><button className="more" style={{ alignSelf: "flex-start" }} onClick={() => { s.clear(); setOpen(true); }} title="r">Reply</button>{s.ok && <Ack s={s} />}</span>;
  const send = (mode: "discuss" | "build") => {
    const v = text.trim(); if (!v || s.pending) return;
    s.submit(() => sendMessage(v, projectId, { mode, thread_id: rootId }), { ok: "Sent", onOk: () => { setText(""); setOpen(false); } });
  };
  return (
    <form className="composer" style={{ padding: 0, border: 0 }} onSubmit={(e) => { e.preventDefault(); send("discuss"); }}>
      <textarea id={`reply-${rootId}`} className="textarea" rows={2} autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Answer, push back, or ask for the next step…"
        onKeyDown={(e) => { if (e.key === "Escape") { setOpen(false); document.getElementById(`ib-${rootId}`)?.focus(); } else enterSends(e); }} title="Enter sends · Shift+Enter for a new line" />
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
