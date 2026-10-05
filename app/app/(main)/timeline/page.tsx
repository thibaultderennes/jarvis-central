import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { timelineData } from "@/lib/timeline";
import { fmtDate } from "@/lib/time";
import Timeline, { MilestoneList } from "@/components/Timeline";
import { Glyph, HeaderVec } from "@/components/brand";

export default async function TimelinePage({ searchParams }: { searchParams: Promise<{ w?: string }> }) {
  await requireSession();
  const data = await timelineData({ shift: Number((await searchParams).w) || 0 });
  const next = data.upcoming.find((m) => m.date >= data.today);
  return (
    <>
      <div className="hello">
        <div>
          <h1 className="page"><Glyph n="timeline" />Timeline</h1>
          <p className="sub">Ten weeks at a time (last week to eight weeks out unless you move it), one lane per project: milestones from each PRD.md, checklist due dates per day, and the Sunday plan&apos;s blocks for this week and next. Hover or tap a mark for details; drag a milestone or a due-date tick to another day, then confirm.</p>
        </div>
        <HeaderVec n="timeline" />
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
