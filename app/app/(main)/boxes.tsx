import Link from "next/link";
import * as D from "@/lib/data";
import { getEvents, calendarConfigured } from "@/lib/calendar";
import { computeNeeds, type Need } from "@/lib/needs";
import { addDays, daysBetween, fmtDate, isoInTZ, mondayOf, today, TZ } from "@/lib/time";
import { cap, REVIEW_WHEN } from "@/lib/instance";
import { timelineData } from "@/lib/timeline";
import ProjectsBoard, { type Card } from "@/components/ProjectsBoard";
import Timeline, { MilestoneList } from "@/components/Timeline";
import { HBars, StackedColumns, type Series } from "@/components/Charts";
import { BurnUp, Heatmap, OwnerBars, PaceBullets } from "@/components/Insights";
import DailyStats from "@/components/DailyStats";
import { EmptyArt } from "@/components/brand";

/** What every box may read, loaded once per request and only when a box on the open tab asks for it. */
export type Ctx = ReturnType<typeof makeCtx>;
const once = <T,>(f: () => Promise<T>) => { let p: Promise<T> | undefined; return () => (p ??= f()); };
export function makeCtx(q: { w?: string; bucket?: string; proj?: string }) {
  const t = today();
  const base = once(async () => {
    const [projects, items, msgs, reviews] = await Promise.all([D.getProjects(), D.getItems(), D.getMessages({ limit: 200 }), D.getReviews({ limit: 40 })]);
    const { featured, others } = D.splitFeatured(projects);
    const topIds = new Set(featured.map((p) => p.id));
    const byId = Object.fromEntries(projects.map((p) => [p.id, p]));
    const live = items.filter((i) => byId[i.project_id]);
    return { projects, featured, others, topIds, byId, live, msgs, reviews, needs: computeNeeds(projects, live, msgs) };
  });
  return {
    t, q, base,
    todayCal: once(() => getEvents(t, t)),
    todos: once(() => D.getTodos(t, t)),
    week: once(() => Promise.all([getEvents(t, addDays(t, 6)), D.getTodos(t, addDays(t, 6))])),
    timeline: once(() => timelineData({ shift: Number(q.w) || 0 })),
    insights: once(() => D.insights()),
    sprints: once(() => D.getSprints({ from: mondayOf(t), to: addDays(mondayOf(t), 6) }).catch(() => [] as D.Sprint[])),
  };
}

const KIND: Record<Need["kind"], [string, string]> = { decide: ["Decide", "you"], merge: ["PR ready", "go"], reply: ["Reply", ""] };
const SHOWN = 10;

async function needs(c: Ctx) {
  const { needs, byId, topIds } = await c.base();
  const ago = (at: string) => { const n = daysBetween(isoInTZ(new Date(at)), c.t); return n <= 0 ? "today" : n === 1 ? "yesterday" : `${n} d ago`; };
  const row = (n: Need) => {
    const p = n.project_id ? byId[n.project_id] : null, [label, cls] = KIND[n.kind], age = daysBetween(isoInTZ(new Date(n.at)), c.t);
    return (
      <li key={n.key} className="need" data-c={p ? D.displayColor(p, topIds) : "other"}>
        <span className={`pill${cls ? " " + cls : ""}`}>{label}</span>
        <span className="np"><i className="dot" />{p?.name || "General"}</span>
        <Link className="nt" href={n.href} title={n.title}>{n.title}</Link>
        <span className={`due${age > 7 ? " soon" : ""}`}>{ago(n.at)}</span>
        <Link className={`btn sm${n.kind === "reply" ? " ghost" : ""}`} href={n.href}>{n.action}</Link>
      </li>
    );
  };
  if (!needs.count) return <div className="empty"><EmptyArt kind="clear" /><b>Nothing needs you right now.</b> Decisions only you can make, pull requests waiting for Approve &amp; merge and new replies from Claude land here.</div>;
  return (
    <div className="needs">
      <ul className="needlist">{needs.rows.slice(0, SHOWN).map(row)}</ul>
      {needs.count > SHOWN && <details className="needmore"><summary>Show {needs.count - SHOWN} more</summary><ul className="needlist">{needs.rows.slice(SHOWN).map(row)}</ul></details>}
    </div>
  );
}

