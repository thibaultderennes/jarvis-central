"use client";
import { useId, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { DailyStats as Stats, StatBucket, StatRef } from "@/lib/data";

const P = (d: string) => new Date(d + "T12:00:00Z");
const fmt = (d: string, o: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }) => P(d).toLocaleDateString("en-CA", { timeZone: "UTC", ...o });
const wd = (d: string) => ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"][P(d).getUTCDay()];
const UNIT: Record<StatBucket, string> = { day: "day", week: "week", month: "month" };
/** Axis label (main + optional second line), and the full name of a bucket for the panel and the native tooltip. */
const label = (b: StatBucket, d: string, prev?: string): [string, string] =>
  b === "day" ? [wd(d), ""]
    : b === "week" ? [String(P(d).getUTCDate()), !prev || prev.slice(0, 7) !== d.slice(0, 7) ? fmt(d, { month: "short" }) : ""]
      : [fmt(d, { month: "short" }), !prev || d.slice(5, 7) === "01" ? `'${d.slice(2, 4)}` : ""];
const name = (b: StatBucket, d: string) => (b === "day" ? fmt(d, { weekday: "short", month: "short", day: "numeric" }) : b === "week" ? `Week of ${fmt(d)}` : fmt(d, { month: "long", year: "numeric" }));

export type StatProject = { id: string; name: string; color: string };

/**
 * Items added (up) and finished (down, late ones red) per day, week or month, with a clear start of tracking.
 * Bucket and project filter live in the URL (`bucket`, `proj`), so the server computes them; a bar opens the items behind it.
 */
