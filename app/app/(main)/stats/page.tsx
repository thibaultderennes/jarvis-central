import Link from "next/link";
import { requireSession } from "@/lib/auth";
import * as D from "@/lib/data";
import { addDays, fmtDate, today } from "@/lib/time";
import { HBars, StackedColumns, type Series } from "@/components/Charts";
import { BurnUp, Heatmap, OwnerBars, PaceBullets } from "@/components/Insights";
import DailyStats from "@/components/DailyStats";

/** Every cross-project chart in one place (they used to fill the bottom of Home). Per-project charts live on each project's Stats view. */
export default async function StatsPage({ searchParams }: { searchParams: Promise<{ bucket?: string; proj?: string }> }) {
  await requireSession();
  const t = today(), sq = await searchParams;
  const bucket = sq.bucket === "week" || sq.bucket === "month" ? sq.bucket : "day", proj = typeof sq.proj === "string" && sq.proj ? sq.proj : undefined;
  const [projects, done8, ahead6, ins, reviews, stats] = await Promise.all([
    D.getProjects(), D.doneByWeek(4), D.openByDueWeek(4), D.insights(), D.getReviews({ limit: 40 }), D.dailyStats(undefined, proj, { bucket, items: true }),
  ]);
  // The top 3 get their own colour in every chart; everything else is grouped as "Other projects".
  const { featured: active, others } = D.splitFeatured(projects);
  const topIds = new Set(active.map((p) => p.id));
  const series: Series[] = [...active.map((p) => ({ key: p.id, label: p.name, color: p.color })), ...(others.length ? [{ key: "__others", label: "Other projects", color: "other" }] : [])];
  const inSeries = (pid: string, key: string) => (key === "__others" ? !topIds.has(pid) : pid === key);
  const byId = Object.fromEntries(projects.map((p) => [p.id, p]));
  const weeks8 = Array.from({ length: 4 }, (_, i) => addDays(done8.start, 7 * i));
  const doneVals = weeks8.map((w) => series.map((s) => done8.rows.filter((r) => r.week === w && inSeries(r.project_id, s.key)).reduce((a, r) => a + r.n, 0)));
  const weeks6 = Array.from({ length: 4 }, (_, i) => addDays(ahead6.start, 7 * i));
  const aheadVals = weeks6.map((w) => series.map((s) => ahead6.rows.filter((r) => r.week === w && inSeries(r.project_id, s.key)).length));
  // Time per project, from the latest weekly reviews.
  const lastWeek = reviews.find((r) => r.type === "project")?.week_start;
  const timeRows = reviews.filter((r) => r.type === "project" && r.week_start === lastWeek)
    .map((r) => ({ key: r.project_id || r.id, label: byId[r.project_id || ""]?.name || r.title, color: topIds.has(r.project_id || "") ? byId[r.project_id || ""]?.color : "other", v: Number(r.meta?.active_minutes) || 0 }))
    .filter((r) => r.v > 0).sort((a, b) => b.v - a.v);

  return (
    <>
      <div className="hello">
        <div>
          <h1 className="page">Stats</h1>
          <p className="sub">Pace, load and rhythm across your projects. Each project&apos;s own charts are on its Stats view.</p>
        </div>
        <div className="subtabs">{active.map((p) => <Link key={p.id} className="chip" href={`/p/${p.id}?v=stats`} data-c={p.color} style={{ display: "inline-flex", gap: 7, alignItems: "center" }}><i className="dot" />{p.name}</Link>)}</div>
      </div>

      {!projects.length && <div className="panel empty">No projects yet: the charts fill in once projects are registered (see SETUP.md).</div>}

      {ins.projects.length > 0 && (
        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <h2 className="lbl" style={{ margin: 0 }}>Will each project make its next deadline?</h2>
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
          <DailyStats stats={stats} projects={projects.map((p) => ({ id: p.id, name: p.name, color: p.color }))} filter project={proj} />
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
    </>
  );
}
