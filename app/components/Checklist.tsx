"use client";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { approveBuild, cancelItem, commentItem, createSprint, editSprint, moveToSprint, newItem, removeSprint, resetBuild, sendBackBuild, sendNote, setBlockedBy, setDue, setItemStatus } from "@/lib/actions";
import { isOpen, type Item, type Section, type Sprint } from "@/lib/data";
import { Ack, enterSends, imeGuard, useSubmit } from "./Submit";
import { Icon } from "./icons";

// Owner values stored in the database: "founder" is you (the dashboard's owner), "claude", or "both".
const OWN: Record<string, string> = { founder: "you", claude: "Claude", both: "both" };
const addDays = (d: string, n: number) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const fmtWhen = (iso: string) => new Date(iso).toLocaleString("en-CA", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

/**
 * Filters live in the URL (?sec=…&own=…&due=…&crit=1&done=1), so a reload or a shared link keeps them; a bare link reopens
 * the ones last used on this project in this browser. AND across groups, OR within one: sections, whose (yours /
 * Claude's), due (overdue / next 7 days / next 14 days: open items only, undated items match none), critical. Done and
 * cancelled items are hidden until "Show completed" is on. "Today" comes from the server, in the configured timezone.
 */
type Own = "founder" | "claude";
type When = "overdue" | "week" | "2w";
type Filters = { sec: string[]; own: Own[]; due: When[]; crit: boolean; showDone: boolean; spr: string[] };
const KEYS = ["sec", "own", "due", "crit", "done", "spr"];
const WHEN: [When, string, string][] = [["overdue", "Overdue", "Open items due before today"], ["week", "Next 7 days", "Open items due today through 7 days from now"], ["2w", "Next 14 days", "Open items due today through 14 days from now"]];
const csv = (v: string | null) => (v || "").split(",").map((x) => x.trim()).filter(Boolean);
function parse(q: URLSearchParams, showDoneDefault: boolean): Filters {
  const d = q.get("done");
  return {
    sec: csv(q.get("sec")), own: csv(q.get("own")).filter((x): x is Own => x === "founder" || x === "claude"),
    due: csv(q.get("due")).filter((x): x is When => WHEN.some(([k]) => k === x)), crit: q.get("crit") === "1",
    showDone: d === "1" ? true : d === "0" ? false : showDoneDefault, spr: csv(q.get("spr")),
  };
}
function toQuery(f: Filters, showDoneDefault: boolean, base: string): string {
  const q = new URLSearchParams(base);
  for (const k of KEYS) q.delete(k);
  if (f.sec.length) q.set("sec", f.sec.join(","));
  if (f.own.length) q.set("own", f.own.join(","));
  if (f.due.length) q.set("due", f.due.join(","));
  if (f.crit) q.set("crit", "1");
  if (f.spr.length) q.set("spr", f.spr.join(","));
  if (f.showDone !== showDoneDefault) q.set("done", f.showDone ? "1" : "0");
  return q.toString();
}
const flip = <T,>(a: T[], v: T) => (a.includes(v) ? a.filter((x) => x !== v) : [...a, v]);
const goTo = (qs: string) => window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);

