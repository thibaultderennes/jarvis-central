"use client";
import Link from "next/link";
import { charts, type AnalysisMeta, type ConnectedTool } from "@/lib/analysis";
import { LineChart } from "./ProjectStats";
import "./project-stats.css";

/*
 * Project page → Stats, above Product: what the project's own analysis jobs concluded (lib/analysis.ts), with their
 * headline numbers, their charts (a cohort series is a chart like any other) and the tools they read from and post to.
 * Everything comes from the report's meta: a new project needs a report, not code.
 */
export type PanelReport = Omit<AnalysisMeta, "file"> & { id: string; title: string; headline: string; href: string; unread: boolean };

const COLORS = ["var(--p1)", "var(--p2)", "var(--p3)", "var(--p4)", "var(--p5)", "var(--p6)", "var(--p7)"];
const fd = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("en-CA", { timeZone: "UTC", month: "short", day: "numeric" });
const label = (k: string) => { const s = k.replace(/_/g, " "); return s.charAt(0).toUpperCase() + s.slice(1); };
const n = (v: number) => (Number.isInteger(v) ? v.toLocaleString("en-US") : v.toLocaleString("en-US", { maximumFractionDigits: 1 }));
const ROLE = { source: "Reads from", destination: "Posts to" } as const;
const STATUS = { ok: ["on-track", "working"], degraded: ["at-risk", "degraded"], failed: ["off-track", "failed"] } as const;

function Report({ r }: { r: PanelReport }) {
  const nums = Object.entries(r.numbers);
  return (
    <section className="panel ps-an">
      <div className="ph">
        <h3 className="ps-h">{r.title}</h3>
        {r.unread && <span className="pill">New</span>}
        <span className="sp" />
        <span className="hint">{r.date ? fd(r.date) : "undated"}{r.period ? ` · covers ${fd(r.period.from)} – ${fd(r.period.to)}` : ""} · <code>{r.source}</code></span>
      </div>
      <div className="ps-an-b">
        {r.headline && <p className="ps-an-h">{r.headline}</p>}
        {nums.length > 0 && (
          <div className="ps-an-n">{nums.map(([k, v]) => <div key={k}><span className="lbl">{label(k)}</span><b>{n(v)}</b></div>)}</div>
        )}
        <Link className="hint" href={r.href}>Read the full report →</Link>
      </div>
      {r.series.length > 0 && (
        <div className="ps-charts ps-an-c">
          {charts(r.series).map((c) => (
            <LineChart key={c.title} title={c.title} hint={c.series.some((s) => s.points.some((p) => p.n !== undefined)) ? "Each point is one cohort, weighted by its size" : "From the report"}
              unit={c.unit === "pct" ? "pct" : undefined} markers={r.markers}
              lines={c.series.map((s, i) => ({ key: s.key, label: s.label, color: COLORS[i % COLORS.length], pts: s.points.map((p) => ({ date: p.x, v: p.v })) }))} />
          ))}
        </div>
      )}
    </section>
  );
}

export default function AnalysisPanel({ reports, tools }: { reports: PanelReport[]; tools: ConnectedTool[] }) {
  return (
    <section className="ps-part">
      <div className="ps-head">
        <h2 className="ph-t">Analysis</h2>
        <span className="hint">The newest report from each of this project&apos;s analysis jobs. All of them are under Docs and reviews → Analyses.</span>
      </div>
      {reports.map((r) => <Report key={r.id} r={r} />)}
      {tools.length > 0 && (
        <section className="panel">
          <div className="ph"><h3 className="ps-h">Connected tools</h3><span className="sp" /><span className="hint">What the reports read from and post to, as of each tool&apos;s last report</span></div>
          <ul className="ps-tools">
            {tools.map((t) => (
              <li key={`${t.role}:${t.name}`}>
                <span className="lbl">{ROLE[t.role]}</span>
                <b>{t.name}</b>
                {t.detail && <span className="ps-sub">{t.detail}</span>}
                {t.status && <span className={`verdict v-${STATUS[t.status][0]}`}>{STATUS[t.status][1]}</span>}
                <span className="hint">{fd(t.last)} · {t.via.join(", ")}</span>
                {t.note && <span className="ps-sub">{t.note}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
