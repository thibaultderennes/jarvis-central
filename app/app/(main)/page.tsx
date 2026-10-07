import Link from "next/link";
import { requireSession } from "@/lib/auth";
import * as D from "@/lib/data";
import { calendarConfigured } from "@/lib/calendar";
import { daysBetween, fmtDate, TZ, WD, weekday } from "@/lib/time";
import { OWNER } from "@/lib/instance";
import { redirect } from "next/navigation";
import { BOXES, OLD_TAB_ANCHOR, SECTIONS, sanitizeLayout } from "@/lib/dashLayout";
import DashCanvas from "@/components/DashCanvas";
import { Glyph } from "@/components/brand";
import { hintsFor, makeCtx, RENDER } from "./boxes";
import "./home.css";

/**
 * Home: one page. The Now rail (the next thing to do in one sentence, today as a line, one summary line), then every
 * box on one grid you arrange with Customize: your top 3 first, then the overview, the map, the timeline and the stats
 * (layout in kv `dashboard.layout`). The jump links under the title scroll to each section; old `?tab=` links and /map
 * land on theirs.
 */
export default async function Home({ searchParams }: { searchParams: Promise<{ tab?: string; w?: string; bucket?: string; proj?: string }> }) {
  await requireSession();
  const sp = await searchParams;
  if (sp.tab) {
    const q = new URLSearchParams(Object.entries(sp).filter(([k, v]) => k !== "tab" && typeof v === "string") as [string, string][]).toString();
    redirect(`/${q ? `?${q}` : ""}#${OLD_TAB_ANCHOR[sp.tab] || "box-top3"}`);
  }
  const c = makeCtx(sp);
  const [b, saved] = await Promise.all([c.base(), D.kvGet("dashboard.layout")]);
  const when = new Date().toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric", timeZone: TZ });

  if (!b.projects.length) return (
    <>
      <div className="hello"><div><h1 className="page">{OWNER ? `Welcome, ${OWNER}` : "Welcome to Sentient Dash"}</h1><div className="when">{when}</div></div></div>
      <section className="panel pb" style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 8, maxWidth: "72ch" }}>
        <h2 className="ph-t">No projects yet</h2>
        <p style={{ margin: 0, color: "var(--ink-2)" }}>The site is running, but no projects are registered yet. Finish the setup in <code>SETUP.md</code>: Claude scans your projects folder, makes sure each one has a <code>CLAUDE.md</code> and a <code>PRD.md</code>, and registers them here. Or run <code>node agent/projects.mjs sync</code> from the Jarvis repo.</p>
      </section>
    </>
  );

  const places = sanitizeLayout(saved?.value).home;
  const ids = Object.keys(BOXES);
  const [rendered, hints, rail] = await Promise.all([Promise.all(ids.map((id) => RENDER[id](c))), hintsFor(c, ids), nowRail(c)]);
  const nodes = Object.fromEntries(ids.map((id, i) => [id, rendered[i]]));
  const open = b.live.filter(D.isOpen).length;

  return (
    <>
      <div className="hello dash-hello">
        <div>
          <h1 className="page"><Glyph n="home" />{when}</h1>
          <div className="when">Week {isoWeek(c.t)} · {WD[weekday(c.t)]} · {open} open items across {b.projects.length} projects</div>
        </div>
        <nav className="dtabs" aria-label="Jump to">
          {SECTIONS.filter((x) => places.some((p) => p.id === x.box)).map((x) => <a key={x.id} href={`#box-${x.box}`}>{x.label}</a>)}
        </nav>
      </div>
      {rail}
      <DashCanvas tab="home" places={places} nodes={nodes} hints={hints} />
    </>
  );
}