export default function Checklist({ projectId, sections: given, items, today, showDoneDefault = false, sprints = [], weeklyMinutes = null }: { projectId: string; sections: Section[]; items: Item[]; today: string; showDoneDefault?: boolean; sprints?: Sprint[]; weeklyMinutes?: number | null }) {
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
  const [fresh, setFresh] = useState("");
  useEffect(() => { if (!fresh) return; const t = setTimeout(() => setFresh(""), 10000); return () => clearTimeout(t); }, [fresh]);
  const sp = useSearchParams();
  const [jumpAll, setJumpAll] = useState(false);
  const f = useMemo((): Filters => (jumpAll ? { sec: [], own: [], due: [], crit: false, showDone: true, spr: [] } : parse(new URLSearchParams(sp.toString()), showDoneDefault)), [sp, showDoneDefault, jumpAll]);
  const storeKey = `jarvis.filters.${projectId}`;
  const setFilters = (next: Filters) => {
    setJumpAll(false);
    goTo(toQuery(next, showDoneDefault, window.location.search));
    try { localStorage.setItem(storeKey, toQuery(next, showDoneDefault, "")); } catch { /* private mode */ }
  };
  useEffect(() => {
    if (location.hash.startsWith("#item-") || KEYS.some((k) => new URLSearchParams(window.location.search).has(k))) return;
    try { const v = localStorage.getItem(storeKey); if (v && !v.startsWith("{")) goTo(toQuery(parse(new URLSearchParams(v), showDoneDefault), showDoneDefault, window.location.search)); } catch { /* ignore */ }
  }, [storeKey, showDoneDefault]);
  // A link to #item-<id> (from the stats panel) shows everything once, without saving that filter, then scrolls to the item.
  const [target, setTarget] = useState(""), jumped = useRef(false);
  useEffect(() => {
    const id = location.hash.startsWith("#item-") ? decodeURIComponent(location.hash.slice(6)) : "";
    if (jumped.current || !id || !items.some((i) => i.id === id)) return;
    jumped.current = true; setJumpAll(true); setTarget(id);
  }, [items]);
  useEffect(() => { if (target) { document.getElementById(`item-${target}`)?.scrollIntoView({ block: "center" }); setTarget(""); } }, [target]);
  const run = (fn: () => Promise<unknown>) => start(async () => { try { setErr(""); await fn(); } catch { setErr("Couldn't save that. Try again."); } });
  const in7 = addDays(today, 7), in14 = addDays(today, 14);
  const dated = (i: Item) => !!i.due && isOpen(i) && f.due.some((w) => (w === "overdue" ? i.due! < today : i.due! >= today && i.due! <= (w === "week" ? in7 : in14)));
  const keep = (i: Item) => {
    if (f.sec.length && !f.sec.includes(i.section)) return false;
    if (f.crit && !i.critical) return false;
    if (!f.showDone && !isOpen(i)) return false;
    if (f.own.length && !f.own.some((o) => i.owner === o || i.owner === "both" || (o === "founder" && !i.owner))) return false;
    if (f.due.length && !dated(i)) return false;
    if (f.spr.length && !f.spr.includes(i.sprint_id || "none")) return false;
    return true;
  };
  // One explicit status per click: the checkbox is done <-> todo, Start is doing (the go signal for Claude's items), Stop is todo.
  const setStatus = (i: Item, status: "todo" | "doing" | "done") => {
    setList((l) => l.map((x) => (x.id === i.id ? { ...x, status } : x)));
    run(() => setItemStatus(projectId, i.id, status));
  };
  const byId = useMemo(() => new Map(list.map((i) => [i.id, i])), [list]);
  const closed = list.filter((i) => !isOpen(i)).length;
  const shown = list.filter(keep).length;
  const active = f.sec.length > 0 || f.crit || f.showDone !== showDoneDefault || f.own.length > 0 || f.due.length > 0 || f.spr.length > 0;
  const clear = () => setFilters({ sec: [], own: [], due: [], crit: false, showDone: showDoneDefault, spr: [] });
  // Select mode: tick items, then Create sprint / Add to a sprint / Take out. Selection is cleared on leaving the mode.
  const [selecting, setSelecting] = useState(false);
  const [sel, setSel] = useState<string[]>([]);
  const toggleSel = (id: string) => setSel((x) => flip(x, id));
  const endSelect = () => { setSelecting(false); setSel([]); };
  const sprintById = useMemo(() => new Map(sprints.map((s) => [s.id, s])), [sprints]);
  const added = fresh ? list.find((i) => i.id === fresh) : undefined;
  const chip = (label: string, on: boolean, click: () => void, title?: string) => <button key={label} className="chip" aria-pressed={on} onClick={click} title={title}>{label}</button>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div className="summary" role="group" aria-label="Filter by section">
        {sections.map((s) => {
          const its = list.filter((i) => i.section === s.id && i.status !== "cancelled"), d = its.filter((i) => i.status === "done").length, g = its.filter((i) => i.status === "doing").length, n = its.length || 1;
          return (
            <button key={s.id} className="sum" aria-pressed={f.sec.includes(s.id)} onClick={() => setFilters({ ...f, sec: flip(f.sec, s.id) })}>
              <span className="k"><span>{s.name}</span><span className="n">{d}/{its.length}</span></span>
              <span className="bar"><i className="d" style={{ width: `${(d / n) * 100}%` }} /><i className="g" style={{ width: `${(g / n) * 100}%` }} /></span>
            </button>
          );
        })}
      </div>
      <div className="filters" role="group" aria-label="Filters">
        <div className="fgroup" role="group" aria-label="Whose">
          {chip("Everything", !f.own.length, () => setFilters({ ...f, own: [] }))}
          {chip("Yours", f.own.includes("founder"), () => setFilters({ ...f, own: flip(f.own, "founder") }))}
          {chip("Claude's", f.own.includes("claude"), () => setFilters({ ...f, own: flip(f.own, "claude") }))}
        </div>
        <div className="fgroup" role="group" aria-label="Flags">
          {chip("Critical only", f.crit, () => setFilters({ ...f, crit: !f.crit }))}
          {chip(`Show completed${closed ? ` (${closed})` : ""}`, f.showDone, () => setFilters({ ...f, showDone: !f.showDone }), "Done and cancelled items")}
        </div>
        <div className="fgroup" role="group" aria-label="Due">
          <span className="lbl">Due</span>
          {chip("Any date", !f.due.length, () => setFilters({ ...f, due: [] }))}
          {WHEN.map(([k, l, t]) => chip(l, f.due.includes(k), () => setFilters({ ...f, due: flip(f.due, k) }), t))}
        </div>
        {sprints.length > 0 && (
          <div className="fgroup" role="group" aria-label="Sprint">
            <span className="lbl">Sprint</span>
            {chip("Any", !f.spr.length, () => setFilters({ ...f, spr: [] }))}
            {sprints.filter((s) => s.end >= addDays(today, -14)).map((s) => chip(s.name, f.spr.includes(s.id), () => setFilters({ ...f, spr: flip(f.spr, s.id) }), `${s.start} → ${s.end}`))}
            {chip("Not in a sprint", f.spr.includes("none"), () => setFilters({ ...f, spr: flip(f.spr, "none") }))}
          </div>
        )}
        <span className="fend">
          <button className="chip" aria-pressed={selecting} onClick={() => (selecting ? endSelect() : setSelecting(true))} title="Tick items to put them in a sprint">{selecting ? "Done selecting" : "Select"}</button>
          {active && <button className="more" onClick={clear}>Clear filters</button>}
          <span className="due" role="status">{active ? `${shown} of ${list.length} items` : `${shown} item${shown === 1 ? "" : "s"}`}</span>
        </span>
      </div>
      {err && <div className="due late" role="alert">{err}</div>}
      <Sprints sprints={sprints} items={list} today={today} weeklyMinutes={weeklyMinutes} focus={f.spr} onFocus={(id) => setFilters({ ...f, spr: f.spr.length === 1 && f.spr[0] === id ? [] : [id] })} />
      {selecting && <SelectBar projectId={projectId} sel={sel} sprints={sprints.filter((s) => s.end >= today)} today={today} onDone={endSelect} onClear={() => setSel([])} />}
      {added && !keep(added) && <div className="due" role="status">Added &ldquo;{added.title}&rdquo; ({added.id}): your filters hide it. <button className="more" onClick={clear}>Clear filters</button></div>}
      {active && !shown && list.length > 0 && <div className="panel empty">No items match these filters. <button className="more" onClick={clear}>Clear filters</button></div>}
      {sections.filter((s) => !f.sec.length || f.sec.includes(s.id)).map((s) => {
        const all = list.filter((i) => i.section === s.id);
        let its = all.filter(keep).sort((a, b) => a.sort - b.sort);
        if (f.due.length) its = its.sort((a, b) => (a.due || "9").localeCompare(b.due || "9"));
        const hiddenClosed = all.filter((i) => !isOpen(i) && !keep(i)).length;
        return (
          <section className="cat" key={s.id}>
            <div className={`cat-h sec-${s.id}`}><h2><i className="lane" aria-hidden="true" />{s.name}{s.id === "decide" && <i className="sdot" aria-hidden="true" />}</h2>{s.note && <p>{s.note}</p>}</div>
            <div className="list">
              {!its.length && (
                <div className="empty">
                  {!all.length ? "Nothing here yet." : hiddenClosed === all.length ? <>All {all.length} done or cancelled. <button className="more" onClick={() => setFilters({ ...f, showDone: true })}>Show completed</button></> : "Nothing here with these filters."}
                </div>
              )}
              {its.map((i) => <Row key={i.id} i={i} s={s} byId={byId} sprint={i.sprint_id ? sprintById.get(i.sprint_id) : undefined} selecting={selecting} selected={sel.includes(i.id)} onSelect={() => toggleSel(i.id)} today={today} fresh={i.id === fresh} onStatus={(st) => setStatus(i, st)} run={run} projectId={projectId} />)}
              {its.length > 0 && hiddenClosed > 0 && <div className="empty" style={{ padding: "8px 14px" }}>{hiddenClosed} completed hidden · <button className="more" onClick={() => setFilters({ ...f, showDone: true })}>Show completed</button></div>}
              <AddRow projectId={projectId} section={s} today={today} onAdded={setFresh} />
            </div>
          </section>
        );
      })}
    </div>
  );
}