async function top3(c: Ctx) {
  const { featured, others, topIds, live, reviews } = await c.base();
  const recentFrom = addDays(c.t, -28);
  const card = (p: D.Project): Card => {
    const its = live.filter((i) => i.project_id === p.id && i.status !== "cancelled");
    const nx = p.deadlines.filter((d) => d.date >= c.t).sort((x, y) => x.date.localeCompare(y.date))[0];
    const late = its.filter((i) => D.isOpen(i) && i.due && i.due < c.t).length;
    let pace: Card["pace"] = null;
    if (nx && topIds.has(p.id)) {
      const days = Math.max(1, daysBetween(c.t, nx.date)), dueBy = its.filter((i) => D.isOpen(i) && i.due && i.due <= nx.date).length;
      const rate = its.filter((i) => i.status === "done" && i.done_at && isoInTZ(new Date(i.done_at)) > recentFrom).length / 4, need = (dueBy / days) * 7;
      const r = (n: number) => (n >= 10 ? Math.round(n) : Math.round(n * 10) / 10);
      pace = !dueBy ? { text: `${nx.label}, ${fmtDate(nx.date)}: nothing open is due by then`, risk: false }
        : { text: `${nx.label}, ${fmtDate(nx.date)}: ${dueBy} open due by then · ${r(need)}/wk needed, ${r(rate)}/wk lately`, risk: (late > 0 && need > rate) || need > rate * 1.1 };
    }
    return {
      id: p.id, name: p.name, color: topIds.has(p.id) ? p.color : "other", tagline: p.tagline, kind: p.kind, state: p.state, status: p.status,
      done: its.filter((i) => i.status === "done").length, doing: its.filter((i) => i.status === "doing").length, late, total: its.length,
      next: its.filter((i) => D.isOpen(i) && i.due).sort((x, y) => Number(y.status === "doing") - Number(x.status === "doing") || x.due!.localeCompare(y.due!)).slice(0, 3).map((i) => ({ id: i.id, title: i.title, due: i.due! })),
      verdict: reviews.find((r) => r.type === "project" && r.project_id === p.id)?.verdict || null,
      deadline: nx ? { ...nx, days: daysBetween(c.t, nx.date) } : null,
      plan_enabled: p.plan_enabled !== false, weekly_minutes: p.weekly_minutes ?? null, reviews_enabled: p.reviews_enabled !== false, pace,
    };
  };
  return <ProjectsBoard featured={featured.map(card)} others={others.map(card)} today={c.t} />;
}

async function reviews(c: Ctx) {
  const { reviews, byId, topIds } = await c.base();
  const wk = reviews.find((x) => x.week_start)?.week_start;
  // Reviews of removed (archived) projects stay in /reviews but leave Home, like their items.
  const list = reviews.filter((r) => r.week_start && r.week_start === wk && (!r.project_id || byId[r.project_id]));
  if (!list.length) return <div className="empty">{cap(REVIEW_WHEN)} your Mac writes a review per project, a recap of the week, a note on how you work with Claude and a review of how you use the site. They land here.</div>;
  return (
    <div className="revlist">
      {list.map((r) => (
        <Link key={r.id} href={`/reviews?id=${r.id}`} className="revrow" data-c={byId[r.project_id || ""] ? D.displayColor(byId[r.project_id || ""], topIds) : r.type === "coaching" ? "life" : "other"}>
          <i className="dot" /><span className="t"><b>{r.title}</b><span>{r.headline}</span></span>
          {r.verdict ? <span className={`verdict v-${r.verdict}`}>{r.verdict.replace("-", " ")}</span> : <span className="pill">{r.type}</span>}
        </Link>
      ))}
      <Link href="/reviews" className="hint dlink">All reviews →</Link>
    </div>
  );
}