/** The Now rail: one sentence for the next thing (oldest "Needs you" row, else the most overdue item), today as a line, one summary line. */
async function nowRail(c: ReturnType<typeof makeCtx>) {
  const [b, cal, todos] = await Promise.all([c.base(), c.todayCal(), c.todos()]);
  const { needs, byId, topIds, live, projects } = b;
  const open = live.filter(D.isOpen);
  const overdue = open.filter((i) => i.due && i.due < c.t).sort((x, y) => x.due!.localeCompare(y.due!) || Number(y.critical) - Number(x.critical));
  const dueToday = open.filter((i) => i.due === c.t).length;
  const lateProjects = new Set(overdue.map((i) => i.project_id)).size;
  const nd = projects.flatMap((p) => p.deadlines.filter((d) => d.date >= c.t).map((d) => ({ ...d, p }))).sort((x, y) => x.date.localeCompare(y.date))[0];
  const now = new Date().toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });

  const n = needs.rows[0], o = overdue[0];
  const verb: Record<string, string> = { decide: "Decide", merge: "Approve the pull request for", reply: "Read Claude's reply on" };
  const next = n ? { text: <>{verb[n.kind]} <b>{n.title}</b></>, p: n.project_id ? byId[n.project_id] : null, href: n.href, action: n.action, why: `waiting ${Math.max(0, daysBetween(n.at.slice(0, 10), c.t))} d` }
    : o ? { text: <>Finish <b>{o.title}</b></>, p: byId[o.project_id], href: `/p/${o.project_id}#item-${o.id}`, action: "Open", why: `due ${fmtDate(o.due!)}` } : null;

  // Today as a line: timed events and timed todos, with "now" placed among them.
  type Mark = { time: string; text: string; past: boolean };
  const marks: Mark[] = [
    ...cal.events.filter((e) => !e.allDay && e.startTime).map((e) => ({ time: e.startTime!, text: e.title, past: (e.endTime || e.startTime!) < now })),
    ...todos.filter((x) => x.time && !x.done).map((x) => ({ time: x.time!, text: x.title, past: x.time! < now })),
  ].sort((x, y) => x.time.localeCompare(y.time));
  const before = marks.filter((m) => m.past).slice(-1), after = marks.filter((m) => !m.past).slice(0, 3);
  const done = todos.filter((x) => x.done).length;

  return (
    <section className="nowrail" aria-label="Now">
      <div className="nr-next">
        <span className="nr-l">Do next</span>
        {next ? <>
          <p>{next.text}{next.p && <> on <span data-c={D.displayColor(next.p, topIds)}><i className="dot" /> {next.p.name}</span></>}<span className="nr-why"> · {next.why}</span></p>
          <span className="nr-act"><Link className="btn sm" href={next.href}>{next.action}</Link>{needs.count > 1 && <Link className="btn sm ghost" href="#box-needs">{needs.count - 1} more</Link>}</span>
        </> : <p>Nothing is waiting on you. Pick something from <Link href="/today">Today</Link>.</p>}
      </div>
      <ol className="nr-day" aria-label="Today">
        {before.map((m) => <li key={"b" + m.time + m.text} className="past"><span className="t">{m.time}</span>{m.text}</li>)}
        <li className="cur"><span className="t">now</span><Link href="/today"><b>{done} of {todos.length}</b> on today&apos;s list</Link></li>
        {after.map((m) => <li key={"a" + m.time + m.text}><span className="t">{m.time}</span>{m.text}</li>)}
        {!marks.length && <li className="past"><span className="t" />{calendarConfigured() ? (cal.error ? "Calendar unavailable right now" : "No more events today") : "Connect a calendar to see today here"}</li>}
      </ol>
      <p className="nr-sum">
        {overdue.length ? <Link href="/today" className="nr-bad"><b>{overdue.length} late</b> in {lateProjects} project{lateProjects === 1 ? "" : "s"}</Link> : "Nothing late"}
        {dueToday ? ` · ${dueToday} due today` : ""}
        {nd && <> · next deadline <b>{nd.p.name} · {nd.label}</b> {daysBetween(c.t, nd.date) === 0 ? "today" : `in ${daysBetween(c.t, nd.date)} days`}</>}
      </p>
    </section>
  );
}

function isoWeek(d: string) {
  const x = new Date(d + "T12:00:00Z"), n = x.getUTCDay() || 7;
  x.setUTCDate(x.getUTCDate() + 4 - n);
  return Math.ceil(((+x - +new Date(Date.UTC(x.getUTCFullYear(), 0, 1))) / 864e5 + 1) / 7);
}