export default function DailyStats({ stats, projects, filter = false, project }: { stats: Stats; projects: StatProject[]; filter?: boolean; project?: string }) {
  const router = useRouter(), path = usePathname(), params = useSearchParams();
  const [pending, start] = useTransition();
  const [sel, setSel] = useState<string | null>(null);
  const panelId = useId();
  const b = stats.bucket, days = stats.days, unit = UNIT[b];
  const go = (k: string, v: string) => {
    const q = new URLSearchParams(params.toString());
    if (v) q.set(k, v); else q.delete(k);
    setSel(null);
    start(() => router.replace(q.toString() ? `${path}?${q}` : path, { scroll: false }));
  };
  const byId = Object.fromEntries(projects.map((p) => [p.id, p]));
  const since = stats.tracking_since ? stats.tracking_since.slice(0, 10) : null;
  const max = Math.max(1, ...days.map((d) => Math.max(d.added, d.done + d.cancelled)));
  const tot = days.reduce((a, d) => ({ added: a.added + d.added, done: a.done + d.done, late: a.late + d.done_late, cancelled: a.cancelled + d.cancelled }), { added: 0, done: 0, late: 0, cancelled: 0 });
  const scope = filter ? (project ? byId[project]?.name || project : "all projects") : "this project";
  const open = days.findIndex((d) => `${b}:${d.date}` === sel);
  const cur = open >= 0 ? days[open] : null;
  // A bucket is "before tracking" only when it ends before the first item: partial buckets count as tracked.
  const before = (i: number) => !!since && i < days.length - 1 && days[i + 1].date <= since;

  return (
    <>
      <div className="ph">
        <h2 className="ph-t">Added and finished per {unit}</h2><span className="sp" />
        <span className="hint">Last {days.length} {unit}s · {scope} · finished after their due date in red</span>
        <span className="fgroup" role="group" aria-label="Group by">
          {(["day", "week", "month"] as const).map((k) => <button key={k} className="chip" aria-pressed={b === k} onClick={() => go("bucket", k === "day" ? "" : k)}>{k[0].toUpperCase() + k.slice(1)}</button>)}
        </span>
        {filter && (
          <select className="select" aria-label="Project" value={project || ""} onChange={(e) => go("proj", e.target.value)}>
            <option value="">All projects</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
      </div>
      {!since ? <div className="empty">Tracking starts with the first checklist item.</div> : (
        <div className="pb" style={{ paddingTop: 8, opacity: pending ? 0.5 : 1, transition: "opacity .15s" }}>
          <div className="dstats" role="group" aria-label={`Last ${days.length} ${unit}s, ${scope}: ${tot.added} added, ${tot.done} finished (${tot.late} after their due date), ${tot.cancelled} cancelled; ${stats.overdue_open} open items overdue today. Choose a bar to list its items.`}>
            {days.map((d, i) => {
              const [l1, l2] = label(b, d.date, days[i - 1]?.date), pre = before(i), on = open === i;
              const desc = pre ? `${name(b, d.date)}: before tracking began` : `${name(b, d.date)}: ${d.added} added · ${d.done} finished${d.done_late ? ` (${d.done_late} late)` : ""}${d.cancelled ? ` · ${d.cancelled} cancelled` : ""}`;
              return (
                <button key={d.date} type="button" className={`dday${i === days.length - 1 ? " today" : ""}${pre ? " before" : ""}`} title={desc} aria-label={desc} aria-expanded={on} aria-controls={panelId}
                  onClick={() => setSel(on ? null : `${b}:${d.date}`)}>
                  <span className="up"><i style={{ height: `${(d.added / max) * 100}%` }} /></span>
                  <span className="down"><i className="dn" style={{ height: `${(d.done / max) * 100}%` }}><b style={{ height: d.done ? `${(d.done_late / d.done) * 100}%` : 0 }} /></i><i className="cx" style={{ height: `${(d.cancelled / max) * 100}%` }} /></span>
                  <span className="dl">{l1}{l2 && <small>{l2}</small>}</span>
                </button>
              );
            })}
          </div>
          <div className="legend" style={{ padding: "8px 0 0" }}>
            <span><i className="dot" style={{ background: "var(--ink-3)" }} />Added ({tot.added})</span>
            <span><i className="dot" style={{ background: "var(--done)" }} />Finished ({tot.done})</span>
            <span><i className="dot" style={{ background: "var(--bad)" }} />…after their due date ({tot.late})</span>
            {tot.cancelled > 0 && <span><i className="dot" style={{ background: "var(--line)" }} />Cancelled ({tot.cancelled})</span>}
            <span className="due">· {stats.overdue_open} open item{stats.overdue_open === 1 ? "" : "s"} overdue today</span>
            {since > stats.from && <span className="due">· tracking since {fmt(since)}</span>}
          </div>
          <div id={panelId} className="dpanel" hidden={!cur}>
            {cur && (
              <>
                <div className="dpanel-h">
                  <b>{name(b, cur.date)}{b !== "day" && open === days.length - 1 ? " (so far)" : ""}</b>
                  <span className="due">{scope}{cur.cancelled ? ` · ${cur.cancelled} cancelled` : ""}</span>
                  <span className="sp" />
                  <button type="button" className="more" onClick={() => setSel(null)}>Close</button>
                </div>
                <div className="dpanel-cols">
                  <Refs title="Added" list={cur.items?.added || []} byId={byId} empty={before(open) ? "Before tracking began." : "Nothing added."} showProject={filter} />
                  <Refs title="Completed" list={cur.items?.done || []} byId={byId} empty="Nothing finished." showProject={filter} />
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function Refs({ title, list, byId, empty, showProject }: { title: string; list: StatRef[]; byId: Record<string, StatProject>; empty: string; showProject: boolean }) {
  return (
    <section>
      <h3>{title} <span className="due">{list.length}</span></h3>
      {!list.length ? <div className="empty" style={{ padding: "4px 0" }}>{empty}</div> : (
        <ul>
          {list.map((r) => {
            const p = byId[r.project_id];
            return (
              <li key={r.project_id + "/" + r.id} data-c={p?.color || "other"}>
                <i className="dot" />
                <Link href={`/p/${r.project_id}?v=checklist#item-${r.id}`}>{r.title}</Link>
                {r.late && <span className="pill crit">late</span>}
                {showProject && <span className="due">{p?.name || r.project_id}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
