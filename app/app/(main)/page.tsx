import Link from "next/link";
import { requireSession } from "@/lib/auth";
import * as D from "@/lib/data";
import { getEvents, calendarConfigured } from "@/lib/calendar";
import { computeNeeds, type Need } from "@/lib/needs";
import { addDays, daysBetween, fmtDate, isoInTZ, today, TZ, WD, weekday } from "@/lib/time";
import { cap, OWNER, REVIEW_WHEN } from "@/lib/instance";
import ProjectsBoard, { type Card } from "@/components/ProjectsBoard";
import "./home.css";

const KIND: Record<Need["kind"], [string, string]> = { decide: ["Decide", "you"], merge: ["PR ready", "go"], reply: ["Reply", ""] };
const SHOWN = 10;

export default async function Home() {
  await requireSession();
  const t = today();
  const [projects, items, todos, cal, reviews, msgs] = await Promise.all([
    D.getProjects(), D.getItems(), D.getTodos(t, t), getEvents(t, t), D.getReviews({ limit: 40 }), D.getMessages({ limit: 200 }),
  ]);
  const { featured: active, others } = D.splitFeatured(projects);
  const topIds = new Set(active.map((p) => p.id));
  const byId = Object.fromEntries(projects.map((p) => [p.id, p]));
  const live = items.filter((i) => byId[i.project_id]);

  const open = live.filter(D.isOpen);
  const overdue = open.filter((i) => i.due && i.due < t);
  const overdueProjects = new Set(overdue.map((i) => i.project_id)).size;
  const dueToday = open.filter((i) => i.due === t);
  const nextEv = cal.events.filter((e) => !e.allDay && (e.endTime || "99") >= new Date().toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }));
  const waiting = msgs.filter((m) => ["new", "seen", "working"].includes(m.status)).length;
  const pending = msgs.filter((m) => D.inboxGroup(m) === "pending").length;
  const needs = computeNeeds(projects, live, msgs);
  const deadlines = projects.flatMap((p) => p.deadlines.filter((d) => d.date >= t).map((d) => ({ ...d, p })))
    .sort((a, b) => a.date.localeCompare(b.date));
  const [nd, nd2] = deadlines;
  const recentFrom = addDays(t, -28);

  const card = (p: D.Project): Card => {
    const its = live.filter((i) => i.project_id === p.id && i.status !== "cancelled");
    const nx = p.deadlines.filter((d) => d.date >= t).sort((x, y) => x.date.localeCompare(y.date))[0];
    const late = its.filter((i) => D.isOpen(i) && i.due && i.due < t).length;
    let pace: Card["pace"] = null;
    if (nx && topIds.has(p.id)) {
      // Same idea as the burn-ups on /stats: items finished per week (last 4 weeks) against what the milestone needs.
      const days = Math.max(1, daysBetween(t, nx.date)), dueBy = its.filter((i) => D.isOpen(i) && i.due && i.due <= nx.date).length;
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
      deadline: nx ? { ...nx, days: daysBetween(t, nx.date) } : null,
      plan_enabled: p.plan_enabled !== false, weekly_minutes: p.weekly_minutes ?? null, reviews_enabled: p.reviews_enabled !== false, pace,
    };
  };
  // Weekly reports carry a week_start; documents and security audits don't and stay out of "this week".
  const thisWeekReviews = reviews.filter((r) => r.week_start && r.week_start === (reviews.find((x) => x.week_start)?.week_start));
  const when = new Date().toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric", timeZone: TZ });

  if (!projects.length) return (
    <>
      <div className="hello">
        <div>
          <h1 className="page">{OWNER ? `Welcome, ${OWNER}` : "Welcome to Jarvis Central"}</h1>
          <div className="when">{when}</div>
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

  const ago = (at: string) => { const n = daysBetween(isoInTZ(new Date(at)), t); return n <= 0 ? "today" : n === 1 ? "yesterday" : `${n} d ago`; };
  const row = (n: Need) => {
    const p = n.project_id ? byId[n.project_id] : null, [label, cls] = KIND[n.kind], age = daysBetween(isoInTZ(new Date(n.at)), t);
    return (
      <li key={n.key} className="need" data-c={p ? D.displayColor(p, topIds) : "other"}>
        <span className={`pill${cls ? " " + cls : ""}`}>{label}</span>
        <span className="np"><i className="dot" />{p?.name || "General"}</span>
        <Link className="nt" href={n.href} title={n.title}>{n.title}</Link>
        <span className={`due${age > 7 ? " soon" : ""}`} title={new Date(n.at).toLocaleString("en-CA", { timeZone: TZ })}>{ago(n.at)}</span>
        <Link className={`btn sm${n.kind === "reply" ? " ghost" : ""}`} href={n.href}>{n.action}</Link>
      </li>
    );
  };

  return (
    <>
      <div className="hello">
        <div>
          <h1 className="page">{when}</h1>
          <div className="when">Week {isoWeek(t)} · {WD[weekday(t)]} · {open.length} open items across {projects.length} projects</div>
        </div>
        <Link href="/stats" className="home-charts">All charts →</Link>
      </div>

      <div className="glance home-tiles">
        <Link className="gl" href="/today">
          <span className="lbl">Next on your calendar</span>
          <span className="v" style={{ fontSize: 17, paddingTop: 3 }}>{nextEv[0] ? nextEv[0].startTime : calendarConfigured() ? "Free" : "—"}</span>
          <span className="s">{nextEv[0] ? nextEv[0].title : calendarConfigured() ? (cal.error ? "Calendar unavailable right now" : "Nothing else today") : "Connect Google Calendar"}</span>
        </Link>
        <Link className="gl" href="/today">
          <span className="lbl">Today&apos;s list</span>
          <span className="v">{todos.filter((x) => x.done).length}<span style={{ color: "var(--ink-3)", fontSize: 15 }}>/{todos.length}</span></span>
          {todos.length > 0 && <span className="bar" role="img" aria-label={`${todos.filter((x) => x.done).length} of ${todos.length} done`}><i style={{ width: `${(todos.filter((x) => x.done).length / todos.length) * 100}%` }} /></span>}
          <span className="s">{todos.length ? `${todos.filter((x) => x.kind === "life").length} personal · ${todos.filter((x) => x.kind === "work").length} work` : "Nothing planned yet"}</span>
        </Link>
        <Link className="gl" href="/today">
          <span className="lbl">Overdue</span>
          <span className={`v${overdue.length ? " bad" : ""}`}>{overdue.length}</span>
          <span className="s">{overdue.length ? `across ${overdueProjects} project${overdueProjects === 1 ? "" : "s"}` : "Nothing late"}{dueToday.length ? ` · ${dueToday.length} due today` : ""}</span>
        </Link>
        <Link className={`gl${nd && daysBetween(t, nd.date) <= 14 ? " hot" : ""}`} href="/timeline" data-c={nd ? D.displayColor(nd.p, topIds) : undefined}>
          <span className="lbl">Next deadline</span>
          {nd ? <>
            <span className="v">{daysBetween(t, nd.date) === 0 ? "Today" : <>{daysBetween(t, nd.date)}<small> {daysBetween(t, nd.date) === 1 ? "day" : "days"}</small></>}</span>
            <span className="s"><i className="dot" /> {nd.p.name} · {nd.label} · {fmtDate(nd.date)}</span>
            {nd2 && <span className="s then">then {nd2.label} ({nd2.p.name}) in {daysBetween(t, nd2.date)} d</span>}
          </> : <>
            <span className="v" style={{ fontSize: 17, paddingTop: 3 }}>None set</span>
            <span className="s">Milestones from each PRD show here</span>
          </>}
        </Link>
      </div>

      <section className="panel needs" aria-labelledby="needs-h">
        <div className="ph">
          <h2 className="ph-t" id="needs-h">Needs you</h2>{needs.count > 0 && <span className="ct">{needs.count}</span>}
          <span className="sp" />
          <span className="hint">Oldest first{waiting ? ` · ${waiting} with Claude` : ""}{pending ? <> · <Link href="/inbox">{pending} opened, not treated</Link></> : ""}</span>
        </div>
        {needs.count ? (
          <>
            <ul className="needlist">{needs.rows.slice(0, SHOWN).map(row)}</ul>
            {needs.count > SHOWN && (
              <details className="needmore">
                <summary>Show {needs.count - SHOWN} more</summary>
                <ul className="needlist">{needs.rows.slice(SHOWN).map(row)}</ul>
              </details>
            )}
          </>
        ) : <div className="empty">Nothing needs you right now. Calls only you can make (the Decide section of each checklist), pull requests waiting for &ldquo;Approve &amp; merge&rdquo; and new replies from Claude land here.</div>}
      </section>

      <section id="projects" style={{ display: "flex", flexDirection: "column", gap: 10, scrollMarginTop: 110 }}>
        <h2 className="lbl">Your top 3</h2>
        <ProjectsBoard featured={active.map(card)} others={others.map(card)} today={t} />
      </section>

      <section className="panel">
        <div className="ph"><h2 className="ph-t">This week&apos;s reviews</h2><span className="sp" /><Link href="/reviews" className="hint">All reviews →</Link></div>
        <div className="revlist">
          {thisWeekReviews.length ? thisWeekReviews.map((r) => (
            <Link key={r.id} href={`/reviews?id=${r.id}`} className="revrow" data-c={byId[r.project_id || ""] ? D.displayColor(byId[r.project_id || ""], topIds) : r.type === "coaching" ? "life" : "other"}>
              <i className="dot" />
              <span className="t"><b>{r.title}</b><span>{r.headline}</span></span>
              {r.verdict ? <span className={`verdict v-${r.verdict}`}>{r.verdict.replace("-", " ")}</span> : <span className="pill">{r.type}</span>}
            </Link>
          )) : <div className="empty">{cap(REVIEW_WHEN)} your Mac writes a review per project, a recap of the week, a note on how you work with Claude, and a review of how you use Jarvis. They land here.</div>}
        </div>
      </section>
      <Link href="/stats" className="home-charts end">All charts: burn-ups, pace, finished per week, your rhythm, time per project →</Link>
    </>
  );
}

function isoWeek(d: string) {
  const x = new Date(d + "T12:00:00Z"), n = x.getUTCDay() || 7;
  x.setUTCDate(x.getUTCDate() + 4 - n);
  return Math.ceil(((+x - +new Date(Date.UTC(x.getUTCFullYear(), 0, 1))) / 864e5 + 1) / 7);
}