const ACTIVE_BUILD = ["working", "merge_requested", "sent_back"];
function Row({ i, s, byId, sprint, selecting, selected, onSelect, today, fresh, onStatus, run, projectId }: { i: Item; s: Section; byId: Map<string, Item>; sprint?: Sprint; selecting: boolean; selected: boolean; onSelect: () => void; today: string; fresh: boolean; onStatus: (s: "todo" | "doing" | "done") => void; run: (fn: () => Promise<unknown>) => void; projectId: string }) {
  const [open, setOpen] = useState(false);
  const long = i.detail.length > 170 || i.detail.includes("\n");
  const late = i.due && isOpen(i) && i.due < today, soon = i.due && isOpen(i) && !late && i.due <= addDays(today, 2);
  const claudeOwned = i.owner === "claude" || i.owner === "both";
  // Blockers still open (an unknown code counts as open: it may sit behind a filter or have been renamed).
  const waiting = isOpen(i) ? i.blocked_by.filter((c) => { const b = byId.get(c); return !b || isOpen(b); }) : [];
  return (
    <div id={`item-${i.id}`} className={`row${selecting ? " selecting" : ""}${selected ? " selected" : ""}${i.status === "done" ? " done" : ""}${i.status === "cancelled" ? " cancelled" : ""}${i.critical && isOpen(i) ? " crit-row" : ""}${fresh ? " fresh" : ""}`}>
      {selecting && <input type="checkbox" className="selbox" checked={selected} onChange={onSelect} aria-label={`Select ${i.title}`} />}
      {i.status === "cancelled"
        ? <span className="st" data-s="cancelled" role="img" aria-label={`${i.title}: cancelled`}>–</span>
        : <button className="st" data-s={i.status} role="checkbox" aria-checked={i.status === "done"} onClick={() => onStatus(i.status === "done" ? "todo" : "done")}
            aria-label={`Done: ${i.title}`} title={i.status === "done" ? "Done · click to reopen" : "Mark done"}>{i.status === "done" ? "✓" : ""}</button>}
      <div style={{ minWidth: 0 }}>
        <div className="t">
          <span>{i.title}</span>
          <span className="pill code" title="Say this code to Claude to refer to the item">{i.id}</span>
          {fresh && <span className="pill go">just added</span>}
          {i.owner && <span className={`pill${i.owner === "founder" ? " you" : ""}`}>{OWN[i.owner] || i.owner}</span>}
          {i.critical && isOpen(i) && <span className="pill crit">critical</span>}
          {i.priority === 1 && !i.critical && <span className="pill crit">high</span>}
          {i.priority === 3 && <span className="pill">low</span>}
          {i.estimate_minutes ? <span className="pill" title="Estimated time">~{i.estimate_minutes >= 60 ? `${Math.round(i.estimate_minutes / 30) / 2} h` : `${i.estimate_minutes} min`}</span> : null}
          {sprint && <span className="pill sprint" title={`${sprint.start} → ${sprint.end}`}>{sprint.name}</span>}
          {waiting.length > 0 && <a className="pill crit blocked" href={`#item-${waiting[0]}`} title={`Waits on ${waiting.map((c) => `${c}${byId.get(c) ? `: ${byId.get(c)!.title}` : ""}`).join("; ")}`}>blocked by {waiting.slice(0, 2).join(", ")}{waiting.length > 2 ? ` +${waiting.length - 2}` : ""}</a>}
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
        {open && isOpen(i) && <BlockedBy i={i} projectId={projectId} />}
        {(s.notes || i.note) && <Note i={i} projectId={projectId} />}
      </div>
      <div className="rowside">
        <input type="date" className={`duein due${late ? " late" : soon ? " soon" : ""}`} value={i.due || ""} aria-label={`Due date for ${i.title}`}
          onChange={(e) => run(() => setDue(projectId, i.id, e.target.value || null))} />
        {i.status === "todo" && !ACTIVE_BUILD.includes(i.build_status || "") && (
          <button className="btn sm ghost startbtn" onClick={() => onStatus("doing")} aria-label={`${claudeOwned ? "Start build" : "Start"}: ${i.title}`}
            title={claudeOwned ? "Claude builds this on a branch and opens a pull request for you to review (the Mac worker picks it up within a minute)" : "Mark it in progress"}>{claudeOwned ? "Start build ▸" : "Start ▸"}</button>
        )}
        {i.status === "doing" && (
          <span className="inprog">
            <span className="st-doing"><Icon n="timeline" size={13} />In progress</span>
            {!ACTIVE_BUILD.includes(i.build_status || "") && (
              <button className="more" onClick={() => onStatus("todo")} aria-label={`Stop: ${i.title}`} title={claudeOwned && !i.build_status ? "Back to to do: the queued build won't start" : "Back to to do"}>Stop</button>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

/** The PR of a build run, with the only two things the owner does here: approve (the worker merges) or send it back. */
function Build({ i, run, projectId }: { i: Item; run: (fn: () => Promise<unknown>) => void; projectId: string }) {
  const [back, setBack] = useState(false), [note, setNote] = useState("");
  const s = useSubmit();
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
        <form className="addrow" style={{ width: "100%" }} onKeyDown={imeGuard} onSubmit={(e) => { e.preventDefault(); const v = note.trim(); if (!v || s.pending) return; s.submit(() => sendBackBuild(projectId, i.id, v), { ok: "Sent back", onOk: () => { setNote(""); setBack(false); } }); }}>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} autoFocus aria-label="What to change" placeholder="What should change? Claude continues on the same branch and PR." />
          <button className="btn sm" disabled={!note.trim() || s.pending}>{s.pending ? "Sending…" : "Send back"}</button>
          <button type="button" className="more" onClick={() => setBack(false)}>Cancel</button>
          <Ack s={s} busy="Sending…" />
        </form>
      )}
      {!back && s.ok && <Ack s={s} />}
    </div>
  );
}

/** The comment bar under an opened item: tell Claude what to change, cancel the item, or mark it a duplicate. */
function Comment({ i, run, projectId }: { i: Item; run: (fn: () => Promise<unknown>) => void; projectId: string }) {
  const [t, setT] = useState("");
  const [cancelling, setCancelling] = useState(false), [reason, setReason] = useState(""), [dup, setDup] = useState("");
  const s = useSubmit(), c = useSubmit();
  const pending = i.refine === "pending" && !!i.refine_request;
  return (
    <div className="comment">
      {pending && <div className="said"><span className="lbl">Your comment</span> {i.refine_request}<span className="due"> · Claude is reading it…</span></div>}
      {!pending && i.refine_note && <div className="said"><span className="lbl">Claude</span> {i.refine_note}</div>}
      {i.status === "cancelled" && <div className="said"><span className="lbl">Cancelled</span> {i.cancel_reason || "No reason given."}{i.duplicate_of ? ` Duplicate of ${i.duplicate_of}.` : ""} <button className="more" onClick={() => run(() => setItemStatus(projectId, i.id, "todo"))}>Reopen</button></div>}
      <form className="addrow" onKeyDown={imeGuard} onSubmit={(e) => { e.preventDefault(); const v = t.trim(); if (!v || s.pending) return; s.submit(() => commentItem(projectId, i.id, v), { ok: "Sent to Claude", onOk: () => setT("") }); }}>
        <input className="input" value={t} onChange={(e) => setT(e.target.value)} maxLength={2000} aria-label={`Comment on ${i.title}`}
          placeholder="Comment or ask for a change: split it, move it to Friday, it's blocked by…, add a step…" />
        <button className="btn sm" disabled={!t.trim() || s.pending}>{s.pending ? "Sending…" : "Send to Claude"}</button>
        {isOpen(i) && !cancelling && <button type="button" className="more" onClick={() => setCancelling(true)}>Cancel this item</button>}
        <Ack s={s} busy="Sending…" />
      </form>
      {cancelling && (
        <form className="addrow" onKeyDown={imeGuard} onSubmit={(e) => { e.preventDefault(); if (c.pending) return; c.submit(() => cancelItem(projectId, i.id, reason, dup.trim() || null), { ok: "Cancelled", onOk: () => { setCancelling(false); setReason(""); setDup(""); } }); }}>
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} autoFocus aria-label="Why cancel" placeholder="Why? (optional: no longer needed, superseded, duplicate…)" />
          <input className="input" value={dup} onChange={(e) => setDup(e.target.value)} maxLength={60} aria-label="Duplicate of item code" placeholder="Duplicate of (item code, optional)" style={{ flex: "0 1 220px" }} />
          <button className="btn sm" disabled={c.pending}>{c.pending ? "Cancelling…" : "Cancel item"}</button>
          <button type="button" className="more" onClick={() => setCancelling(false)}>Keep it</button>
          <Ack s={c} />
        </form>
      )}
    </div>
  );
}

const fmtD = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("en-CA", { timeZone: "UTC", month: "short", day: "numeric" });
const hrs = (m: number) => `${Math.round(m / 6) / 10} h`;
const spanDays = (a: string, b: string) => Math.round((+new Date(b + "T12:00:00Z") - +new Date(a + "T12:00:00Z")) / 864e5) + 1;

/** Current and upcoming sprints (and those ended in the last 2 weeks): dates, done %, estimate against the project's weekly hours. */
function Sprints({ sprints, items, today, weeklyMinutes, focus, onFocus }: { sprints: Sprint[]; items: Item[]; today: string; weeklyMinutes: number | null; focus: string[]; onFocus: (id: string) => void }) {
  const shown = sprints.filter((s) => s.end >= addDays(today, -14));
  if (!shown.length) return null;
  return (
    <div className="sprints" role="group" aria-label="Sprints" data-track-section="Sprints">
      {shown.map((s) => <SprintCard key={s.id} s={s} items={items.filter((i) => i.sprint_id === s.id && i.status !== "cancelled")} today={today} weeklyMinutes={weeklyMinutes} on={focus.includes(s.id)} onFocus={() => onFocus(s.id)} />)}
    </div>
  );
}
function SprintCard({ s, items, today, weeklyMinutes, on, onFocus }: { s: Sprint; items: Item[]; today: string; weeklyMinutes: number | null; on: boolean; onFocus: () => void }) {
  const [editing, setEditing] = useState(false), [armed, setArmed] = useState(false);
  const [name, setName] = useState(s.name), [start, setStart] = useState(s.start), [end, setEnd] = useState(s.end);
  const sub = useSubmit(), [pending, go] = useTransition();
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 5000); return () => clearTimeout(t); }, [armed]);
  const d = items.filter((i) => i.status === "done").length, n = items.length;
  const est = items.filter(isOpen).reduce((a, i) => a + (i.estimate_minutes || 0), 0);
  const days = spanDays(s.start, s.end), cap = weeklyMinutes ? Math.round((weeklyMinutes * days) / 7) : null;
  const phase = today < s.start ? "upcoming" : today > s.end ? "ended" : "now";
  const unestimated = items.filter((i) => isOpen(i) && !i.estimate_minutes).length;
  return (
    <div className={`sprint ${phase}${on ? " on" : ""}`}>
      {editing ? (
        <form className="addrow" onKeyDown={imeGuard} onSubmit={(e) => { e.preventDefault(); sub.submit(() => editSprint(s.id, { name, start, end }), { ok: "Saved", onOk: () => setEditing(false) }); }}>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} aria-label="Sprint name" />
          <input className="input" type="date" value={start} onChange={(e) => setStart(e.target.value)} aria-label="Sprint start" />
          <input className="input" type="date" value={end} onChange={(e) => setEnd(e.target.value)} aria-label="Sprint end" />
          <button className="btn sm" disabled={sub.pending}>Save</button>
          <button type="button" className="more" onClick={() => setEditing(false)}>Cancel</button>
          <Ack s={sub} />
        </form>
      ) : (
        <>
          <button className="sprint-t" aria-pressed={on} onClick={onFocus} title={on ? "Show every item" : "Show only this sprint's items"}>
            <b>{s.name}</b><span>{fmtD(s.start)} – {fmtD(s.end)} · {phase === "now" ? `day ${spanDays(s.start, today)} of ${days}` : phase}</span>
          </button>
          <span className="bar" aria-hidden="true"><i className="d" style={{ width: `${n ? (d / n) * 100 : 0}%` }} /></span>
          <span className="sprint-n">
            {d}/{n} done
            {est > 0 && <> · <span className={cap != null && est > cap ? "late" : undefined} title={cap != null ? `Open work estimated against ${hrs(weeklyMinutes!)}/week of this project's hours` : "Set the project's weekly hours to compare with capacity"}>~{hrs(est)}{cap != null ? ` of ${hrs(cap)}` : ""} left</span></>}
            {unestimated > 0 && <span title="Open items without an estimate"> · {unestimated} unestimated</span>}
          </span>
          <span className="sprint-a">
            <button className="more" onClick={() => setEditing(true)}>Edit</button>
            {armed ? <button className="more late" disabled={pending} onClick={() => go(() => removeSprint(s.id))}>Confirm delete</button>
              : <button className="more" onClick={() => setArmed(true)} title="Deletes the sprint; its items stay on the checklist">Delete</button>}
          </span>
        </>
      )}
    </div>
  );
}

