import Link from "next/link";
import { requireSession } from "@/lib/auth";
import * as D from "@/lib/data";
import { fmtDate } from "@/lib/time";
import Markdown from "@/components/Markdown";
import Thread from "@/components/Thread";
import { cap, REVIEW_WHEN } from "@/lib/instance";

const TYPE: Record<string, string> = { recap: "Week recap", coaching: "How you work with Claude", jarvis: "Jarvis itself", project: "Project review", doc: "Document" };
const ORDER = ["recap", "coaching", "jarvis", "project"];

export default async function Reviews({ searchParams }: { searchParams: Promise<{ id?: string; type?: string }> }) {
  await requireSession();
  const sp = await searchParams;
  const [all, projects] = await Promise.all([D.getReviews({ limit: 300 }), D.getProjects(true)]);
  const byId = Object.fromEntries(projects.map((p) => [p.id, p]));
  const weekly = all.filter((r) => r.type !== "doc" && (!sp.type || r.type === sp.type));
  const docs = all.filter((r) => r.type === "doc");
  const sel = sp.id ? all.find((r) => r.id === sp.id) : null;
  const weeks = [...new Set(weekly.map((r) => r.week_start!))];
  const color = (r: D.Review) => byId[r.project_id || ""]?.color || (r.type === "coaching" ? "life" : "other");

  const thread = sel ? await D.getMessages({ review: sel.id, limit: 100 }) : [];
  if (sel) return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="daynav" style={{ marginTop: 16 }}><Link href="/reviews">‹ All reviews</Link>{sel.project_id && <Link href={`/p/${sel.project_id}?tab=${sel.type === "doc" ? "strategy" : "reviews"}&r=${sel.id}`}>Open in {byId[sel.project_id]?.name}</Link>}</div>
      <article className="panel" style={{ padding: "20px 24px" }} data-c={color(sel)}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <i className="dot" /><span className="lbl">{TYPE[sel.type]}{sel.week_start ? ` · week of ${fmtDate(sel.week_start, { month: "long", day: "numeric" })}` : ""}</span>
          {sel.verdict && <span className={`verdict v-${sel.verdict}`}>{sel.verdict.replace("-", " ")}</span>}
        </div>
        <h1 className="page" style={{ marginTop: 8 }}>{sel.title}</h1>
        {sel.headline && <p style={{ fontSize: 17, fontWeight: 600, maxWidth: "70ch" }}>{sel.headline}</p>}
        <Markdown>{sel.body_md}</Markdown>
        {(sel.meta?.tabs as { key: string; label: string; body_md: string }[] | undefined)?.map((t) => (
          <details key={t.key} style={{ borderTop: "1px solid var(--line-2)", padding: "10px 0" }}>
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>{t.label}</summary>
            <Markdown>{t.body_md}</Markdown>
          </details>
        ))}
        <Thread reviewId={sel.id} projectId={sel.project_id} messages={thread} canBuild />
      </article>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="hello">
        <div>
          <h1 className="page">Reviews</h1>
          <p className="sub">{cap(REVIEW_WHEN)} your Mac reads the week (commits, PRs, checklists, calendar, your Claude sessions) and writes four kinds of report: one per project, a recap, how you work with Claude, and how you use Jarvis.</p>
        </div>
        <div className="chips" role="group" aria-label="Filter by type">
          <Link className="chip" aria-pressed={!sp.type} href="/reviews">All</Link>
          {ORDER.map((t) => <Link key={t} className="chip" aria-pressed={sp.type === t} href={`/reviews?type=${t}`}>{TYPE[t]}</Link>)}
        </div>
      </div>
      {!weeks.length && <div className="panel empty">No weekly reviews yet. The first run is {REVIEW_WHEN} (your Mac needs to be on or wake up; it catches up when it wakes).</div>}
      {weeks.map((w) => {
        const rs = weekly.filter((r) => r.week_start === w).sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type) || (byId[a.project_id || ""]?.sort ?? 99) - (byId[b.project_id || ""]?.sort ?? 99));
        return (
          <section className="panel" key={w}>
            <div className="ph"><h2 className="ph-t">Week of {fmtDate(w, { month: "long", day: "numeric" })}</h2><span className="sp" /><span className="hint">{rs.length} reports</span></div>
            <div className="revlist">
              {rs.map((r) => (
                <Link key={r.id} href={`/reviews?id=${r.id}`} className="revrow" data-c={color(r)}>
                  <i className="dot" />
                  <span className="t"><b>{r.type === "project" ? byId[r.project_id || ""]?.name || r.title : TYPE[r.type]}</b><span>{r.headline}</span></span>
                  {r.verdict ? <span className={`verdict v-${r.verdict}`}>{r.verdict.replace("-", " ")}</span> : <span className="pill">{TYPE[r.type]}</span>}
                </Link>
              ))}
            </div>
          </section>
        );
      })}
      {docs.length > 0 && (
        <section className="panel">
          <div className="ph"><h2 className="ph-t">Strategy documents</h2></div>
          <div className="revlist">
            {docs.map((r) => (
              <Link key={r.id} href={`/reviews?id=${r.id}`} className="revrow" data-c={color(r)}>
                <i className="dot" /><span className="t"><b>{r.title}</b><span>{r.headline}</span></span><span className="due">{fmtDate(r.created_at.slice(0, 10))}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
