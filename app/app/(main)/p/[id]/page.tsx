import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import * as D from "@/lib/data";
import { addDays, daysBetween, fmtDate, today } from "@/lib/time";
import Checklist from "@/components/Checklist";
import Screenings, { type ScreenCard } from "@/components/Screenings";
import WebsiteCard, { type WebsiteRun } from "@/components/WebsiteCard";
import { siteSummary, websiteKind } from "@/lib/website";
import Markdown from "@/components/Markdown";
import Thread from "@/components/Thread";
import ProjectSettings from "@/components/ProjectSettings";
import PlanButton from "@/components/PlanButton";
import Costs from "@/components/Costs";
import UnitEconomics from "@/components/UnitEconomics";
import ProjectStats from "@/components/ProjectStats";
import { getMetrics } from "@/lib/metrics";
import { deliveryStats, productStats } from "@/lib/projectStats";
import Timeline, { MilestoneList } from "@/components/Timeline";
import { timelineData } from "@/lib/timeline";
import { REVIEW_WHEN } from "@/lib/instance";
import { effectiveBuildMode, isBuildMode, nextReview, reviewEvery } from "@/lib/projectSettings";
import { filterHub, HUB_KINDS, hubDate, hubKind, hubList, isHubKind, reviewProposals, type HubKind } from "@/lib/docsHub";
import { AckButton, Proposals } from "@/components/ReviewActions";
import "./project.css";
import "../../finance/finance.css";

type Search = { v?: string; k?: string; r?: string; t?: string; tab?: string; w?: string; f?: string };
const VIEWS = ["checklist", "timeline", "docs", "finance", "stats", "settings"] as const;
type View = (typeof VIEWS)[number];
// Older links keep working: ?tab=… (before the 0.5.0 menu), ?v=dashboard (its summary now sits beside the checklist),
// and the Docs (?v=project) and Reviews (?v=reviews&k=…) views that Docs and reviews replaced in 0.7.4.6.
const LEGACY: Record<string, { v: View; k?: string }> = {
  checklist: { v: "checklist" }, dashboard: { v: "checklist" }, reviews: { v: "docs", k: "review" }, project: { v: "docs" }, strategy: { v: "docs" },
  security: { v: "docs", k: "security" }, screenings: { v: "docs", k: "screening" },
};
// Old ?k= values of the Reviews view → the hub's kinds.
const OLD_KIND: Record<string, HubKind> = { weekly: "review", screenings: "screening", security: "security" };

