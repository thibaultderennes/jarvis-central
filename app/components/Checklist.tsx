"use client";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveBuild, cancelItem, commentItem, cycleItem, newItem, resetBuild, sendBackBuild, sendNote, setDue } from "@/lib/actions";
import { isOpen, type Item, type Section } from "@/lib/data";

// Owner values stored in the database: "founder" is you (the dashboard's owner), "claude", or "both".
const OWN: Record<string, string> = { founder: "you", claude: "Claude", both: "both" };
const addDays = (d: string, n: number) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const fmtWhen = (iso: string) => new Date(iso).toLocaleString("en-CA", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

/**
 * Filters are three independent groups, ANDed: scope (everything / yours / Claude's, single choice), flags (critical only,
 * show completed: independent toggles) and due range (single choice). Done and cancelled items are hidden until
 * "Show completed" is on. The selection is remembered per project in this browser.
 */
type Filters = { cat: string; crit: boolean; showDone: boolean; own: "" | "founder" | "claude"; when: "any" | "overdue" | "week" | "2w" };
const defaults = (showDone: boolean): Filters => ({ cat: "", crit: false, showDone, own: "", when: "any" });

export default function Checklist({ projectId, sections: given, items, today, showDoneDefault = false }: { projectId: string; sections: Section[]; items: Item[]; today: string; showDoneDefault?: boolean }) {
  // Items can use a section the project doesn't declare (added by Claude or an import): show those too, never hide items.
  const sections = useMemo((): Section[] => {
    const known = new Set(given.map((s) => s.id));
    const extra = [...new Set(items.map((i) => i.section))].filter((s) => !known.has(s)).map((id): Section => ({ id, name: id.charAt(0).toUpperCase() + id.slice(1) }));
    const all = [...given, ...extra];
    return all.length ? all : [{ id: "todo", name: "To do" }];
  }, [given, items]);
  const [list, setList] = useState(items);
  useEffect(() => setList(items), [items]);
  const router = useRouter();
  const busy = items.some((i) => i.refine === "pending" || i.build_status === "working" || i.build_status === "merge_requested" || i.build_status === "sent_back" || (i.status === "doing" && (i.owner === "claude" || i.owner === "both") && !i.build_status));
  // While Claude is refining, reading a comment or building, refresh so the changes appear on their own.
  useEffect(() => { if (!busy) return; const t = setInterval(() => router.refresh(), 10000); return () => clearInterval(t); }, [busy, router]);
  const [, start] = useTransition();
  const [err, setErr] = useState("");
  const [f, setF] = useState<Filters>(() => defaults(showDoneDefault));
  const storeKey = `jarvis.filters.${projectId}`;
  useEffect(() => { try { const v = localStorage.getItem(storeKey); if (v) setF({ ...defaults(showDoneDefault), ...JSON.parse(v) }); } catch { /* private mode: keep the defaults */ } }, [storeKey, showDoneDefault]);
  const setFilters = (next: Filters) => { setF(next); try { localStorage.setItem(storeKey, JSON.stringify(next)); } catch { /* ignore */ } };
  // A link to #item-<id> (from the stats panel) opens the list with everything shown, then scrolls to that item.
  const [target, setTarget] = useState(""), jumped = useRef(false);
  useEffect(() => {
    const id = location.hash.startsWith("#item-") ? decodeURIComponent(location.hash.slice(6)) : "";
    if (jumped.current || !id || !items.some((i) => i.id === id)) return;
    jumped.current = true; setF(defaults(true)); setTarget(id);
  }, [items]);
  useEffect(() => { if (target) { document.getElementById(`item-${target}`)?.scrollIntoView({ block: "center" }); setTarget(""); } }, [target]);
  const run = (fn: () => Promise<unknown>) => start(async () => { try { setErr(""); await fn(); } catch { setErr("Couldn't save that. Try again."); } });
  const win = useMemo(() => {
    switch (f.when) {
      case "overdue": return { to: addDays(today, -1), overdue: true };
      case "week": return { from: today, to: addDays(today, 6) };
      case "2w": return { from: today, to: addDays(today, 13) };
      default: return null;
    }
  }, [f.when, today]);
  const keep = (i: Item) => {
    if (f.crit && !i.critical) return false;
    if (!f.showDone && !isOpen(i)) return false;
    if (f.own && !(i.owner === f.own || i.owner === "both" || (f.own === "founder" && !i.owner))) return false;
    if (win) { if (!i.due) return false; if (win.overdue && !isOpen(i)) return false; if ("from" in win && win.from && i.due < win.from) return false; if (i.due > win.to) return false; }
    return true;
  };
  const cycle = (i: Item) => {
    const next = ({ todo: "doing", doing: "done", done: "todo", cancelled: "todo" } as const)[i.status];
    setList((l) => l.map((x) => (x.id === i.id ? { ...x, status: next } : x)));
    run(() => cycleItem(projectId, i.id));
  };
  const closed = list.filter((i) => !isOpen(i)).length;
  const shown = list.filter(keep).length;
  const active = !!f.cat || f.crit || f.showDone !== showDoneDefault || !!f.own || f.when !== "any";
  const chip = (label: string, on: boolean, click: () => void, title?: string) => <button key={label} className="chip" aria-pressed={on} onClick={click} title={title}>{label}</button>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div className="summary" role="group" aria-label="Filter by section">
        {sections.map((s) => {
          const its = list.filter((i) => i.section === s.id && i.status !== "cancelled"), d = its.filter((i) => i.status === "done").length, g = its.filter((i) => i.status === "doing").length, n = its.length || 1;
          return (
            <button key={s.id} className="sum" aria-pressed={f.cat === s.id} onClick={() => setFilters({ ...f, cat: f.cat === s.id ? "" : s.id })}>
              <span className="k"><span>{s.name}</span><span className="n">{d}/{its.length}</span></span>
              <span className="bar"><i className="d" style={{ width: `${(d / n) * 100}%` }} /><i className="g" style={{ width: `${(g / n) * 100}%` }} /></span>
            </button>
          );
        })}
      </div>
      <div className="filters" role="group" aria-label="Filters">
        <div className="fgroup" role="group" aria-label="Whose">
          {chip("Everything", !f.own, () => setFilters({ ...f, own: "" }))}
          {chip("Yours", f.own === "founder", () => setFilters({ ...f, own: f.own === "founder" ? "" : "founder" }))}
          {chip("Claude's", f.own === "claude", () => setFilters({ ...f, own: f.own === "claude" ? "" : "claude" }))}
        </div>
        <div className="fgroup" role="group" aria-label="Flags">
          {chip("Critical only", f.crit, () => setFilters({ ...f, crit: !f.crit }))}
          {chip(`Show completed${closed ? ` (${closed})` : ""}`, f.showDone, () => setFilters({ ...f, showDone: !f.showDone }), "Done and cancelled items")}
        </div>
        <div className="fgroup" role="group" aria-label="Due">
          <span className="lbl">Due</span>
          {([["any", "Any date"], ["overdue", "Overdue"], ["week", "Next 7 days"], ["2w", "Next 14 days"]] as const).map(([k, l]) => chip(l, f.when === k, () => setFilters({ ...f, when: k })))}
        </div>
        <span className="fend">
          {active && <button className="more" onClick={() => setFilters(defaults(showDoneDefault))}>Reset filters</button>}
          <span className="due">{shown} of {list.length} shown</span>
        </span>
      </div>
      {err && <div className="due late" role="alert">{err}</div>}
      {sections.filter((s) => !f.cat || f.cat === s.id).map((s) => {
        const all = list.filter((i) => i.section === s.id);
        let its = all.filter(keep).sort((a, b) => a.sort - b.sort);
        if (win) its = its.sort((a, b) => (a.due || "9").localeCompare(b.due || "9"));
        const hiddenClosed = all.filter((i) => !isOpen(i) && !keep(i)).length;
        return (
          <section className="cat" key={s.id}>
            <div className="cat-h"><h2>{s.name}</h2>{s.note && <p>{s.note}</p>}</div>
            <div className="list">
              {!its.length && (
                <div className="empty">
                  {!all.length ? "Nothing here yet." : hiddenClosed === all.length ? <>All {all.length} done or cancelled. <button className="more" onClick={() => setFilters({ ...f, showDone: true })}>Show completed</button></> : "Nothing here with these filters."}
                </div>
              )}
              {its.map((i) => <Row key={i.id} i={i} s={s} today={today} onCycle={() => cycle(i)} run={run} projectId={projectId} />)}
              {its.length > 0 && hiddenClosed > 0 && <div className="empty" style={{ padding: "8px 14px" }}>{hiddenClosed} completed hidden · <button className="more" onClick={() => setFilters({ ...f, showDone: true })}>Show completed</button></div>}
              <AddRow projectId={projectId} section={s} run={run} today={today} />
            </div>
          </section>
        );
      })}
    </div>
  );
}

