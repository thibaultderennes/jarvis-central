import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import * as D from "@/lib/data";
import { daysBetween, fmtDate, today } from "@/lib/time";
import Checklist from "@/components/Checklist";
import Markdown from "@/components/Markdown";
import Thread from "@/components/Thread";
import ProjectSettings from "@/components/ProjectSettings";
import { REVIEW_WHEN } from "@/lib/instance";

type Search = { tab?: string; r?: string; t?: string };

export default async function ProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  await requireSession();
  const { id } = await params, sp = await searchParams;
  const p = await D.getProject(id);
  if (!p) notFound();
  const tab = sp.tab === "reviews" || sp.tab === "strategy" ? sp.tab : "checklist";
  const t = today();
  const [items, weekly, docs] = await Promise.all([D.getItems({ project: id }), D.getReviews({ type: "project", project: id, limit: 30 }), D.getReviews({ type: "doc", project: id, limit: 30 })]);
  const dn = items.filter((i) => i.status === "done").length;
  const next = p.deadlines.filter((d) => d.date >= t).sort((a, b) => a.date.localeCompare(b.date))[0];
  const rank = D.splitFeatured(await D.getProjects()).featured.findIndex((x) => x.id === p.id) + 1;
  const href = (q: Record<string, string>) => `/p/${id}?${new URLSearchParams(q)}`;

  return (
    <div data-c={p.color} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="hello">
        <div>
          <h1 className="page" style={{ display: "flex", gap: 12, alignItems: "center" }}><i className="dot" style={{ width: 14, height: 14 }} />{p.name}</h1>
          <p className="sub">{p.tagline} · {dn} of {items.length} done{next ? ` · ${next.label} in ${daysBetween(t, next.date)} days (${fmtDate(next.date)})` : ""}</p>
        </div>
        <div className="subtabs" role="tablist">
          <Link role="tab" className="chip" aria-pressed={tab === "checklist"} href={href({})}>Checklist</Link>
          <Link role="tab" className="chip" aria-pressed={tab === "reviews"} href={href({ tab: "reviews" })}>Weekly reviews {weekly.length > 0 && `(${weekly.length})`}</Link>
          <Link role="tab" className="chip" aria-pressed={tab === "strategy"} href={href({ tab: "strategy" })}>Strategy {docs.length > 0 && `(${docs.length})`}</Link>
          {p.links.map((l) => <a key={l.url} className="chip" href={l.url} target="_blank" rel="noopener noreferrer">{l.label} ↗</a>)}
        </div>
      </div>

      <ProjectSettings id={p.id} plan={p.plan_enabled !== false} minutes={p.weekly_minutes ?? null} reviews={p.reviews_enabled !== false} rank={rank || null} />

      {tab === "checklist" && <Checklist projectId={id} sections={p.sections} items={items} today={t} />}

      {tab === "reviews" && (weekly.length ? <ReviewPicker list={weekly} sel={sp.r} base={{ tab: "reviews" }} href={href} />
        : <div className="panel empty">The first weekly review for {p.name} arrives {REVIEW_WHEN}. It covers what shipped, what slipped, an audit of the week&apos;s work, risks, and your top 3 for the week.</div>)}

      {tab === "strategy" && (docs.length ? <ReviewPicker list={docs} sel={sp.r} base={{ tab: "strategy" }} href={href} subtab={sp.t} />
        : <div className="panel empty">No strategy documents for {p.name} yet. Ask Claude for one from the Inbox (for example &ldquo;Run a CEO review of {p.name}&rdquo;) and it lands here.</div>)}
    </div>
  );
}

async function ReviewPicker({ list, sel, base, href, subtab }: { list: D.Review[]; sel?: string; base: Record<string, string>; href: (q: Record<string, string>) => string; subtab?: string }) {
  const r = list.find((x) => x.id === sel) || list[0];
  const thread = await D.getMessages({ review: r.id, limit: 100 });
  const tabs = (r.meta?.tabs as { key: string; label: string; body_md: string; verdict?: string; headline?: string }[] | undefined) || [];
  const cur = tabs.find((x) => x.key === subtab);
  return (
    <div className="grid-review" style={{ display: "grid", gridTemplateColumns: "minmax(0, 260px) minmax(0, 1fr)", gap: 12, alignItems: "start" }}>
      <nav className="panel revlist" aria-label="Reviews">
        {list.map((x) => (
          <Link key={x.id} href={href({ ...base, r: x.id })} className="revrow" aria-current={x.id === r.id ? "page" : undefined} style={x.id === r.id ? { background: "var(--surface-2)" } : undefined}>
            <i className="dot" />
            <span className="t"><b>{x.week_start ? `Week of ${fmtDate(x.week_start)}` : x.title}</b><span>{x.headline}</span></span>
            {x.verdict ? <span className={`verdict v-${x.verdict}`}>{x.verdict.replace("-", " ")}</span> : <span />}
          </Link>
        ))}
      </nav>
      <article className="panel pb" style={{ padding: "18px 22px" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {r.verdict && <span className={`verdict v-${r.verdict}`}>{r.verdict.replace("-", " ")}</span>}
          <span className="lbl">{r.title}</span>
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