/** Shown in select mode: what to do with the ticked items. A new sprint defaults to today through 6 days later. */
function SelectBar({ projectId, sel, sprints, today, onDone, onClear }: { projectId: string; sel: string[]; sprints: Sprint[]; today: string; onDone: () => void; onClear: () => void }) {
  const [name, setName] = useState(""), [start, setStart] = useState(today), [end, setEnd] = useState(addDays(today, 6)), [target, setTarget] = useState("");
  const s = useSubmit();
  const none = !sel.length;
  return (
    <div className="selbar" role="region" aria-label="Selected items">
      <span className="due" role="status"><b>{sel.length}</b> selected{none ? ": tick items below" : ""}</span>
      <form className="addrow" onKeyDown={imeGuard} onSubmit={(e) => { e.preventDefault(); if (none || s.pending) return; s.submit(() => createSprint(projectId, name, start, end, sel), { ok: "Sprint created", onOk: onDone }); }}>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="New sprint name" aria-label="New sprint name" />
        <input className="input" type="date" value={start} onChange={(e) => setStart(e.target.value)} aria-label="Sprint start" />
        <input className="input" type="date" value={end} onChange={(e) => setEnd(e.target.value)} aria-label="Sprint end" />
        <button className="btn sm" disabled={none || s.pending}>Create sprint</button>
      </form>
      {sprints.length > 0 && (
        <span className="addrow">
          <select className="input" value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Existing sprint">
            <option value="">Add to sprint…</option>
            {sprints.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.start} → {x.end})</option>)}
          </select>
          <button className="btn sm ghost" disabled={none || !target || s.pending} onClick={() => s.submit(() => moveToSprint(projectId, target, sel), { ok: "Added", onOk: onDone })}>Add</button>
        </span>
      )}
      <button className="more" disabled={none || s.pending} onClick={() => s.submit(() => moveToSprint(projectId, null, sel), { ok: "Taken out", onOk: onDone })}>Take out of sprint</button>
      {!none && <button className="more" onClick={onClear}>Clear selection</button>}
      <button className="more" onClick={onDone}>Done</button>
      <Ack s={s} />
    </div>
  );
}