async function sprints(c: Ctx) {
  const [{ byId, topIds, live }, list] = await Promise.all([c.base(), c.sprints()]);
  const shown = list.filter((s) => byId[s.project_id]);
  if (!shown.length) return <div className="empty">No sprint this week. On a project&apos;s checklist, Select a few items, then Create sprint.</div>;
  return (
    <ul className="drows">
      {shown.map((s) => {
        const its = live.filter((i) => i.sprint_id === s.id && i.status !== "cancelled"), d = its.filter((i) => i.status === "done").length, p = byId[s.project_id];
        return (
          <li key={s.id} data-c={D.displayColor(p, topIds)}>
            <i className="dot" /><Link href={`/p/${p.id}?spr=${s.id}`} className="t">{p.name} · {s.name}</Link>
            <span className="due">{s.start < c.t ? `ends ${fmtDate(s.end)}` : `starts ${fmtDate(s.start)}`}</span>
            <span className="pill go">{d}/{its.length}</span>
          </li>
        );
      })}
    </ul>
  );
}

const MSG: Record<string, string> = { new: "queued", seen: "picked up", working: "working", answered: "answered", done: "done", needs_you: "needs you", error: "error" };
async function inbox(c: Ctx) {
  const { msgs, byId, topIds } = await c.base();
  const list = msgs.filter((m) => !m.archived && !m.treated_at).slice(-6).reverse();
  if (!list.length) return <div className="empty">Nothing open in the inbox. Message Claude from any project page or from the inbox.</div>;
  return (
    <ul className="drows">
      {list.map((m) => {
        const p = m.project_id ? byId[m.project_id] : null;
        return (
          <li key={m.id} data-c={p ? D.displayColor(p, topIds) : "other"}>
            <i className="dot" /><Link href="/inbox" className="t" title={m.text}>{m.text.split("\n")[0].slice(0, 140)}</Link>
            <span className={`pill${["new", "seen", "working"].includes(m.status) ? " go" : m.status === "needs_you" || m.status === "error" ? " crit" : ""}`}>{MSG[m.status] || m.status}</span>
          </li>
        );
      })}
    </ul>
  );
}

async function timeline(c: Ctx) { return <Timeline data={await c.timeline()} />; }
async function milestones(c: Ctx) { return <MilestoneList data={await c.timeline()} />; }

async function calendar(c: Ctx) {
  const [[cal, todos], { byId }] = await Promise.all([c.week(), c.base()]);
  if (!calendarConfigured() && !todos.length) return <div className="empty">Connect a calendar (SETUP.md, Calendars) to see the week here.</div>;
  const days = Array.from({ length: 7 }, (_, i) => addDays(c.t, i));
  return (
    <ul className="dweek">
      {days.map((d) => {
        const ev = cal.events.filter((e) => e.date === d), td = todos.filter((x) => x.date === d);
        return (
          <li key={d} className={d === c.t ? "cur" : undefined}>
            <span className="dd">{d === c.t ? "Today" : new Date(d + "T12:00:00Z").toLocaleDateString("en-CA", { timeZone: "UTC", weekday: "short", day: "numeric" })}</span>
            <span className="de">{ev.length ? ev.slice(0, 3).map((e) => `${e.allDay ? "" : (e.startTime || "") + " "}${e.title}`).join(" · ") : <span className="due">No events</span>}{ev.length > 3 ? ` +${ev.length - 3}` : ""}</span>
            <span className="due" title={td.map((x) => `${x.title}${x.project_id && byId[x.project_id] ? ` (${byId[x.project_id].name})` : ""}`).join("\n")}>{td.length ? `${td.filter((x) => x.done).length}/${td.length} todos` : ""}</span>
          </li>
        );
      })}
    </ul>
  );
}

