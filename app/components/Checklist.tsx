"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cycleItem, newItem, saveNote, setDue } from "@/lib/actions";
import type { Item, Section } from "@/lib/data";

// Owner values stored in the database: "founder" is you (the dashboard's owner), "claude", or "both".
const OWN: Record<string, string> = { founder: "you", claude: "Claude", both: "both" };
const addDays = (d: string, n: number) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

export default function Checklist({ projectId, sections: given, items, today }: { projectId: string; sections: Section[]; items: Item[]; today: string }) {
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
  const refining = items.some((i) => i.refine === "pending");
  // While Claude is refining a new item, refresh so its steps, date and estimate appear on their own.
  useEffect(() => { if (!refining) return; const t = setInterval(() => router.refresh(), 10000); return () => clearInterval(t); }, [refining, router]);
  const [, start] = useTransition();
  const [err, setErr] = useState("");
  const [f, setF] = useState({ cat: "", crit: false, open: false, own: "", when: "any" });
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
    if (f.open && i.status === "done") return false;
    if (f.own && !(i.owner === f.own || i.owner === "both" || (f.own === "founder" && !i.owner))) return false;
    if (win) { if (!i.due) return false; if (win.overdue && i.status === "done") return false; if ("from" in win && win.from && i.due < win.from) return false; if (i.due > win.to) return false; }
    return true;
  };
  const cycle = (i: Item) => {
    const next = ({ todo: "doing", doing: "done", done: "todo" } as const)[i.status];
    setList((l) => l.map((x) => (x.id === i.id ? { ...x, status: next } : x)));
    run(() => cycleItem(projectId, i.id));
  };
  const shown = list.filter(keep).length;
  const chip = (label: string, on: boolean, click: () => void) => <button key={label} className="chip" aria-pressed={on} onClick={click}>{label}</button>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div className="summary" role="group" aria-label="Filter by section">
        {sections.map((s) => {
          const its = list.filter((i) => i.section === s.id), d = its.filter((i) => i.status === "done").length, g = its.filter((i) => i.status === "doing").length, n = its.length || 1;
          return (
            <button key={s.id} className="sum" aria-pressed={f.cat === s.id} onClick={() => setF({ ...f, cat: f.cat === s.id ? "" : s.id })}>
              <span className="k"><span>{s.name}</span><span className="n">{d}/{its.length}</span></span>
              <span className="bar"><i className="d" style={{ width: `${(d / n) * 100}%` }} /><i className="g" style={{ width: `${(g / n) * 100}%` }} /></span>
            </button>
          );
        })}
      </div>
      <div className="chips" role="group" aria-label="Filters">
        {chip("Everything", !f.cat && !f.crit && !f.open && !f.own && f.when === "any", () => setF({ cat: "", crit: false, open: false, own: "", when: "any" }))}
        {chip("Critical only", f.crit, () => setF({ ...f, crit: !f.crit }))}
        {chip("Yours", f.own === "founder", () => setF({ ...f, own: f.own === "founder" ? "" : "founder" }))}
        {chip("Claude's", f.own === "claude", () => setF({ ...f, own: f.own === "claude" ? "" : "claude" }))}
        {chip("Hide done", f.open, () => setF({ ...f, open: !f.open }))}
        <span className="lbl" style={{ marginLeft: 8 }}>Due</span>
        {[["any", "Any date"], ["overdue", "Overdue"], ["week", "Next 7 days"], ["2w", "Next 14 days"]].map(([k, l]) => chip(l, f.when === k, () => setF({ ...f, when: k })))}
        <span className="due" style={{ marginLeft: "auto" }}>{shown} of {list.length} shown</span>
      </div>
      {err && <div className="due late" role="alert">{err}</div>}
      {sections.filter((s) => !f.cat || f.cat === s.id).map((s) => {
        let its = list.filter((i) => i.section === s.id && keep(i)).sort((a, b) => a.sort - b.sort);
        if (win) its = its.sort((a, b) => (a.due || "9").localeCompare(b.due || "9"));
        return (
          <section className="cat" key={s.id}>
            <div className="cat-h"><h2>{s.name}</h2>{s.note && <p>{s.note}</p>}</div>
            <div className="list">
              {!its.length && <div className="empty">Nothing here with these filters.</div>}
              {its.map((i) => <Row key={i.id} i={i} s={s} today={today} onCycle={() => cycle(i)} run={run} projectId={projectId} />)}
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
  const [note, setNote] = useState(i.note);
  useEffect(() => setNote(i.note), [i.note]);
  const long = i.detail.length > 170 || i.detail.includes("\n");
  const late = i.due && i.status !== "done" && i.due < today, soon = i.due && i.status !== "done" && !late && i.due <= addDays(today, 2);
  return (
    <div className={`row${i.status === "done" ? " done" : ""}${i.critical && i.status !== "done" ? " crit-row" : ""}`}>
      <button className="st" data-s={i.status} onClick={onCycle} aria-label={`${i.title}: ${i.status}. Change status`}>{i.status === "done" ? "✓" : i.status === "doing" ? "◐" : ""}</button>
      <div style={{ minWidth: 0 }}>
        <div className="t">
          <span>{i.title}</span>
          <span className="pill code" title="Say this code to Claude to refer to the item">{i.id}</span>
          {i.owner && <span className={`pill${i.owner === "founder" ? " you" : ""}`}>{OWN[i.owner] || i.owner}</span>}
          {i.critical && <span className="pill crit">critical</span>}
          {i.priority === 1 && !i.critical && <span className="pill crit">high</span>}
          {i.priority === 3 && <span className="pill">low</span>}
          {i.estimate_minutes ? <span className="pill" title="Estimated time">~{i.estimate_minutes >= 60 ? `${Math.round(i.estimate_minutes / 30) / 2} h` : `${i.estimate_minutes} min`}</span> : null}
          {i.refine === "pending" && <span className="pill go" title="Claude is reading this item and will add steps, a priority, an estimate and a due date that doesn't clash">refining…</span>}
          {i.refine === "done" && <span className="pill" title={i.refine_note || "Refined by Claude"}>refined by Claude</span>}
          {i.refine === "flagged" && <span className="pill crit" title={i.refine_note}>check: overlaps</span>}
          {i.owner === "claude" && i.status === "doing" && <span className="pill go">go given</span>}
        </div>
        {i.detail && <><div className={`dt${long && !open ? " collapsed" : ""}`}>{i.detail}</div>{long && <button className="more" onClick={() => setOpen(!open)}>{open ? "Show less" : "Show more"}</button>}</>}
        {(s.notes || i.note) && (
          <div className="note">
            <label className="lbl" htmlFor={`note-${i.id}`}>Your answer (Claude reads it)</label>
            <textarea id={`note-${i.id}`} className="textarea" rows={2} value={note} placeholder="Your call, or a question back"
              onChange={(e) => setNote(e.target.value)} onBlur={() => note !== i.note && run(() => saveNote(projectId, i.id, note))} />
          </div>
        )}
      </div>
      <div className="rowside">
        <input type="date" className={`duein due${late ? " late" : soon ? " soon" : ""}`} value={i.due || ""} aria-label={`Due date for ${i.title}`}
          onChange={(e) => run(() => setDue(projectId, i.id, e.target.value || null))} />
      </div>
    </div>
  );
}

function AddRow({ projectId, section, run, today }: { projectId: string; section: Section; run: (fn: () => Promise<unknown>) => void; today: string }) {
  const [t, setT] = useState(""), [d, setD] = useState(addDays(today, 7));
  return (
    <form className="addrow" onSubmit={(e) => { e.preventDefault(); const v = t.trim(); if (!v) return; setT(""); run(() => newItem(projectId, section.id, v, d || null)); }}>
      <input id={`add-${section.id}`} className="input" value={t} onChange={(e) => setT(e.target.value)} placeholder={`Add to ${section.name}…`} aria-label={`New ${section.name} item`} />
      <input className="input" type="date" value={d} onChange={(e) => setD(e.target.value)} aria-label="Due date" />
      <button className="btn sm">Add</button>
    </form>
  );
}