/** "Blocked by": item codes this one waits on, comma-separated. Saved on Enter or Save; the server refuses loops and unknown codes. */
function BlockedBy({ i, projectId }: { i: Item; projectId: string }) {
  const [v, setV] = useState(i.blocked_by.join(", "));
  useEffect(() => setV(i.blocked_by.join(", ")), [i.blocked_by]);
  const s = useSubmit();
  const codes = v.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
  const dirty = codes.join(",") !== i.blocked_by.join(",");
  return (
    <form className="addrow blockedby" onKeyDown={imeGuard} onSubmit={(e) => { e.preventDefault(); if (!dirty || s.pending) return; s.submit(() => setBlockedBy(projectId, i.id, codes), { ok: codes.length ? "Saved" : "Cleared" }); }}>
      <label className="lbl" htmlFor={`blk-${i.id}`}>Blocked by</label>
      <input id={`blk-${i.id}`} className="input" value={v} onChange={(e) => setV(e.target.value)} maxLength={400} placeholder="Item codes it waits on, e.g. decide-ai, r-dom (empty = not blocked)" />
      <button className="btn sm ghost" disabled={!dirty || s.pending}>{s.pending ? "Saving…" : "Save"}</button>
      <Ack s={s} busy="Saving…" />
    </form>
  );
}