function Row({ i, s, today, onCycle, run, projectId }: { i: Item; s: Section; today: string; onCycle: () => void; run: (fn: () => Promise<unknown>) => void; projectId: string }) {
  const [open, setOpen] = useState(false);
  const long = i.detail.length > 170 || i.detail.includes("\n");
  const late = i.due && isOpen(i) && i.due < today, soon = i.due && isOpen(i) && !late && i.due <= addDays(today, 2);
  const claudeOwned = i.owner === "claude" || i.owner === "both";
  return (
    <div id={`item-${i.id}`} className={`row${i.status === "done" ? " done" : ""}${i.status === "cancelled" ? " cancelled" : ""}${i.critical && isOpen(i) ? " crit-row" : ""}`}>
      <button className="st" data-s={i.status} onClick={onCycle} aria-label={`${i.title}: ${i.status}. Change status`}>{i.status === "done" ? "✓" : i.status === "doing" ? "◐" : i.status === "cancelled" ? "–" : ""}</button>
      <div style={{ minWidth: 0 }}>
        <div className="t">
          <span>{i.title}</span>
          <span className="pill code" title="Say this code to Claude to refer to the item">{i.id}</span>
          {i.owner && <span className={`pill${i.owner === "founder" ? " you" : ""}`}>{OWN[i.owner] || i.owner}</span>}
          {i.critical && isOpen(i) && <span className="pill crit">critical</span>}
          {i.priority === 1 && !i.critical && <span className="pill crit">high</span>}
          {i.priority === 3 && <span className="pill">low</span>}
          {i.estimate_minutes ? <span className="pill" title="Estimated time">~{i.estimate_minutes >= 60 ? `${Math.round(i.estimate_minutes / 30) / 2} h` : `${i.estimate_minutes} min`}</span> : null}
          {i.status === "cancelled" && <span className="pill" title={i.cancel_reason || "Cancelled"}>cancelled{i.duplicate_of ? ` · duplicate of ${i.duplicate_of}` : ""}</span>}
          {i.refine === "pending" && <span className="pill go" title={i.refine_request ? "Claude is reading your comment and will adjust the item" : "Claude is reading this item and will add steps, a priority, an estimate and a due date that doesn't clash"}>{i.refine_request ? "reading your comment…" : "refining…"}</span>}
          {i.refine === "done" && <span className="pill" title={i.refine_note || "Refined by Claude"}>refined by Claude</span>}
          {i.refine === "flagged" && <span className="pill crit" title={i.refine_note}>check: overlaps</span>}
          {claudeOwned && i.status === "doing" && !i.build_status && <span className="pill go" title="The Mac worker starts building this within a minute">go given · queued</span>}
          {i.build_status === "working" && <span className="pill go">Claude is building…</span>}
          {i.build_status === "pr_open" && <span className="pill go">PR ready for you</span>}
          {i.build_status === "merge_requested" && <span className="pill go">merging…</span>}
          {i.build_status === "merged" && <span className="pill">merged</span>}
          {i.build_status === "sent_back" && <span className="pill go">sent back · Claude continues</span>}
          {i.build_status === "failed" && <span className="pill crit" title={i.build_note}>build failed</span>}
        </div>
        {i.detail && <div className={`dt${long && !open ? " collapsed" : ""}`}>{i.detail}</div>}
        {i.pr_url && <Build i={i} run={run} projectId={projectId} />}
        {i.build_status === "failed" && !i.pr_url && <Build i={i} run={run} projectId={projectId} />}
        <button className="more" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Show less" : long ? "Show more" : "Comment"}</button>
        {open && <Comment i={i} run={run} projectId={projectId} />}
        {(s.notes || i.note) && <Note i={i} run={run} projectId={projectId} />}
      </div>
      <div className="rowside">
        <input type="date" className={`duein due${late ? " late" : soon ? " soon" : ""}`} value={i.due || ""} aria-label={`Due date for ${i.title}`}
          onChange={(e) => run(() => setDue(projectId, i.id, e.target.value || null))} />
      </div>
    </div>
  );
}