/* ---- Stats ---- */
async function series(c: Ctx) {
  const { featured, others, topIds } = await c.base();
  const s: Series[] = [...featured.map((p) => ({ key: p.id, label: p.name, color: p.color })), ...(others.length ? [{ key: "__others", label: "Other projects", color: "other" }] : [])];
  return { s, inSeries: (pid: string, key: string) => (key === "__others" ? !topIds.has(pid) : pid === key) };
}
async function burnups(c: Ctx) {
  const ins = await c.insights();
  return ins.projects.length ? <div className="burns">{ins.projects.map((p) => <BurnUp key={p.id} p={p} today={c.t} />)}</div> : <div className="empty">Burn-ups appear once a project has a dated milestone in its PRD.</div>;
}
async function pace(c: Ctx) { const ins = await c.insights(); return ins.projects.length ? <PaceBullets rows={ins.projects} /> : <div className="empty">No dated milestones yet.</div>; }
async function owners(c: Ctx) { const ins = await c.insights(); return ins.projects.length ? <OwnerBars rows={ins.projects} /> : <div className="empty">No dated milestones yet.</div>; }
async function rhythm(c: Ctx) { const ins = await c.insights(); return <Heatmap days={ins.heat} today={c.t} />; }
async function finished(c: Ctx) {
  const [done, { s, inSeries }] = await Promise.all([D.doneByWeek(4), series(c)]);
  const weeks = Array.from({ length: 4 }, (_, i) => addDays(done.start, 7 * i));
  return <StackedColumns xs={weeks} xLabels={weeks.map((w) => fmtDate(w))} series={s} values={weeks.map((w) => s.map((x) => done.rows.filter((r) => r.week === w && inSeries(r.project_id, x.key)).reduce((a, r) => a + r.n, 0)))} unit="Items done" highlight={3} />;
}
async function ahead(c: Ctx) {
  const [a, { s, inSeries }] = await Promise.all([D.openByDueWeek(4), series(c)]);
  const weeks = Array.from({ length: 4 }, (_, i) => addDays(a.start, 7 * i));
  return <StackedColumns xs={weeks} xLabels={weeks.map((w, i) => (i === 0 ? "This wk" : fmtDate(w)))} series={s} values={weeks.map((w) => s.map((x) => a.rows.filter((r) => r.week === w && inSeries(r.project_id, x.key)).length))} unit="Open items" highlight={0} />;
}
async function daily(c: Ctx) {
  const bucket = c.q.bucket === "week" || c.q.bucket === "month" ? c.q.bucket : "day", proj = c.q.proj || undefined;
  const [{ projects }, stats] = await Promise.all([c.base(), D.dailyStats(undefined, proj, { bucket, items: true })]);
  return <DailyStats stats={stats} projects={projects.map((p) => ({ id: p.id, name: p.name, color: p.color }))} filter project={proj} />;
}
async function time(c: Ctx) {
  const { reviews, byId, topIds } = await c.base();
  const last = reviews.find((r) => r.type === "project")?.week_start;
  const rows = reviews.filter((r) => r.type === "project" && r.week_start === last)
    .map((r) => ({ key: r.project_id || r.id, label: byId[r.project_id || ""]?.name || r.title, color: topIds.has(r.project_id || "") ? byId[r.project_id || ""]?.color : "other", v: Number(r.meta?.active_minutes) || 0 }))
    .filter((r) => r.v > 0).sort((a, b) => b.v - a.v);
  return rows.length ? <HBars rows={rows} format="minutes" /> : <div className="empty">This fills in after the first Monday review reads your Claude sessions for the week.</div>;
}

export const RENDER: Record<string, (c: Ctx) => Promise<React.ReactNode>> = { needs, top3, reviews, sprints, inbox, timeline, milestones, calendar, burnups, pace, owners, finished, daily, rhythm, ahead, time };

/** One-line hints shown in a box's title bar. */
export async function hintsFor(c: Ctx, ids: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (ids.includes("needs")) { const { needs } = await c.base(); if (needs.count) out.needs = `${needs.count} · oldest first`; }
  if (ids.includes("timeline")) { const d = await c.timeline(); out.timeline = `${fmtDate(d.from)} – ${fmtDate(d.to)}`; }
  if (ids.includes("time")) { const { reviews } = await c.base(); const w = reviews.find((r) => r.type === "project")?.week_start; if (w) out.time = `week of ${fmtDate(w)}`; }
  if (ids.includes("calendar")) out.calendar = `next 7 days · ${TZ.split("/").pop()?.replace("_", " ")}`;
  return out;
}