/** The decision box: a draft stays here until "Send to Claude" (or Enter; Shift+Enter is a new line); then it shows sent / read states. */
function Note({ i, projectId }: { i: Item; projectId: string }) {
  const draftKey = `jarvis.note.${projectId}.${i.id}`;
  const [note, setNote] = useState(i.note);
  const s = useSubmit();
  useEffect(() => { try { const d = localStorage.getItem(draftKey); setNote(d ?? i.note); } catch { setNote(i.note); } }, [i.note, draftKey]);
  const dirty = note.trim() !== i.note.trim();
  const readIt = !!i.note_sent_at && i.refine !== "pending" && !dirty;
  const sentNotRead = !!i.note_sent_at && i.refine === "pending" && !dirty;
  const change = (v: string) => { setNote(v); try { if (v.trim() !== i.note.trim()) localStorage.setItem(draftKey, v); else localStorage.removeItem(draftKey); } catch { /* ignore */ } };
  return (
    <form className="note" onSubmit={(e) => { e.preventDefault(); if (!dirty || !note.trim() || s.pending) return; s.submit(() => sendNote(projectId, i.id, note), { ok: "Sent", onOk: () => { try { localStorage.removeItem(draftKey); } catch { /* ignore */ } } }); }}>
      <label className="lbl" htmlFor={`note-${i.id}`}>Your answer (Claude reads it when you send it)</label>
      <textarea id={`note-${i.id}`} className="textarea" rows={2} value={note} placeholder="Your call, or a question back · Enter sends, Shift+Enter for a new line" onChange={(e) => change(e.target.value)} onKeyDown={enterSends} />
      <div className="crow" style={{ gap: 10 }}>
        <button className="btn sm" disabled={!dirty || !note.trim() || s.pending}>{s.pending ? "Sending…" : "Send to Claude"}</button>
        {s.err || s.pending || s.ok ? <Ack s={s} busy="Sending…" /> : (
          <span className="due">
            {dirty ? "Draft, not sent" : sentNotRead ? `Sent ${fmtWhen(i.note_sent_at!)} · Claude has not read it yet` : readIt ? `Sent ${fmtWhen(i.note_sent_at!)} · Claude read it` : i.note ? "Saved" : ""}
          </span>
        )}
      </div>
    </form>
  );
}

function AddRow({ projectId, section, today, onAdded }: { projectId: string; section: Section; today: string; onAdded: (id: string) => void }) {
  const [t, setT] = useState(""), [d, setD] = useState(addDays(today, 7));
  const s = useSubmit();
  return (
    <form className="addrow" onKeyDown={imeGuard} onSubmit={(e) => {
      e.preventDefault(); const v = t.trim(); if (!v || s.pending) return;
      s.submit(() => newItem(projectId, section.id, v, d || null), { ok: "Added", onOk: (r) => { setT(""); const id = (r as { id?: string } | undefined)?.id; if (id) onAdded(id); } });
    }}>
      <input id={`add-${section.id}`} className="input" value={t} onChange={(e) => setT(e.target.value)} placeholder={`Add to ${section.name}…`} aria-label={`New ${section.name} item`} />
      <input className="input" type="date" value={d} onChange={(e) => setD(e.target.value)} aria-label="Due date" />
      <button className="btn sm" disabled={!t.trim() || s.pending}>{s.pending ? "Adding…" : "Add"}</button>
      <Ack s={s} busy="Adding…" />
    </form>
  );
}