/** The PR of a build run, with the only two things the owner does here: approve (the worker merges) or send it back. */
function Build({ i, run, projectId }: { i: Item; run: (fn: () => Promise<unknown>) => void; projectId: string }) {
  const [back, setBack] = useState(false), [note, setNote] = useState("");
  const short = (i.pr_url || "").replace("https://github.com/", "");
  return (
    <div className="buildbar">
      {i.pr_url && <a href={i.pr_url} target="_blank" rel="noopener noreferrer">Pull request {short} ↗</a>}
      {i.build_status === "pr_open" && <span className={`due${i.build_note ? " late" : ""}`}>{i.build_note || "not merged · review it, then:"}</span>}
      {i.build_status === "merge_requested" && <span className="due">the Mac worker merges it within a minute</span>}
      {i.build_status === "merged" && <span className="due">merged{i.build_updated_at ? ` ${fmtWhen(i.build_updated_at)}` : ""}</span>}
      {i.build_status === "failed" && <span className="due late">{i.build_note || "The build run failed."}</span>}
      {i.build_status === "sent_back" && <span className="due">Claude is continuing on this branch{i.build_note ? `: ${i.build_note}` : ""}</span>}
      {i.build_status === "pr_open" && !back && <>
        <button className="btn sm" onClick={() => run(() => approveBuild(projectId, i.id))}>Approve &amp; merge</button>
        <button className="btn sm ghost" onClick={() => setBack(true)}>Send back</button>
      </>}
      {i.build_status === "failed" && !back && <>
        <button className="btn sm" onClick={() => run(() => resetBuild(projectId, i.id))}>Retry</button>
        {i.pr_url && <button className="btn sm ghost" onClick={() => setBack(true)}>Send back with a note</button>}
      </>}
      {back && (
        <form className="addrow" style={{ width: "100%" }} onSubmit={(e) => { e.preventDefault(); setBack(false); run(() => sendBackBuild(projectId, i.id, note)); setNote(""); }}>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} autoFocus aria-label="What to change" placeholder="What should change? Claude continues on the same branch and PR." />
          <button className="btn sm" disabled={!note.trim()}>Send back</button>
          <button type="button" className="more" onClick={() => setBack(false)}>Cancel</button>
        </form>
      )}
    </div>
  );
}

