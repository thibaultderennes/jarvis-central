import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { boardData } from "@/lib/board";
import { addDays, fmtDate, isDate, mondayOf, today, weekday } from "@/lib/time";
import Board from "@/components/Board";
import Markdown from "@/components/Markdown";
import { HBars } from "@/components/Charts";
import { getPlan } from "@/lib/plan";
import { cap, PLAN_WHEN } from "@/lib/instance";
import { TZ } from "@/lib/time";
import "../today/board.css";
import { Glyph, HeaderVec } from "@/components/brand";

export default async function WeekPage({ searchParams }: { searchParams: Promise<{ w?: string }> }) {
  await requireSession();
  const sp = await searchParams, t = today();
  // Sundays open on the week ahead: that's when the week gets planned.
  const home = mondayOf(weekday(t) === 6 ? addDays(t, 1) : t);
  const w = isDate(sp.w) ? mondayOf(sp.w) : home;
  const days = Array.from({ length: 7 }, (_, i) => addDays(w, i));
  const [data, plan] = await Promise.all([boardData(days[0], days[6]), getPlan(w)]);
  const pname = Object.fromEntries(data.projects.map((p) => [p.id, p]));
  const mins = (a: string, b: string) => (+b.slice(0, 2) * 60 + +b.slice(3)) - (+a.slice(0, 2) * 60 + +a.slice(3));
  const perProject = plan ? Object.entries(plan.blocks.reduce<Record<string, number>>((acc, b) => ({ ...acc, [b.project_id]: (acc[b.project_id] || 0) + mins(b.start, b.end) }), {})) : [];
  return (
    <>
      <div className="hello">
        <div>
          <h1 className="page"><Glyph n="week" />Week of {fmtDate(w, { month: "long", day: "numeric" })}</h1>
          <p className="sub">Overdue work first, then the week: each day shows its appointments, what&apos;s due (critical first) and your todos, with the load against a day of focus. Drag todos between days.</p>
        </div>
        <HeaderVec n="week" />
        <nav className="daynav" aria-label="Change week">
          <Link href={`/week?w=${addDays(w, -7)}`}>‹ Previous</Link>
          {w !== home && <Link href="/week">This week</Link>}
          <Link href={`/week?w=${addDays(w, 7)}`}>Next ›</Link>
        </nav>
      </div>
      <section className="panel">
        <div className="ph">
          <h2 className="ph-t">Sunday plan</h2><span className="sp" />
          <span className="hint">{plan ? `${plan.blocks.length} blocks · planned ${new Date(plan.updated_at).toLocaleString("en-CA", { timeZone: TZ, weekday: "short", hour: "2-digit", minute: "2-digit" })} · ${plan.synced_at && plan.synced_version === plan.version ? `in Google Calendar (${plan.synced_count} events)` : "not in Google Calendar yet"}` : `Made ${PLAN_WHEN} from your checklists, around your appointments`}</span>
        </div>
        {plan ? (
          <div className="grid2" style={{ gap: 0 }}>
            <div>
              <HBars rows={perProject.sort((a, b) => b[1] - a[1]).map(([id, v]) => ({ key: id, label: pname[id]?.name || id, color: pname[id]?.color || "other", v }))} format="minutes" />
              {plan.unscheduled.length > 0 && (
                <div className="pb" style={{ paddingTop: 0 }}>
                  <div className="lbl" style={{ marginBottom: 6 }}>Didn&apos;t fit this week ({plan.unscheduled.length})</div>
                  {plan.unscheduled.map((u) => <div key={u.project_id + u.item_id} style={{ fontSize: 13, padding: "3px 0" }} data-c={pname[u.project_id]?.color}><i className="dot" /> {u.title} <span className="due">· {u.reason}</span></div>)}
                </div>
              )}
            </div>
            <div className="pb" style={{ borderLeft: "1px solid var(--line-2)" }}>{plan.notes_md ? <Markdown>{plan.notes_md}</Markdown> : <span className="due">No notes</span>}</div>
          </div>
        ) : <div className="empty">No plan for this week yet. {cap(PLAN_WHEN)} your Mac looks at what&apos;s due, estimates each item, and fits it around your calendar. The blocks land here as todos and in a &ldquo;Jarvis · work plan&rdquo; Google Calendar.</div>}
      </section>
      <Board mode="week" days={days} {...data} />
    </>
  );
}