export default async function ProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  await requireSession();
  const { id } = await params, sp = await searchParams;
  const p = await D.getProject(id);
  if (!p) notFound();
  const legacy = sp.tab ? LEGACY[sp.tab] : sp.v ? LEGACY[sp.v] : undefined;
  const view: View = (VIEWS as readonly string[]).includes(sp.v || "") ? (sp.v as View) : legacy?.v || "checklist";
  const rawKind = sp.k || legacy?.k || "";
  const kind: HubKind | null = isHubKind(rawKind) ? rawKind : OLD_KIND[rawKind] || null;
  const t = today();
  const [items, reports, msgs, all, prefs, costs, economics, sprints] = await Promise.all([
    D.getItems({ project: id }),
    // Every report of the project, without bodies (one is loaded in full when it's opened).
    D.getReviews({ project: id, limit: 500, light: true }),
    D.getMessages({ limit: 50 }), D.getProjects(), D.getPrefs(), D.getCosts({ project: id, all: true }),
    view === "finance" ? D.getEconomics(id) : null, // the model grid is large: only the Finances view needs it
    view === "checklist" ? D.getSprints({ project: id }).catch(() => []) : [], // [] until the sprints table exists
  ]);
  const hub = hubList(reports);
  const weekly = reports.filter((r) => r.type === "project"), docs = reports.filter((r) => r.type === "doc");
  const screenings = hub.filter((r) => r.type === "screening");
  const unacked = hub.filter((r) => !r.acked_at).length;
  const SCREENS: [string, string, string][] = [
    ["vibecoded", "VibeCoded Screening", "The tells that make a site look AI-generated: default gradients and fonts, untouched UI kits, stock motion, buzzword copy, placeholder proof."],
    ["prelaunch", "Website pre-launch", "What breaks or leaks at launch: legal pages, HTTPS and headers, secrets, SEO and social cards, speed, accessibility, forms, email, analytics, one clear call to action."],
    ["rights", "Pre-launch rights & compliance", "Policies, consent and cookies, data you don't need, third-party SDKs, dark patterns and hidden fees, claims and reviews, licences, deletion requests. Not legal advice."],
  ];
  const cards: ScreenCard[] = SCREENS.map(([kind, title, what]) => {
    const last = screenings.find((r) => r.meta?.kind === kind);
    const c = (last?.meta?.counts || {}) as Record<string, number>;
    return { kind, title, what, running: msgs.some((m) => m.project_id === id && m.mode === "screen" && m.meta?.kind === kind && ["new", "seen", "working"].includes(m.status)),
      last: last ? { date: last.created_at.slice(0, 10), verdict: last.verdict, fail: c.fail || 0, live: c.live || 0 } : null };
  });
  const site = msgs.find((m) => m.project_id === id && m.mode === "website"); // newest first
  const siteRun: WebsiteRun = site ? { status: site.status, created_at: site.created_at, pr_url: (site.meta?.pr_url as string) || null, reply: site.reply } : null;
  const open = items.filter(D.isOpen), dn = items.filter((i) => i.status === "done").length;
  const next = p.deadlines.filter((d) => d.date >= t).sort((a, b) => a.date.localeCompare(b.date))[0];
  const planning = msgs.some((m) => m.project_id === id && m.mode === "plan" && ["new", "seen", "working"].includes(m.status));
  const rank = D.splitFeatured(all).featured.findIndex((x) => x.id === p.id) + 1;
  const href = (q: Record<string, string>) => `/p/${id}?${new URLSearchParams(q)}`;
  const menu: { v: View; label: string; count?: number; title?: string }[] = [
    { v: "checklist", label: "Checklist", count: open.length },
    { v: "timeline", label: "Timeline" },
    { v: "docs", label: "Docs and reviews", count: unacked || undefined, title: unacked ? `${unacked} not acknowledged yet` : undefined },
    { v: "finance", label: "Finances", count: costs.filter((c) => c.active).length || undefined },
    { v: "stats", label: "Stats" },
    { v: "settings", label: "Settings" },
  ];
  const every = reviewEvery(p.review_every_days);

  return (
    <div data-c={p.color} className="ppage">
      <div className="hello">
        <div>
          <h1 className="page" style={{ display: "flex", gap: 12, alignItems: "center" }}><i className="dot" style={{ width: 14, height: 14 }} />{p.name}</h1>
          <p className="sub">{p.tagline} · {dn} of {items.filter((i) => i.status !== "cancelled").length} done{next ? ` · ${next.label} in ${daysBetween(t, next.date)} days (${fmtDate(next.date)})` : ""}</p>
        </div>
        <div className="subtabs">
          {p.links.map((l) => <a key={l.url} className="chip" href={l.url} target="_blank" rel="noopener noreferrer">{l.label} ↗</a>)}
        </div>
      </div>

      <nav className="pviews" aria-label="Project views">
        {menu.map((m) => (
          <Link key={m.v} href={m.v === "checklist" ? `/p/${id}` : href({ v: m.v })} aria-current={view === m.v ? "page" : undefined}>
            {m.label}{m.count !== undefined && <span className="ct" title={m.title}>{m.count}</span>}
          </Link>
        ))}
      </nav>

      <div className="pmain">
        {view === "checklist" && (
          <div className="pchk">
            <Glance p={p} items={items} weekly={weekly} costs={costs} today={t} href={href} rank={rank} every={every} />
            <div className="pchk-list"><Checklist projectId={id} sections={p.sections} items={items} today={t} showDoneDefault={!!prefs.show_done_default} sprints={sprints} weeklyMinutes={p.weekly_minutes ?? null} /></div>
          </div>
        )}

        {view === "timeline" && <ProjectTimeline id={id} shift={Number(sp.w) || 0} />}

        {view === "docs" && (
          <DocsView p={p} hub={hub} items={items} kind={kind} onlyNew={sp.f === "new"} sel={sp.r} subtab={sp.t} href={href}
            empty={{
              review: <>{p.reviews_enabled === false ? `Scheduled reviews are off for ${p.name}. Turn them on,` : `The first review for ${p.name} arrives ${every === 7 ? REVIEW_WHEN : `within the hour, then every ${every} days`},`} or press Run now in <Link href={href({ v: "settings" })}>Settings</Link>. It covers what shipped, what slipped, an audit of the work, risks, and your top 3.</>,
              strategy: <>No strategy documents for {p.name} yet. Ask Claude for one from the Inbox (for example &ldquo;Run a CEO review of {p.name}: moat, 5 whys, competitors&rdquo;). They land here.</>,
              plan: <>No plan yet. Press &ldquo;{items.length ? "Refresh this project checklist" : "Plan this project"}&rdquo; in <Link href={href({ v: "settings" })}>Settings</Link>: the report lands here.</>,
              setup: <>No project setup report yet. The first setup run of {p.name} writes one here.</>,
              screening: <>No screening yet. Run one above: Claude checks the folder against a researched check list, writes the report here and adds what to fix to the checklist.</>,
              security: <>No audit reports yet. Markdown reports in the project folder&apos;s audits directory (<code>docs/audits</code> unless <code>audits.dir</code> says otherwise) appear here after the next sync, within an hour of landing.</>,
            }}
            screeningTools={<>
              <WebsiteCard projectId={id} kind={websiteKind(p)} summary={siteSummary(p)} siteUrl={p.site_url || ""} last={siteRun} />
              <Screenings projectId={id} cards={cards} />
            </>} />
        )}
        {view === "finance" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {economics && <UnitEconomics economics={economics} />}
            <Costs costs={costs} projects={all.map((x) => ({ id: x.id, name: x.name, color: x.color }))} project={id} currency={prefs.finance_currency || "USD"} today={t} />
            {!economics && <div className="panel empty">No unit-economics model for {p.name}. Add a <code>jarvis.economics.mjs</code> (or <code>.cjs</code>) file to the project folder that prices one point of a users × usage × plan grid; the Mac agent evaluates it hourly and shows profit by users, a profit grid, margins per plan and cost lines here. See docs/unit-economics.md.</div>}
          </div>
        )}

        {view === "stats" && <Stats project={p} today={t} />}

        {view === "settings" && (
          <SettingsView p={p} rank={rank} every={every} weekly={weekly} today={t}
            reviewRunning={msgs.some((m) => m.project_id === id && m.mode === "review" && ["new", "seen", "working"].includes(m.status))}
            plan={<PlanButton projectId={id} running={planning} lastPlan={docs.find((d) => d.title.startsWith("Project plan") || d.title.startsWith("Checklist refresh"))?.created_at.slice(0, 10) || null} hasChecklist={items.length > 0} />}
            hasChecklist={items.length > 0} />
        )}
      </div>
    </div>
  );
}