/** The comment bar under an opened item: tell Claude what to change, cancel the item, or mark it a duplicate. */
function Comment({ i, run, projectId }: { i: Item; run: (fn: () => Promise<unknown>) => void; projectId: string }) {
  const [t, setT] = useState("");
  const [cancelling, setCancelling] = useState(false), [reason, setReason] = useState(""), [dup, setDup] = useState("");
  const pending = i.refine === "pending" && !!i.refine_request;
  return (
    <div className="comment">
      {pending && <div className="said"><span className="lbl">Your comment</span> {i.refine_request}<span className="due"> · Claude is reading it…</span></div>}
      {!pending && i.refine_note && <div className="said"><span className="lbl">Claude</span> {i.refine_note}</div>}
      {i.status === "cancelled" && <div className="said"><span className="lbl">Cancelled</span> {i.cancel_reason || "No reason given."}{i.duplicate_of ? ` Duplicate of ${i.duplicate_of}.` : ""} <button className="more" onClick={() => run(() => cycleItem(projectId, i.id))}>Reopen</button></div>}
      <form className="addrow" onSubmit={(e) => { e.preventDefault(); const v = t.trim(); if (!v) return; setT(""); run(() => commentItem(projectId, i.id, v)); }}>
        <input className="input" value={t} onChange={(e) => setT(e.target.value)} maxLength={2000} aria-label={`Comment on ${i.title}`}
          placeholder="Comment or ask for a change: split it, move it to Friday, it's blocked by…, add a step…" />
        <button className="btn sm" disabled={!t.trim()}>Send to Claude</button>
        {isOpen(i) && !cancelling && <button type="button" className="more" onClick={() => setCancelling(true)}>Cancel this item</button>}
      </form>
      {cancelling && (
        <form className="addrow" onSubmit={(e) => { e.preventDefault(); setCancelling(false); run(() => cancelItem(projectId, i.id, reason, dup.trim() || null)); }}>
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} autoFocus aria-label="Why cancel" placeholder="Why? (optional: no longer needed, superseded, duplicate…)" />
          <input className="input" value={dup} onChange={(e) => setDup(e.target.value)} maxLength={60} aria-label="Duplicate of item code" placeholder="Duplicate of (item code, optional)" style={{ flex: "0 1 220px" }} />
          <button className="btn sm">Cancel item</button>
          <button type="button" className="more" onClick={() => setCancelling(false)}>Keep it</button>
        </form>
      )}
    </div>
  );
}

