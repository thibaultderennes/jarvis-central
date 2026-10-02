import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { timelineData } from "@/lib/timeline";
import { fmtDate } from "@/lib/time";
import Timeline, { MilestoneList } from "@/components/Timeline";

export default async function TimelinePage() {
  await requireSession();
  const data = await timelineData();
  const next = data.upcoming.find((m) => m.date >= data.today);
  return (
    <>
      <div className="hello">
        <div>
          <h1 className="page">Timeline</h1>
          <p className="sub">Last week to eight weeks out, one lane per project: milestones from each PRD.md, checklist due dates per day, and the Sunday plan&apos;s blocks for this week and next. Hover or tap a mark for details.</p>
        </div>
        <div className="when">{fmtDate(data.from)} – {fmtDate(data.to)}{next ? ` · next milestone ${fmtDate(next.date)}` : ""}</div>
      </div>
      <section className="panel">
        <div className="ph"><h2 className="ph-t">Projects</h2><span className="sp" /><span className="hint">{data.lanes.length} with dates{data.calendarError ? " · calendar unavailable right now" : ""}</span></div>
        <Timeline data={data} />
        {data.undated.length > 0 && (
          <div className="empty" style={{ paddingTop: 0 }}>Nothing dated in this window: {data.undated.map((p, i) => <span key={p.id}>{i ? ", " : ""}<Link href={`/p/${p.id}`}>{p.name}</Link></span>)}.</div>
        )}
      </section>
      <section className="panel">
        <div className="ph"><h2 className="ph-t">Upcoming milestones</h2><span className="sp" /><span className="hint">From each project&apos;s PRD.md milestones table</span></div>
        <MilestoneList data={data} />
      </section>
    </>
  );
}