/** "At a glance" beside the checklist (a strip above it on narrower screens): what the old Dashboard view showed. */
/** A review's period: "Week of …" for the weekly run, or the N days a project on its own schedule covered. */
function periodLabel(r: D.Review) {
  if (!r.week_start) return r.title;
  const n = Number(r.meta?.period_days);
  return n ? `${n} days from ${fmtDate(r.week_start)}` : `Week of ${fmtDate(r.week_start)}`;
}

/** Settings: planning, the advisor review schedule, the checklist refresh, build mode. */
async function SettingsView({ p, rank, every, weekly, today: t, reviewRunning, plan, hasChecklist }: { p: D.Project; rank: number; every: number; weekly: D.Review[]; today: string; reviewRunning: boolean; plan: ReactNode; hasChecklist: boolean }) {
  const hb = await D.kvGet<{ info?: { build_mode?: string } }>("worker.heartbeat").catch(() => null);
  const last = weekly.map((r) => r.created_at.slice(0, 10)).sort().pop() || null;
  const next = nextReview({ every, last, today: t });
  return (
    <div className="pset">
      <section className="panel" aria-labelledby="set-about">
        <div className="ph"><h2 className="ph-t" id="set-about">About this project</h2><span className="sp" /><span className="hint">{p.kind === "running" ? "Running project" : "Checklist project"}{p.state ? ` · ${p.state}` : ""}</span></div>
        <div className="pb hub-about">
          <p>{p.tagline || <span className="due">No tagline yet: set one in the project&apos;s CLAUDE.md or `projects.overrides` in your config.</span>}</p>
          {p.status && <p className="st">{p.status}</p>}
          <div className="flags">
            {p.dir && <span title="Folder on your Mac">{p.dir}</span>}
            {p.deadlines.map((d) => <span key={d.date}>{d.label} · {fmtDate(d.date)}</span>)}
            {p.links.map((l) => <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer">{l.label} ↗</a>)}
          </div>
        </div>
      </section>
      <ProjectSettings id={p.id} plan={p.plan_enabled !== false} minutes={p.weekly_minutes ?? null} rank={rank || null}
        reviews={p.reviews_enabled !== false} every={every} lastReview={last ? fmtDate(last) : null} nextReview={next ? fmtDate(next) : null} reviewWhen={REVIEW_WHEN} reviewRunning={reviewRunning}
        buildMode={isBuildMode(p.build_mode) ? p.build_mode : null} defaultMode={effectiveBuildMode(null, hb?.value?.info?.build_mode)} />
      <section className="panel" aria-labelledby="set-checklist">
        <div className="ph"><h2 className="ph-t" id="set-checklist">Checklist</h2></div>
        <div className="pset-body">
          <p>{hasChecklist
            ? "Claude re-reads the folder and the earlier reviews, ticks what the folder shows is done, flags stale items and adds what's missing. The report lands in Docs and reviews."
            : "Claude goes through the folder, writes where the project stands and adds what's missing to the checklist. The report lands in Docs and reviews."}</p>
          {plan}
        </div>
      </section>
    </div>
  );
}

function Glance({ p, items, weekly, costs, today: t, href, rank, every }: { p: D.Project; items: D.Item[]; weekly: D.Review[]; costs: D.Cost[]; today: string; href: (q: Record<string, string>) => string; rank: number; every: number }) {
  const open = items.filter(D.isOpen);
  const late = open.filter((i) => i.due && i.due < t);
  const doing = open.filter((i) => i.status === "doing");
  const building = open.filter((i) => i.build_status === "working" || i.build_status === "merge_requested" || i.build_status === "sent_back" || (i.status === "doing" && (i.owner === "claude" || i.owner === "both") && !i.build_status));
  const prs = open.filter((i) => i.build_status === "pr_open").length;
  const review = weekly[0];
  const active = costs.filter((c) => c.active);
  const monthly = active.reduce<Record<string, number>>((acc, c) => ({ ...acc, [c.currency]: (acc[c.currency] || 0) + D.monthly(c) }), {});
  const next = p.deadlines.filter((d) => d.date >= t).sort((a, b) => a.date.localeCompare(b.date))[0];
  const n = next ? daysBetween(t, next.date) : 0;
  return (
    <aside className="pglance" aria-label="At a glance">
      <h2 className="lbl pg-h">At a glance</h2>
      <div className="pg-stats">
        <Link className="pg-s" href={href({ due: "overdue" })}><span className="lbl">Overdue</span><b className={late.length ? "bad" : ""}>{late.length}</b><small>{open.filter((i) => i.due === t).length} due today</small></Link>
        <div className="pg-s"><span className="lbl">Open</span><b>{open.length}</b><small>{items.filter((i) => i.status === "done").length} done</small></div>
        <div className="pg-s"><span className="lbl">In progress</span><b>{doing.length}</b><small>{prs ? `${prs} PR${prs > 1 ? "s" : ""} for you` : "being worked on"}</small></div>
        <div className="pg-s"><span className="lbl">Claude building</span><b className={building.length ? "go" : ""}>{building.length}</b><small>{building.length ? "refreshes on its own" : "nothing queued"}</small></div>
        <Link className="pg-s wide" href={href({ v: "finance" })}><span className="lbl">Costs / month</span><b className="sm">{Object.keys(monthly).length ? Object.entries(monthly).map(([c, v]) => `${v.toFixed(0)} ${c}`).join(" + ") : "—"}</b><small>{active.length ? `${active.length} recurring` : "nothing entered"}</small></Link>
      </div>
      <div className="pg-cards">
        <Link className="pg-c" href={review ? href({ v: "docs", r: review.id }) : href({ v: "docs", k: "review" })}>
          <span className="lbl">Latest review</span>
          <span className="pg-t">{review?.verdict && <span className={`verdict v-${review.verdict}`}>{review.verdict.replace("-", " ")}</span>}<span>{review?.week_start ? periodLabel(review) : review ? "No verdict" : every === 7 ? `First one ${REVIEW_WHEN}` : `Every ${every} days`}</span></span>
          {review?.headline && <span className="pg-d">{review.headline}</span>}
        </Link>
        <Link className="pg-c" href={href({ v: "timeline" })}>
          <span className="lbl">Next milestone</span>
          {next ? <span className="pg-t"><span>{next.label}</span><span className={`due${n <= 2 ? " soon" : ""}`}>{n === 0 ? "today" : `${n} d`} · {fmtDate(next.date)}</span></span>
            : <span className="pg-d">None dated. Add a Milestones table to PRD.md.</span>}
        </Link>
        <Link className="pg-c" href={href({ v: "settings" })}>
          <span className="lbl">Project settings</span>
          <span className="pg-d">{[p.plan_enabled !== false ? "planned" : "not planned", p.reviews_enabled !== false ? `reviewed every ${every} days` : "no scheduled review", p.build_mode === "lugh" ? "Lugh builds" : p.build_mode === "goibniu" ? "Goibniu builds" : "", rank ? `top 3 · #${rank}` : ""].filter(Boolean).join(" · ")}</span>
        </Link>
      </div>
    </aside>
  );
}

async function ProjectTimeline({ id, shift }: { id: string; shift: number }) {
  const data = await timelineData({ project: id, shift });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <section className="panel">
        <div className="ph"><h2 className="ph-t">Timeline</h2><span className="sp" /><span className="hint">{fmtDate(data.from)} – {fmtDate(data.to)} · one lane per section · dashed lines are milestones</span></div>
        <Timeline data={data} />
      </section>
      <section className="panel">
        <div className="ph"><h2 className="ph-t">Upcoming milestones</h2><span className="sp" /><span className="hint">From PRD.md&apos;s milestones table</span></div>
        <MilestoneList data={data} showProject={false} />
      </section>
    </div>
  );
}

/** Stats: Product (metrics snapshots, costs, unit economics) and Delivery (flow metrics from the checklist). */
async function Stats({ project, today: t }: { project: D.Project; today: string }) {
  const [items, snaps, costs, economics, prefs, weekly] = await Promise.all([
    D.getItems({ project: project.id }), getMetrics({ project: project.id, since: addDays(t, -120) }), D.getCosts({ project: project.id }),
    D.getEconomics(project.id), D.getPrefs(), D.dailyStats(13, project.id, { bucket: "week" }),
  ]);
  const { latest, ...product } = productStats(snaps, costs, economics, prefs.finance_currency || "USD");
  return <ProjectStats project={{ id: project.id, name: project.name }} today={t} product={{ ...product, latest: latest && { date: latest.date, source: latest.source } }} delivery={deliveryStats(project, items, weekly, t)} />;
}

/**
 * Docs and reviews: every report of the project in one list, newest first (advisor reviews, strategy docs, plans,
 * project setup, screenings, security audits), with a kind filter, a "new" filter and count, Acknowledge per report,
 * and the tasks each one proposes (Push to checklist, or links to what's already on it).
 */
async function DocsView({ p, hub, items, kind, onlyNew, sel, subtab, href, empty, screeningTools }: {
  p: D.Project; hub: D.Review[]; items: D.Item[]; kind: HubKind | null; onlyNew: boolean; sel?: string; subtab?: string;
  href: (q: Record<string, string>) => string; empty: Record<HubKind, ReactNode>; screeningTools: ReactNode;
}) {
  const list = filterHub(hub, { kind, unacked: onlyNew });
  const q = (o: Record<string, string | undefined>) => href(Object.fromEntries(Object.entries({ v: "docs", k: kind || undefined, f: onlyNew ? "new" : undefined, ...o }).filter(([, v]) => v)) as Record<string, string>);
  const fresh = hub.filter((r) => !r.acked_at).length;
  const counts = new Map<HubKind, number>();
  for (const r of hub) { const k = hubKind(r)!; counts.set(k, (counts.get(k) || 0) + 1); }
  const kinds = HUB_KINDS.filter((k) => counts.get(k.id) || k.id === "review" || k.id === "screening" || k.id === kind);
  const picked = hub.find((x) => x.id === sel) || list[0];
  const r = picked ? await D.getReview(picked.id) : null;
  const one = (x: D.Review) => HUB_KINDS.find((k) => k.id === hubKind(x))?.one || "";
  return (
    <div className="hub" data-track-section="Docs and reviews">
      <div className="hub-bar">
        <div className="chips" role="group" aria-label="Kind of report">
          <Link className="chip" aria-pressed={!kind} href={q({ k: undefined })}>All{hub.length > 0 && ` (${hub.length})`}</Link>
          {kinds.map((k) => <Link key={k.id} className="chip" aria-pressed={kind === k.id} href={q({ k: k.id })}>{k.label}{counts.get(k.id) ? ` (${counts.get(k.id)})` : ""}</Link>)}
        </div>
        <Link className="chip" aria-pressed={onlyNew} href={q({ f: onlyNew ? undefined : "new" })} title="Reports you haven't acknowledged yet">
          Not acknowledged ({fresh})
        </Link>
      </div>
      {kind === "screening" && screeningTools}
      {!list.length || !r ? (
        <div className="panel empty">{onlyNew && hub.length ? <>Nothing new{kind ? ` in ${HUB_KINDS.find((k) => k.id === kind)?.label.toLowerCase()}` : ""}: you&apos;ve acknowledged every report. <Link href={q({ f: undefined })}>Show all</Link>.</> : kind ? empty[kind] : <>No reports for {p.name} yet. Advisor reviews, strategy docs, plans, project setup, screenings and security audits all land here.</>}</div>
      ) : (
        <div className="grid-review hub-grid">
          <nav className="panel revlist" aria-label="Reports">
            {list.map((x) => (
              <Link key={x.id} href={q({ r: x.id })} className={`revrow${x.acked_at ? "" : " new"}`} aria-current={x.id === r.id ? "page" : undefined}>
                <i className="dot" />
                <span className="t"><b>{periodLabel(x)}</b><span>{[one(x), fmtDate(hubDate(x)), x.headline].filter(Boolean).join(" · ")}</span></span>
                <span className="hub-tags">
                  {!x.acked_at && <span className="pill">New</span>}
                  {x.verdict && <span className={`verdict v-${x.verdict}`}>{x.verdict.replace("-", " ")}</span>}
                </span>
              </Link>
            ))}
          </nav>
          <Report r={r} p={p} items={items} subtab={subtab} q={q} />
        </div>
      )}
    </div>
  );
}

async function Report({ r, p, items, subtab, q }: { r: D.Review; p: D.Project; items: D.Item[]; subtab?: string; q: (o: Record<string, string | undefined>) => string }) {
  const thread = await D.getMessages({ review: r.id, limit: 100 });
  const tabs = (r.meta?.tabs as { key: string; label: string; body_md: string; verdict?: string; headline?: string }[] | undefined) || [];
  const cur = tabs.find((x) => x.key === subtab);
  // Reviews mirrored from a file (security audits) carry the file's path.
  const file = typeof r.meta?.file === "string" ? r.meta.file : null;
  const proposals = reviewProposals(r, items);
  const titles = Object.fromEntries(items.map((i) => [i.id, i.title]));
  return (
    <article className="panel pb hub-doc">
      <div className="hub-doc-h">
        {r.verdict && <span className={`verdict v-${r.verdict}`}>{r.verdict.replace("-", " ")}</span>}
        <span className="lbl">{r.title}</span>
        <span className="hint">{fmtDate(hubDate(r))}{file ? ` · ${file}` : ""}</span>
        <span className="sp" />
        <AckButton id={r.id} ackedOn={r.acked_at ? fmtDate(r.acked_at.slice(0, 10)) : null} />
      </div>
      {r.headline && <p className="hub-head">{r.headline}</p>}
      {tabs.length > 0 && (
        <div className="subtabs hub-tabs">
          <Link className="chip" aria-pressed={!cur} href={q({ r: r.id })}>Summary</Link>
          {tabs.map((x) => <Link key={x.key} className="chip" aria-pressed={cur?.key === x.key} href={q({ r: r.id, t: x.key })}>{x.label}</Link>)}
        </div>
      )}
      {cur && (cur.verdict || cur.headline) && (
        <p className="hub-tabhead">{cur.verdict && <span className={`verdict v-${cur.verdict}`}>{cur.verdict.replace("-", " ")}</span>}{cur.headline}</p>
      )}
      <Markdown>{cur ? cur.body_md : r.body_md}</Markdown>
      {proposals.length > 0 && <Proposals reviewId={r.id} projectId={p.id} list={proposals} sections={p.sections.map((s) => ({ id: s.id, name: s.name, owner_default: s.owner_default }))} titles={titles} />}
      <Thread reviewId={r.id} projectId={r.project_id} tab={cur?.key || null} messages={thread} canBuild />
    </article>
  );
}
