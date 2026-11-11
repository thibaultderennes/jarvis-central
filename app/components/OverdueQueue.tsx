"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { triageOverdue } from "@/lib/actions";
import { laterDate, type Triage } from "@/lib/overdue";
import { Ack, useSubmit } from "./Submit";
import "./overdue.css";

export type OItem = { project_id: string; id: string; title: string; due: string; critical: boolean; owner: string | null; status: string };
type P = { name: string; color: string };
const key = (i: OItem) => `${i.project_id}/${i.id}`;
const fmt = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("en-CA", { timeZone: "UTC", month: "short", day: "numeric" });
const late = (due: string, today: string) => Math.round((Date.parse(today) - Date.parse(due)) / 864e5);

/**
 * Every overdue open item across projects in one queue, critical first, then the oldest. Re-date, Later (next Monday),
 * Give to Claude or Done on one row, or tick several and do it once from the bar. Rows leave as soon as they're handled.
 */
export default function OverdueQueue({ items, projects, today, page, limit = 0 }: { items: OItem[]; projects: Record<string, P>; today: string; page: "/" | "/today"; limit?: number }) {
  const [gone, setGone] = useState<Set<string>>(() => new Set());
  const [mine, setMine] = useState<Set<string>>(() => new Set());
  const [sel, setSel] = useState<Set<string>>(() => new Set());
  const [all, setAll] = useState(false), [date, setDate] = useState("");
  useEffect(() => { setGone(new Set()); setMine(new Set()); }, [items]);
  const s = useSubmit();

  const list = items.filter((i) => !gone.has(key(i)));
  const shown = limit && !all ? list.slice(0, limit) : list;
  const picked = list.filter((i) => sel.has(key(i))).map(key);
  const crit = list.filter((i) => i.critical).length;
  const later = laterDate(today);
  const LABEL: Record<Triage, string> = { due: "Re-dated", later: `Moved to ${fmt(later)}`, claude: "Given to Claude", done: "Done" };

  const go = (keys: string[], act: Triage, due: string | null = null) => {
    if (!keys.length || s.pending) return;
    const hide = act !== "claude";
    const flip = (on: boolean) => (hide ? setGone : setMine)((x) => { const n = new Set(x); keys.forEach((k) => (on ? n.add(k) : n.delete(k))); return n; });
    flip(true);
    s.submit(async () => {
      try { const r = await triageOverdue(keys, act, due, page); if (r.error) flip(false); return r; } catch (e) { flip(false); throw e; }
    }, { ok: `${LABEL[act]}${keys.length > 1 ? ` · ${keys.length} items` : ""}`, onOk: () => { setSel(new Set()); setDate(""); } });
  };
  const tick = (k: string) => setSel((x) => { const n = new Set(x); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const everyone = list.length > 0 && picked.length === list.length;

  if (!list.length) return <div className="empty">Nothing overdue. Items past their due date, from every project, land here.</div>;
  return (
    <div className="oq">
      <div className="oq-bar" role="region" aria-label="Selected overdue items">
        <label className="oq-all">
          <input type="checkbox" checked={everyone} ref={(el) => { if (el) el.indeterminate = picked.length > 0 && !everyone; }}
            onChange={() => setSel(everyone ? new Set() : new Set(list.map(key)))} aria-label={everyone ? "Clear selection" : `Select all ${list.length} overdue items`} />
          <span role="status">{picked.length ? <><b>{picked.length}</b> selected</> : <><b>{list.length}</b> overdue{crit ? <>, <span className="oq-crit">{crit} critical</span></> : ""}</>}</span>
        </label>
        <span className="oq-acts">
          <input type="date" className="input" min={today} value={date} onChange={(e) => setDate(e.target.value)} aria-label="New due date for the selected items" disabled={!picked.length} />
          <button className="btn sm ghost" disabled={!picked.length || !date || s.pending} onClick={() => go(picked, "due", date)}>Re-date</button>
          <button className="btn sm ghost" disabled={!picked.length || s.pending} onClick={() => go(picked, "later")} title={`Due next Monday, ${fmt(later)}`}>Later</button>
          <button className="btn sm ghost" disabled={!picked.length || s.pending} onClick={() => go(picked, "claude")} title="Claude becomes the owner; it builds an item once you set it in progress">Give to Claude</button>
          <button className="btn sm" disabled={!picked.length || s.pending} onClick={() => go(picked, "done")}>Done</button>
        </span>
        <Ack s={s} />
      </div>
      <ul className="oq-list">
        {shown.map((i) => {
          const k = key(i), p = projects[i.project_id], n = late(i.due, today), claude = i.owner === "claude" || mine.has(k);
          return (
            <li key={k} className={`oq-row${i.critical ? " crit" : ""}${sel.has(k) ? " on" : ""}`} data-c={p?.color || "other"}>
              <input type="checkbox" checked={sel.has(k)} onChange={() => tick(k)} aria-label={`Select ${i.title}`} />
              <span className="tt">
                <Link href={`/p/${i.project_id}#item-${i.id}`} title={i.title}>{i.title}</Link>
                <small><i className="dot" />{p?.name || i.project_id} · {i.id}{i.critical && <b className="oq-crit"> · critical</b>}{i.status === "doing" ? " · in progress" : ""}{claude ? " · Claude" : ""}</small>
              </span>
              <span className="due late" title={`Due ${fmt(i.due)}`}>{n === 1 ? "1 day late" : `${n} days late`}</span>
              <span className="oq-ra">
                <input type="date" className="oq-date" min={today} value="" onChange={(e) => e.target.value && go([k], "due", e.target.value)} aria-label={`Re-date ${i.title}`} title="Re-date" />
                <button className="btn sm ghost" onClick={() => go([k], "later")} title={`Due next Monday, ${fmt(later)}`} aria-label={`Later: ${i.title}`}>Later</button>
                {!claude && <button className="btn sm ghost" onClick={() => go([k], "claude")} aria-label={`Give to Claude: ${i.title}`}>Claude</button>}
                <button className="btn sm ghost" onClick={() => go([k], "done")} aria-label={`Done: ${i.title}`}>✓ Done</button>
              </span>
            </li>
          );
        })}
      </ul>
      {limit > 0 && list.length > limit && <button className="oq-more" onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show all ${list.length}`}</button>}
    </div>
  );
}
