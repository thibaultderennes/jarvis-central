import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import * as D from "@/lib/data";
import { daysBetween, fmtDate, today } from "@/lib/time";
import Checklist from "@/components/Checklist";
import Markdown from "@/components/Markdown";
import Thread from "@/components/Thread";
import ProjectSettings from "@/components/ProjectSettings";
import PlanButton from "@/components/PlanButton";
import Costs from "@/components/Costs";
import { BurnUp } from "@/components/Insights";
import DailyStats from "@/components/DailyStats";
import { REVIEW_WHEN } from "@/lib/instance";
import "./project.css";
import "../../finance/finance.css";

type Search = { v?: string; k?: string; r?: string; t?: string; tab?: string };
const VIEWS = ["dashboard", "checklist", "project", "reviews", "finance", "stats"] as const;
type View = (typeof VIEWS)[number];
// Links from before the left menu (?tab=…) keep working.
const LEGACY: Record<string, { v: View; k?: string }> = { checklist: { v: "checklist" }, reviews: { v: "reviews" }, strategy: { v: "project" }, security: { v: "reviews", k: "security" } };

export default async function ProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  await requireSession();
  const { id } = await params, sp = await searchParams;
  const p = await D.getProject(id);
  if (!p) notFound();
  const legacy = sp.tab ? LEGACY[sp.tab] : undefined;
  const view: View = (VIEWS as readonly string[]).includes(sp.v || "") ? (sp.v as View) : legacy?.v || "dashboard";
  const kind = sp.k || legacy?.k || "weekly";
  const t = today();
  const [items, weekly, docs, audits, msgs, all, prefs, costs] = await Promise.all([
    D.getItems({ project: id }), D.getReviews({ type: "project", project: id, limit: 30 }), D.getReviews({ type: "doc", project: id, limit: 30 }),
    D.getReviews({ type: "security", project: id, limit: 100 }).then((l) => l.sort(D.newestFileFirst)),
    D.getMessages({ limit: 50 }), D.getProjects(), D.getPrefs(), D.getCosts({ project: id, all: true }),
  ]);
  const open = items.filter(D.isOpen), dn = items.filter((i) => i.status === "done").length;
  const next = p.deadlines.filter((d) => d.date >= t).sort((a, b) => a.date.localeCompare(b.date))[0];
  const planning = msgs.some((m) => m.project_id === id && m.mode === "plan" && ["new", "seen", "working"].includes(m.status));
  const rank = D.splitFeatured(all).featured.findIndex((x) => x.id === p.id) + 1;
  const href = (q: Record<string, string>) => `/p/${id}?${new URLSearchParams(q)}`;
  const menu: { v: View; label: string; count?: number }[] = [
    { v: "dashboard", label: "Dashboard" },
    { v: "checklist", label: "Checklists", count: open.length },
    { v: "project", label: "Project", count: docs.length || undefined },
    { v: "reviews", label: "Reviews", count: weekly.length + audits.length || undefined },
    { v: "finance", label: "Finances", count: costs.filter((c) => c.active).length || undefined },
    { v: "stats", label: "Statistics" },
  ];

  return (
    <div data-c={p.color} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="hello">
        <div>
          <h1 className="page" style={{ display: "flex", gap: 12, alignItems: "center" }}><i className="dot" style={{ width: 14, height: 14 }} />{p.name}</h1>
          <p className="sub">{p.tagline} · {dn} of {items.filter((i) => i.status !== "cancelled").length} done{next ? ` · ${next.label} in ${daysBetween(t, next.date)} days (${fmtDate(next.date)})` : ""}</p>
        </div>
        <div className="subtabs">
          <PlanButton projectId={id} running={planning} lastPlan={docs.find((d) => d.title.startsWith("Project plan") || d.title.startsWith("Checklist refresh"))?.created_at.slice(0, 10) || null} hasChecklist={items.length > 0} />
          {p.links.map((l) => <a key={l.url} className="chip" href={l.url} target="_blank" rel="noopener noreferrer">{l.label} ↗</a>)}
        </div>
      </div>

      <div className="pgrid">
        <nav className="pmenu" aria-label="Project sections">
          {menu.map((m) => (
            <Link key={m.v} href={m.v === "dashboard" ? `/p/${id}` : href({ v: m.v })} aria-current={view === m.v ? "page" : undefined}>
              <span>{m.label}</span>{m.count !== undefined && <span className="ct">{m.count}</span>}
            </Link>
          ))}
        </nav>
        <div className="pmain">
          {view === "dashboard" && <Dashboard p={p} items={items} weekly={weekly} docs={docs} audits={audits} costs={costs} today={t} href={href} rank={rank} prefs={prefs} />}

          {view === "checklist" && <Checklist projectId={id} sections={p.sections} items={items} today={t} showDoneDefault={!!prefs.show_done_default} />}

          {view === "project" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <section className="panel">
                <div className="ph"><h2 className="ph-t">Description</h2><span className="sp" /><span className="hint">{p.kind === "running" ? "Running project" : "Checklist project"}{p.state ? ` · ${p.state}` : ""}</span></div>
                <div className="pb" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <p style={{ margin: 0 }}>{p.tagline || <span className="due">No tagline yet: set one in the project&apos;s CLAUDE.md or `projects.overrides` in your config.</span>}</p>
                  {p.status && <p style={{ margin: 0, color: "var(--ink-2)" }}>{p.status}</p>}
                  <div className="flags">
                    {p.dir && <span title="Folder on your Mac">{p.dir}</span>}
                    {p.deadlines.map((d) => <span key={d.date}>{d.label} · {fmtDate(d.date)}</span>)}
                    {p.links.map((l) => <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" style={{ fontFamily: "var(--mono)", fontSize: 10.5, padding: "1px 7px", borderRadius: 4, background: "var(--line-2)", color: "var(--doing)", textDecoration: "none" }}>{l.label} ↗</a>)}
                  </div>
                </div>
              </section>
              <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div className="lbl">Strategy documents · moat, why it matters, competitors, plans</div>
                {docs.length ? <ReviewPicker list={docs} sel={sp.r} base={{ v: "project" }} href={href} subtab={sp.t} />
                  : <div className="panel empty">No strategy documents for {p.name} yet. Ask Claude for one from the Inbox (for example &ldquo;Run a CEO review of {p.name}: moat, 5 whys, competitors&rdquo;), or press &ldquo;{items.length ? "Refresh this project checklist" : "Plan this project"}&rdquo; for a situation report. They land here.</div>}
              </section>
            </div>
          )}

          {view === "reviews" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div className="chips" role="group" aria-label="Kind of review">
                <Link className="chip" aria-pressed={kind !== "security"} href={href({ v: "reviews" })}>Weekly reviews{weekly.length > 0 && ` (${weekly.length})`}</Link>
                <Link className="chip" aria-pressed={kind === "security"} href={href({ v: "reviews", k: "security" })}>Security audits{audits.length > 0 && ` (${audits.length})`}</Link>
              </div>
              {kind !== "security" && (weekly.length ? <ReviewPicker list={weekly} sel={sp.r} base={{ v: "reviews" }} href={href} />
                : <div className="panel empty">The first weekly review for {p.name} arrives {REVIEW_WHEN}. It covers what shipped, what slipped, an audit of the week&apos;s work, risks, and your top 3 for the week.</div>)}
              {kind === "security" && (audits.length ? <ReviewPicker list={audits} sel={sp.r} base={{ v: "reviews", k: "security" }} href={href} />
                : <div className="panel empty">No audit reports yet. Markdown reports in the project folder&apos;s audits directory (<code>docs/audits</code> unless <code>audits.dir</code> says otherwise) appear here after the next sync, within an hour of landing.</div>)}
            </div>
          )}

          {view === "finance" && <Costs costs={costs} projects={all.map((x) => ({ id: x.id, name: x.name, color: x.color }))} project={id} currency={prefs.finance_currency || "USD"} today={t} />}

          {view === "stats" && <Stats projectId={id} today={t} />}
        </div>
      </div>
    </div>
  );
}

