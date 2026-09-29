import Link from "next/link";
import { requireSession } from "@/lib/auth";
import * as D from "@/lib/data";
import { getEvents, calendarConfigured } from "@/lib/calendar";
import { addDays, daysBetween, fmtDate, mondayOf, today, TZ, WD, weekday } from "@/lib/time";
import { cap, OWNER, REVIEW_WHEN } from "@/lib/instance";
import { HBars, StackedColumns, type Series } from "@/components/Charts";
import { BurnUp, Heatmap, OwnerBars, PaceBullets } from "@/components/Insights";

export default async function Overview() {
  await requireSession();
  const t = today(), wk = mondayOf(t);
  const [projects, items, done8, ahead6, ins, todos, cal, reviews, msgs] = await Promise.all([
    D.getProjects(), D.getItems(), D.doneByWeek(4), D.openByDueWeek(4), D.insights(),
    D.getTodos(t, t), getEvents(t, t), D.getReviews({ limit: 40 }), D.getMessages({ limit: 100 }),
  ]);
  const active = projects.filter((p) => p.kind === "checklist");
  const running = projects.filter((p) => p.kind === "running");
  const series: Series[] = active.map((p) => ({ key: p.id, label: p.name, color: p.color }));
  const byId = Object.fromEntries(projects.map((p) => [p.id, p]));

  // chart 1: done per week
  const weeks8 = Array.from({ length: 4 }, (_, i) => addDays(done8.start, 7 * i));
  const doneVals = weeks8.map((w) => series.map((s) => done8.rows.filter((r) => r.week === w && r.project_id === s.key).reduce((a, r) => a + r.n, 0)));
  // chart 2: open work by due week
  const weeks6 = Array.from({ length: 4 }, (_, i) => addDays(ahead6.start, 7 * i));
  const aheadVals = weeks6.map((w) => series.map((s) => ahead6.rows.filter((r) => r.week === w && r.project_id === s.key).length));
  // chart 4: time per project, from the latest weekly reviews
  const lastWeek = reviews.find((r) => r.type === "project")?.week_start;
  const timeRows = reviews.filter((r) => r.type === "project" && r.week_start === lastWeek)
    .map((r) => ({ key: r.project_id || r.id, label: byId[r.project_id || ""]?.name || r.title, color: byId[r.project_id || ""]?.color || "other", v: Number(r.meta?.active_minutes) || 0 }))
    .filter((r) => r.v > 0).sort((a, b) => b.v - a.v);

  const open = items.filter((i) => i.status !== "done");
  const overdue = open.filter((i) => i.due && i.due < t);
  const dueToday = open.filter((i) => i.due === t);
  const nextEv = cal.events.filter((e) => !e.allDay && (e.endTime || "99") >= new Date().toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }));
  const waiting = msgs.filter((m) => ["new", "seen", "working"].includes(m.status)).length;
  const needs = msgs.filter((m) => m.status === "needs_you" && !m.archived).length;

  const clocks = active.flatMap((p) => p.deadlines.filter((d) => d.date >= t).map((d) => ({ ...d, p })))
    .sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);
  const thisWeekReviews = reviews.filter((r) => r.type !== "doc" && r.week_start === (reviews.find((x) => x.type !== "doc")?.week_start));

  if (!projects.length) return (
    <>
      <div className="hello">
        <div>
          <h1 className="page">{OWNER ? `Welcome, ${OWNER}` : "Welcome to Jarvis Central"}</h1>
          <div className="when">{new Date().toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric", timeZone: TZ })}</div>
        </div>
      </div>
      <section className="panel pb" style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: 10, maxWidth: "72ch" }}>
        <h2 className="ph-t">No projects yet</h2>
        <p style={{ margin: 0, color: "var(--ink-2)" }}>
          The site is running, but nothing has registered its projects yet. Finish the setup (see <code>SETUP.md</code> in the repo):
          Claude scans your projects folder, makes sure every project has a <code>CLAUDE.md</code> and a <code>PRD.md</code>,
          drafts a first checklist from each PRD, and registers them here.
        </p>
        <p style={{ margin: 0, color: "var(--ink-2)" }}>
          From your projects folder&apos;s Jarvis repo, run <code>node agent/projects.mjs sync</code>. The charts, the week plan and
          the Monday reviews fill in once projects exist.
        </p>
      </section>
    </>
  );

  return (
    <>
      <div className="hello">
        <div>
          <h1 className="page">{new Date().toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric", timeZone: TZ })}</h1>
          <div className="when">Week {isoWeek(t)} · {WD[weekday(t)]} · {open.length} open items across {active.length} projects</div>
        </div>
        <div className="clocks" aria-label="Upcoming deadlines">
          {clocks.map((c) => {
            const n = daysBetween(t, c.date);
            return (
              <Link key={c.p.id + c.date} href={`/p/${c.p.id}`} className={`clk${n <= 14 ? " hot" : ""}`} data-c={c.p.color}>
                <span className="p"><i className="dot" />{c.p.name}</span>
                <span className="d">{n === 0 ? "today" : n}{n > 0 && <small>{n === 1 ? " day" : " days"}</small>}</span>
                <span className="n">{c.label} · {fmtDate(c.date)}</span>
              </Link>
            );
          })}
        </div>
      </div>

      <div className="glance">
        <Link className="gl" href="/today">
          <span className="lbl">Next on your calendar</span>
          <span className="v" style={{ fontSize: 17, paddingTop: 3 }}>{nextEv[0] ? nextEv[0].startTime : calendarConfigured() ? "Free" : "—"}</span>
          <span className="s">{nextEv[0] ? nextEv[0].title : calendarConfigured() ? (cal.error ? "Calendar unavailable right now" : "Nothing else today") : "Connect Google Calendar"}</span>
        </Link>
        <Link className="gl" href="/today">
          <span className="lbl">Today's list</span>
          <span className="v">{todos.filter((x) => x.done).length}<span style={{ color: "var(--ink-3)", fontSize: 15 }}>/{todos.length}</span></span>
          <span className="s">{todos.length ? `${todos.filter((x) => x.kind === "life").length} personal · ${todos.filter((x) => x.kind === "work").length} work` : "Nothing planned yet"}</span>
        </Link>
        <Link className="gl" href="/today">
          <span className="lbl">Overdue</span>
          <span className={`v${overdue.length ? " bad" : ""}`}>{overdue.length}</span>
          <span className="s">{dueToday.length} due today</span>
        </Link>
        <Link className="gl" href="/inbox">
          <span className="lbl">Messages</span>
          <span className="v">{waiting}</span>
          <span className="s">{needs ? `${needs} need you` : waiting ? "with Claude" : "Nothing waiting"}</span>
        </Link>
        <Link className="gl" href="/reviews">
          <span className="lbl">Latest review</span>
          <span className="v" style={{ fontSize: 17, paddingTop: 3 }}>{thisWeekReviews.length ? fmtDate(thisWeekReviews[0].week_start!) : "Monday"}</span>
          <span className="s">{thisWeekReviews.length ? `${thisWeekReviews.length} reports` : `First reports arrive ${REVIEW_WHEN}`}</span>
        </Link>
      </div>

      <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <h2 className="lbl">Projects</h2>
        <div className="grid3">
          {active.map((p) => {
            const its = items.filter((i) => i.project_id === p.id);
            const dn = its.filter((i) => i.status === "done").length, dg = its.filter((i) => i.status === "doing").length;
            const late = its.filter((i) => i.status !== "done" && i.due && i.due < t).length, n = its.length || 1;
            const nextUp = its.filter((i) => i.status !== "done" && i.due).sort((a, b) => Number(b.status === "doing") - Number(a.status === "doing") || a.due!.localeCompare(b.due!)).slice(0, 3);
            const rv = reviews.find((r) => r.type === "project" && r.project_id === p.id);
            return (
              <Link key={p.id} href={`/p/${p.id}`} className="panel proj" data-c={p.color}>
                <div className="nm"><i className="dot" /><b>{p.name}</b>{rv?.verdict && <span className={`verdict v-${rv.verdict}`}>{rv.verdict.replace("-", " ")}</span>}<span className="pct">{Math.round((dn / n) * 100)}%</span></div>
                <p className="tag">{p.tagline}</p>
                <div className="seg" role="img" aria-label={`${dn} done, ${dg} in progress, ${late} overdue of ${its.length}`}>
                  <i className="d" style={{ width: `${(dn / n) * 100}%` }} /><i className="g" style={{ width: `${(dg / n) * 100}%` }} /><i className="l" style={{ width: `${(late / n) * 100}%` }} />
                </div>
                <div className="nums"><span><b>{dn}</b> done</span><span><b>{dg}</b> in progress</span><span><b>{its.length - dn - dg}</b> to do</span>{late > 0 && <span className="late"><b>{late}</b> overdue</span>}</div>
                <div className="next">
                  <span className="lbl">Next up</span>
                  {nextUp.map((i) => <div className="r" key={i.id}><span title={i.title}>{i.title}</span><Due d={i.due!} t={t} /></div>)}
                  {!nextUp.length && <span className="due">Nothing open with a date</span>}
                </div>
              </Link>
            );
          })}
        </div>
        {running.length > 0 && (
          <div className="running">
            {running.map((p) => (
              <div className="run" key={p.id}>
                <div className="h"><b>{p.name}</b><span className={`state${p.state === "Live" ? " live" : p.state === "Automated" ? " auto" : ""}`}>{p.state}</span></div>
                <p>{p.status}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      {ins.projects.length > 0 && (
        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <h2 className="lbl">Will each project make its next deadline?</h2>
          <div className="burns">{ins.projects.map((p) => <BurnUp key={p.id} p={p} today={t} />)}</div>
        </section>
      )}

      <div className="grid2">
        {ins.projects.length > 0 && <section className="panel">
          <div className="ph"><h2 className="ph-t">Pace vs needed</h2><span className="sp" /><span className="hint">Items finished per week, against what the next deadline needs</span></div>
          <PaceBullets rows={ins.projects} />
        </section>}
        {ins.projects.length > 0 && <section className="panel">
          <div className="ph"><h2 className="ph-t">Who it&apos;s waiting on</h2><span className="sp" /><span className="hint">Open checklist items by owner</span></div>
          <OwnerBars rows={ins.projects} />
        </section>}
        <section className="panel">
          <div className="ph"><h2 className="ph-t">Finished per week</h2><span className="sp" /><span className="hint">Checklist items done, last 4 weeks</span></div>
          <div className="pb" style={{ paddingBottom: 4 }}>
            <StackedColumns xs={weeks8} xLabels={weeks8.map((w) => fmtDate(w))} series={series} values={doneVals} unit="Items done" highlight={3} />
          </div>
        </section>
        <section className="panel">
          <div className="ph"><h2 className="ph-t">Your rhythm</h2><span className="sp" /><span className="hint">Last 4 weeks · items finished, todos ticked, messages sent</span></div>
          <Heatmap days={ins.heat} today={t} />
        </section>
        <section className="panel">
          <div className="ph"><h2 className="ph-t">Work ahead</h2><span className="sp" /><span className="hint">Open items due in the next 4 weeks · overdue counted in this week</span></div>
          <div className="pb" style={{ paddingBottom: 4 }}>
            <StackedColumns xs={weeks6} xLabels={weeks6.map((w, i) => (i === 0 ? "This wk" : fmtDate(w)))} series={series} values={aheadVals} unit="Open items" highlight={0} />
          </div>
        </section>
        <section className="panel">
          <div className="ph"><h2 className="ph-t">Where your time went</h2><span className="sp" /><span className="hint">{lastWeek ? `Active minutes in Claude sessions, week of ${fmtDate(lastWeek)}` : "From the Monday reviews"}</span></div>
          {timeRows.length ? <HBars rows={timeRows} format="minutes" />
            : <div className="empty">This fills in after the first Monday review reads your Claude sessions for the week.</div>}
        </section>
      </div>

      <section className="panel">
        <div className="ph"><h2 className="ph-t">This week's reviews</h2><span className="sp" /><Link href="/reviews" className="hint">All reviews →</Link></div>
        <div className="revlist">
          {thisWeekReviews.length ? thisWeekReviews.map((r) => (
            <Link key={r.id} href={`/reviews?id=${r.id}`} className="revrow" data-c={byId[r.project_id || ""]?.color || (r.type === "coaching" ? "life" : "other")}>
              <i className="dot" />
              <span className="t"><b>{r.title}</b><span>{r.headline}</span></span>
              {r.verdict ? <span className={`verdict v-${r.verdict}`}>{r.verdict.replace("-", " ")}</span> : <span className="pill">{r.type}</span>}
            </Link>
          )) : <div className="empty">{cap(REVIEW_WHEN)} your Mac writes a review per project, a recap of the week, a note on how you work with Claude, and a review of how you use Jarvis. They land here.</div>}
        </div>
      </section>
    </>
  );
}

function Due({ d, t }: { d: string; t: string }) {
  const n = daysBetween(t, d);
  return <span className={`due${n < 0 ? " late" : n <= 2 ? " soon" : ""}`}>{fmtDate(d)}</span>;
}
function isoWeek(d: string) {
  const x = new Date(d + "T12:00:00Z"), n = x.getUTCDay() || 7;
  x.setUTCDate(x.getUTCDate() + 4 - n);
  return Math.ceil(((+x - +new Date(Date.UTC(x.getUTCFullYear(), 0, 1))) / 864e5 + 1) / 7);
}