/** The decision box: a draft stays here until "Send to Claude"; then it shows sent / read states. */
function Note({ i, run, projectId }: { i: Item; run: (fn: () => Promise<unknown>) => void; projectId: string }) {
  const draftKey = `jarvis.note.${projectId}.${i.id}`;
  const [note, setNote] = useState(i.note);
  const [sending, setSending] = useState(false);
  useEffect(() => { try { const d = localStorage.getItem(draftKey); setNote(d ?? i.note); } catch { setNote(i.note); } }, [i.note, draftKey]);
  const dirty = note.trim() !== i.note.trim();
  const readIt = !!i.note_sent_at && i.refine !== "pending" && !dirty;
  const sentNotRead = !!i.note_sent_at && i.refine === "pending" && !dirty;
  const change = (v: string) => { setNote(v); try { if (v.trim() !== i.note.trim()) localStorage.setItem(draftKey, v); else localStorage.removeItem(draftKey); } catch { /* ignore */ } };
  return (
    <div className="note">
      <label className="lbl" htmlFor={`note-${i.id}`}>Your answer (Claude reads it when you send it)</label>
      <textarea id={`note-${i.id}`} className="textarea" rows={2} value={note} placeholder="Your call, or a question back" onChange={(e) => change(e.target.value)} />
      <div className="crow" style={{ gap: 10 }}>
        <button className="btn sm" disabled={!dirty || !note.trim() || sending} onClick={() => { setSending(true); run(async () => { const r = await sendNote(projectId, i.id, note); setSending(false); if (r.error) throw new Error(r.error); try { localStorage.removeItem(draftKey); } catch { /* ignore */ } }); }}>
          {sending ? "Sending…" : "Send to Claude"}
        </button>
        <span className="due">
          {dirty ? "Draft, not sent" : sentNotRead ? `Sent ${fmtWhen(i.note_sent_at!)} · Claude has not read it yet` : readIt ? `Sent ${fmtWhen(i.note_sent_at!)} · Claude read it` : i.note ? "Saved" : ""}
        </span>
      </div>
    </div>
  );
}

function AddRow({ projectId, section, run, today }: { projectId: string; section: Section; run: (fn: () => Promise<unknown>) => void; today: string }) {
  const [t, setT] = useState(""), [d, setD] = useState(addDays(today, 7)), [msg, setMsg] = useState("");
  return (
    <form className="addrow" onSubmit={(e) => { e.preventDefault(); const v = t.trim(); if (!v) return; setMsg(""); run(async () => { const r = await newItem(projectId, section.id, v, d || null); if (r?.error) setMsg(r.error); else setT(""); }); }}>
      <input id={`add-${section.id}`} className="input" value={t} onChange={(e) => setT(e.target.value)} placeholder={`Add to ${section.name}…`} aria-label={`New ${section.name} item`} />
      <input className="input" type="date" value={d} onChange={(e) => setD(e.target.value)} aria-label="Due date" />
      <button className="btn sm">Add</button>
      {msg && <span className="due late" role="alert" style={{ flexBasis: "100%" }}>{msg}</span>}
    </form>
  );
}