/** The landing view: what to do next, what is in progress, what the reviews say. Every card shows data that exists. */
function Dashboard({ p, items, weekly, docs, audits, costs, today: t, href, rank, prefs }: { p: D.Project; items: D.Item[]; weekly: D.Review[]; docs: D.Review[]; audits: D.Review[]; costs: D.Cost[]; today: string; href: (q: Record<string, string>) => string; rank: number; prefs: D.Prefs }) {
  const open = items.filter(D.isOpen);
  const late = open.filter((i) => i.due && i.due < t);
  const nextUp = [...open].sort((a, b) => Number(!!b.due && b.due < t) - Number(!!a.due && a.due < t) || Number(b.critical) - Number(a.critical) || (a.due || "9").localeCompare(b.due || "9")).slice(0, 6);
  const doing = open.filter((i) => i.status === "doing");
  const owners = { you: open.filter((i) => !i.owner || i.owner === "founder").length, claude: open.filter((i) => i.owner === "claude").length, both: open.filter((i) => i.owner === "both").length };
  const review = weekly[0], doc = docs[0], audit = audits[0];
  const monthly = costs.filter((c) => c.active).reduce<Record<string, number>>((acc, c) => ({ ...acc, [c.currency]: (acc[c.currency] || 0) + D.monthly(c) }), {});
  const upcoming = p.deadlines.filter((d) => d.date >= t).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 4);
  const Due = ({ d }: { d: string }) => { const n = daysBetween(t, d); return <span className={`due${n < 0 ? " late" : n <= 2 ? " soon" : ""}`}>{fmtDate(d)}</span>; };
  const ItemRow = ({ i }: { i: D.Item }) => (
    <div className="dr">
      <span className={`dstat${i.status === "doing" ? " doing" : ""}`} aria-hidden="true" />
      <span className="dt2"><span>{i.title}</span><small>{i.id}{i.owner ? ` · ${i.owner === "founder" ? "you" : i.owner}` : ""}{i.critical ? " · critical" : ""}{i.build_status ? ` · ${i.build_status.replace("_", " ")}` : ""}</small></span>
      {i.pr_url ? <a className="due" href={i.pr_url} target="_blank" rel="noopener noreferrer">PR ↗</a> : i.due ? <Due d={i.due} /> : <span className="due">no date</span>}
    </div>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="glance dash">
        <Link className="gl" href={href({ v: "checklist" })}><span className="lbl">Open</span><span className="v">{open.length}</span><span className="s">{items.filter((i) => i.status === "done").length} done · {items.filter((i) => i.status === "cancelled").length} cancelled</span></Link>
        <Link className="gl" href={href({ v: "checklist" })}><span className="lbl">Overdue</span><span className={`v${late.length ? " bad" : ""}`}>{late.length}</span><span className="s">{open.filter((i) => i.due === t).length} due today</span></Link>
        <Link className="gl" href={href({ v: "checklist" })}><span className="lbl">In progress</span><span className="v">{doing.length}</span><span className="s">{doing.filter((i) => i.build_status === "pr_open").length ? `${doing.filter((i) => i.build_status === "pr_open").length} PR waiting for you` : doing.filter((i) => i.build_status === "working").length ? "Claude is building" : "—"}</span></Link>
        <Link className="gl" href={href({ v: "reviews" })}><span className="lbl">Latest review</span><span className="v" style={{ fontSize: 17, paddingTop: 3 }}>{review?.verdict ? review.verdict.replace("-", " ") : review ? "no verdict" : "none yet"}</span><span className="s">{review?.week_start ? `Week of ${fmtDate(review.week_start)}` : `First one ${REVIEW_WHEN}`}</span></Link>
        <Link className="gl" href={href({ v: "finance" })}><span className="lbl">Recurring costs</span><span className="v" style={{ fontSize: 17, paddingTop: 3 }}>{Object.keys(monthly).length ? Object.entries(monthly).map(([c, v]) => `${v.toFixed(0)} ${c}`).join(" + ") : "—"}</span><span className="s">{costs.filter((c) => c.active).length ? "per month" : "Nothing entered yet"}</span></Link>
      </div>
      <ProjectSettings id={p.id} plan={p.plan_enabled !== false} minutes={p.weekly_minutes ?? null} reviews={p.reviews_enabled !== false} rank={rank || null} />
      <div className="grid2">
        <section className="panel">
          <div className="ph"><h2 className="ph-t">Next up</h2><span className="sp" /><Link className="hint" href={href({ v: "checklist" })}>Open the checklist →</Link></div>
          <div className="pb" style={{ padding: "4px 14px 8px" }}>
            {nextUp.map((i) => <ItemRow key={i.id} i={i} />)}
            {!nextUp.length && <div className="empty" style={{ padding: "10px 0" }}>{items.length ? "Everything is done or cancelled." : `No checklist yet: press "Plan this project", or add items in Checklists.`}</div>}
          </div>
        </section>
        <section className="panel">
          <div className="ph"><h2 className="ph-t">In progress</h2><span className="sp" /><span className="hint">{owners.you} on you · {owners.claude} on Claude · {owners.both} on both</span></div>
          <div className="pb" style={{ padding: "4px 14px 8px" }}>
            {doing.map((i) => <ItemRow key={i.id} i={i} />)}
            {!doing.length && <div className="empty" style={{ padding: "10px 0" }}>Nothing in progress. Set an item to in progress; if Claude owns it, the Mac worker builds it and opens a PR for you.</div>}
          </div>
        </section>
        <section className="panel">
          <div className="ph"><h2 className="ph-t">Deadlines</h2><span className="sp" /><span className="hint">From PRD.md&apos;s milestones table</span></div>
          <div className="pb" style={{ padding: "4px 14px 8px" }}>
            {upcoming.map((d) => <div key={d.date} className="dr"><span className="dstat" aria-hidden="true" /><span className="dt2"><span>{d.label}</span><small>{daysBetween(t, d.date)} days</small></span><Due d={d.date} /></div>)}
            {!upcoming.length && <div className="empty" style={{ padding: "10px 0" }}>No upcoming deadline. Add a dated Milestones table to PRD.md and run the project sync.</div>}
          </div>
        </section>
        <section className="panel">
          <div className="ph"><h2 className="ph-t">Latest reports</h2><span className="sp" /><Link className="hint" href={href({ v: "reviews" })}>All reviews →</Link></div>
          <div className="revlist">
            {review && <Link href={href({ v: "reviews", r: review.id })} className="revrow"><i className="dot" /><span className="t"><b>Weekly review · {review.week_start ? fmtDate(review.week_start) : ""}</b><span>{review.headline}</span></span>{review.verdict ? <span className={`verdict v-${review.verdict}`}>{review.verdict.replace("-", " ")}</span> : <span />}</Link>}
            {doc && <Link href={href({ v: "project", r: doc.id })} className="revrow"><i className="dot" /><span className="t"><b>{doc.title}</b><span>{doc.headline}</span></span><span className="due">{fmtDate(doc.created_at.slice(0, 10))}</span></Link>}
            {audit && <Link href={href({ v: "reviews", k: "security", r: audit.id })} className="revrow"><i className="dot" /><span className="t"><b>Security · {audit.title}</b><span>{audit.headline}</span></span>{audit.verdict ? <span className={`verdict v-${audit.verdict}`}>{audit.verdict.replace("-", " ")}</span> : <span />}</Link>}
            {!review && !doc && !audit && <div className="empty">No reports yet. Weekly reviews arrive {REVIEW_WHEN}; strategy documents come from the Inbox or the plan button.</div>}
          </div>
        </section>
      </div>
      {prefs.show_done_default ? null : null}
    </div>
  );
}

