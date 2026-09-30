import type { DayStat } from "@/lib/data";

const fmt = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("en-CA", { timeZone: "UTC", month: "short", day: "numeric" });
const wd = (d: string) => ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"][new Date(d + "T12:00:00Z").getUTCDay()];

/** Compact daily view: items added (up) and finished (down, late ones darker) per day, with a clear start of tracking. */
export default function DailyStats({ stats, today }: { stats: { from: string; tracking_since: string | null; overdue_open: number; days: DayStat[] }; today: string }) {
  const since = stats.tracking_since ? stats.tracking_since.slice(0, 10) : null;
  const max = Math.max(1, ...stats.days.map((d) => Math.max(d.added, d.done + d.cancelled)));
  const tot = stats.days.reduce((a, d) => ({ added: a.added + d.added, done: a.done + d.done, late: a.late + d.done_late, cancelled: a.cancelled + d.cancelled }), { added: 0, done: 0, late: 0, cancelled: 0 });
  if (!since) return <div className="empty">Tracking starts with the first checklist item.</div>;
  return (
    <div className="pb" style={{ paddingTop: 8 }}>
      <div className="dstats" role="img" aria-label={`Last ${stats.days.length} days: ${tot.added} added, ${tot.done} finished (${tot.late} after their due date), ${tot.cancelled} cancelled; ${stats.overdue_open} open items overdue today`}>
        {stats.days.map((d) => {
          const before = d.date < since;
          return (
            <div key={d.date} className={`dday${d.date === today ? " today" : ""}${before ? " before" : ""}`} title={before ? `${fmt(d.date)}: before tracking began` : `${fmt(d.date)}: ${d.added} added · ${d.done} finished${d.done_late ? ` (${d.done_late} late)` : ""}${d.cancelled ? ` · ${d.cancelled} cancelled` : ""}`}>
              <span className="up"><i style={{ height: `${(d.added / max) * 100}%` }} /></span>
              <span className="down"><i className="dn" style={{ height: `${(d.done / max) * 100}%` }}><b style={{ height: d.done ? `${(d.done_late / d.done) * 100}%` : 0 }} /></i><i className="cx" style={{ height: `${(d.cancelled / max) * 100}%` }} /></span>
              <span className="dl">{wd(d.date)}</span>
            </div>
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
    </div>
  );
}