async function Stats({ projectId, today: t }: { projectId: string; today: string }) {
  const [ins, stats] = await Promise.all([D.insights(projectId), D.dailyStats(14, projectId)]);
  const p = ins.projects[0];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {p ? <div className="burns" style={{ gridTemplateColumns: "1fr" }}><BurnUp p={p} today={t} /></div> : <div className="panel empty">No checklist data yet.</div>}
      <section className="panel">
        <div className="ph"><h2 className="ph-t">Added and finished per day</h2><span className="sp" /><span className="hint">Last 14 days · this project</span></div>
        <DailyStats stats={stats} today={t} />
      </section>
      <section className="panel">
        <div className="ph"><h2 className="ph-t">Users and visitors</h2></div>
        <div className="empty">No analytics source is connected to this project, so there are no visitor or user numbers to show. Connecting one (site analytics, product events) is its own checklist item.</div>
      </section>
    </div>
  );
}

async function ReviewPicker({ list, sel, base, href, subtab }: { list: D.Review[]; sel?: string; base: Record<string, string>; href: (q: Record<string, string>) => string; subtab?: string }) {
  const r = list.find((x) => x.id === sel) || list[0];
  const thread = await D.getMessages({ review: r.id, limit: 100 });
  const tabs = (r.meta?.tabs as { key: string; label: string; body_md: string; verdict?: string; headline?: string }[] | undefined) || [];
  const cur = tabs.find((x) => x.key === subtab);
  // Reviews mirrored from a file (security audits) carry the file's date and path.
  const fileDate = (x: D.Review) => (typeof x.meta?.date === "string" && x.meta.date ? fmtDate(x.meta.date) : null);
  const file = typeof r.meta?.file === "string" ? r.meta.file : null;
  return (
    <div className="grid-review" style={{ display: "grid", gridTemplateColumns: "minmax(0, 240px) minmax(0, 1fr)", gap: 12, alignItems: "start" }}>
      <nav className="panel revlist" aria-label="Reviews">
        {list.map((x) => (
          <Link key={x.id} href={href({ ...base, r: x.id })} className="revrow" aria-current={x.id === r.id ? "page" : undefined} style={x.id === r.id ? { background: "var(--surface-2)" } : undefined}>
            <i className="dot" />
            <span className="t"><b>{x.week_start ? `Week of ${fmtDate(x.week_start)}` : x.title}</b><span>{[fileDate(x), x.headline].filter(Boolean).join(" · ")}</span></span>
            {x.verdict ? <span className={`verdict v-${x.verdict}`}>{x.verdict.replace("-", " ")}</span> : <span />}
          </Link>
        ))}
      </nav>
      <article className="panel pb" style={{ padding: "18px 22px" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {r.verdict && <span className={`verdict v-${r.verdict}`}>{r.verdict.replace("-", " ")}</span>}
          <span className="lbl">{r.title}</span>
          {file && <span className="hint">{fileDate(r) ? `${fileDate(r)} · ` : ""}{file}</span>}
        </div>
        {r.headline && <p style={{ fontSize: 17, fontWeight: 600, margin: "10px 0 4px", maxWidth: "70ch" }}>{r.headline}</p>}
        {tabs.length > 0 && (
          <div className="subtabs" style={{ margin: "14px 0 4px" }}>
            <Link className="chip" aria-pressed={!cur} href={href({ ...base, r: r.id })}>Summary</Link>
            {tabs.map((x) => <Link key={x.key} className="chip" aria-pressed={cur?.key === x.key} href={href({ ...base, r: r.id, t: x.key })}>{x.label}</Link>)}
          </div>
        )}
        {cur && (cur.verdict || cur.headline) && (
          <p style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", margin: "10px 0 0", fontWeight: 600 }}>
            {cur.verdict && <span className={`verdict v-${cur.verdict}`}>{cur.verdict.replace("-", " ")}</span>}{cur.headline}
          </p>
        )}
        <Markdown>{cur ? cur.body_md : r.body_md}</Markdown>
        <Thread reviewId={r.id} projectId={r.project_id} tab={cur?.key || null} messages={thread} canBuild />
      </article>
    </div>
  );
}
