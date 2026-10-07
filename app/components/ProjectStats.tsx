"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Pt, Tile } from "@/lib/projectStats";
import "./project-stats.css";
import { EmptyArt } from "./brand";

const P = (d: string) => new Date(d + "T12:00:00Z");
const fd = (d: string, o: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }) => P(d).toLocaleDateString("en-CA", { timeZone: "UTC", ...o });
const span = (a: string, b: string) => Math.round((+P(b) - +P(a)) / 864e5);
function num(v: number) {
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e4) return `${(v / 1e3).toFixed(a >= 1e5 ? 0 : 1)}k`;
  return Number.isInteger(v) ? v.toLocaleString("en-US") : v.toLocaleString("en-US", { maximumFractionDigits: a < 10 ? 2 : 1 });
}
const show = (t: Tile, v: number | null) => (v === null ? "—" : t.fmt === "days" ? `${num(v)} d` : t.fmt === "pct" ? `${num(v)}%` : t.key === "scope" && v > 0 ? `+${num(v)}` : num(v));
function niceMax(v: number) {
  if (v <= 4) return 4;
  const p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p;
  return ([1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((s) => s >= n) || 10) * p;
}

/** The chart's pixel width, so the SVG draws 1:1 and its text stays at the CSS size whatever the column width. */
function useWidth(ref: React.RefObject<HTMLDivElement | null>, initial: number) {
  const [w, setW] = useState(initial);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.round(e.contentRect.width))));
    ro.observe(el); return () => ro.disconnect();
  }, [ref]);
  return w;
}

function Spark({ pts }: { pts: Pt[] }) {
  if (pts.length < 2) return null;
  const W = 96, H = 26, min = Math.min(...pts.map((p) => p.v)), max = Math.max(...pts.map((p) => p.v)), r = max - min || 1, n = span(pts[0].date, pts.at(-1)!.date) || 1;
  const x = (d: string) => 2 + ((W - 4) * span(pts[0].date, d)) / n, y = (v: number) => H - 3 - ((H - 6) * (v - min)) / r;
  const last = pts.at(-1)!;
  return (
    <svg className="ps-spark" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <path d={pts.map((p, i) => `${i ? "L" : "M"}${x(p.date).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ")} />
      <circle cx={x(last.date)} cy={y(last.v)} r={2.5} />
    </svg>
  );
}

function StatTile({ t, currency }: { t: Tile; currency?: string }) {
  const d = t.value !== null && t.prev !== null && t.prev !== 0 ? (t.value - t.prev) / Math.abs(t.prev) : null;
  const good = d === null || Math.abs(d) < 0.005 || t.up === "none" ? null : (d > 0) === (t.up === "good");
  return (
    <div className="ps-tile" title={t.hint}>
      <span className="lbl">{t.label}</span>
      <div className="ps-v">
        <b className={t.tone ? `ps-${t.tone}` : t.value === null ? "ps-none" : ""}>{show(t, t.value)}</b>
        {t.fmt === "money" && t.value !== null && currency && <small>{currency}</small>}
        {d !== null && (
          <span className={`ps-d${good === null ? "" : good ? " up" : " down"}`} title={`${show(t, t.prev)} a week earlier`}>
            {Math.abs(d) < 0.005 ? "±0%" : `${d > 0 ? "▲" : "▼"} ${num(Math.abs(Math.round(d * 1000) / 10))}%`}
          </span>
        )}
      </div>
      <span className="ps-sub">{t.value === null && !t.sub ? "not recorded" : t.sub}</span>
      <Spark pts={t.spark} />
    </div>
  );
}

type Line = { key: string; label: string; color: string; dash?: boolean; pts: Pt[] };
/** Lines over time on one scale; a crosshair shows every series on the hovered date. */
function LineChart({ title, hint, lines }: { title: string; hint: string; lines: Line[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<string | null>(null);
  const ls = lines.filter((l) => l.pts.length);
  const dates = [...new Set(ls.flatMap((l) => l.pts.map((p) => p.date)))].sort();
  const W = useWidth(ref, 520), H = 200, L = 40, R = 10, T = 12, B = 22;
  const head = <div className="ph"><h3 className="ps-h">{title}</h3><span className="sp" /><span className="hint">{hint}</span></div>;
  if (dates.length < 2) return <section className="panel ps-chart">{head}<div className="empty">{!dates.length && <EmptyArt kind="numbers" />}{dates.length ? `One snapshot so far (${fd(dates[0])}): the line starts with the second.` : "No numbers yet."}</div></section>;
  const max = niceMax(Math.max(1, ...ls.flatMap((l) => l.pts.map((p) => p.v)))), n = span(dates[0], dates.at(-1)!) || 1;
  const x = (d: string) => L + ((W - L - R) * span(dates[0], d)) / n, y = (v: number) => T + (H - T - B) * (1 - v / max);
  const ticks = [0, max / 2, max], xt = [dates[0], dates[Math.floor(dates.length / 2)], dates.at(-1)!].filter((v, i, a) => a.indexOf(v) === i);
  const move = (e: React.MouseEvent) => {
    const b = ref.current!.getBoundingClientRect(), px = ((e.clientX - b.left) / b.width) * W;
    setHover(dates.reduce((best, d) => (Math.abs(x(d) - px) < Math.abs(x(best) - px) ? d : best), dates[0]));
  };
  return (
    <section className="panel ps-chart">
      {head}
      <div className="chart pb" ref={ref} onMouseMove={move} onMouseLeave={() => setHover(null)} style={{ paddingBottom: 4 }}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}: ${ls.map((l) => `${l.label} ${num(l.pts.at(-1)!.v)}`).join(", ")} on ${fd(dates.at(-1)!)}`}>
          <g className="grid">{ticks.map((t) => <line key={t} x1={L} x2={W - R} y1={y(t)} y2={y(t)} />)}</g>
          <g className="axis">{ticks.map((t) => <text key={t} x={L - 6} y={y(t) + 3.5} textAnchor="end">{num(t)}</text>)}</g>
          {xt.map((d, i) => <text key={d} x={x(d)} y={H - 6} textAnchor={i === 0 ? "start" : i === xt.length - 1 ? "end" : "middle"}>{fd(d)}</text>)}
          <line className="base" x1={L} x2={W - R} y1={y(0)} y2={y(0)} />
          {hover && <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} stroke="var(--ink-3)" strokeWidth={1} />}
          {ls.map((l) => (
            <g key={l.key}>
              <path d={l.pts.map((p, i) => `${i ? "L" : "M"}${x(p.date).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ")} fill="none" stroke={l.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={l.dash ? "5 4" : undefined} />
              <circle cx={x(l.pts.at(-1)!.date)} cy={y(l.pts.at(-1)!.v)} r={4} fill={l.color} stroke="var(--surface)" strokeWidth={2} />
              {hover && l.pts.find((p) => p.date === hover) && <circle cx={x(hover)} cy={y(l.pts.find((p) => p.date === hover)!.v)} r={4} fill={l.color} stroke="var(--surface)" strokeWidth={2} />}
            </g>
          ))}
        </svg>
        {hover && (
          <div className="tip" style={{ left: `${(x(hover) / W) * 100}%`, top: 14 }}>
            <div style={{ opacity: .8, marginBottom: 2 }}>{fd(hover, { weekday: "short", month: "short", day: "numeric" })}</div>
            {ls.map((l) => { const p = l.pts.find((q) => q.date === hover); return p ? <div className="row" key={l.key}><i className="dot" style={{ background: l.color }} />{l.label} <b>{num(p.v)}</b></div> : null; })}
          </div>
        )}
      </div>
      {ls.length > 1 && <div className="legend">{ls.map((l) => <span key={l.key}><i className="dot" style={{ background: l.color }} />{l.label} <b className="ps-lv">{num(l.pts.at(-1)!.v)}</b></span>)}</div>}
      <details className="tabletoggle">
        <summary>Show as a table</summary>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead><tr><th></th>{ls.map((l) => <th key={l.key}>{l.label}</th>)}</tr></thead>
            <tbody>{[...dates].reverse().map((d) => <tr key={d}><td>{fd(d)}</td>{ls.map((l) => <td key={l.key}>{l.pts.find((p) => p.date === d)?.v ?? "—"}</td>)}</tr>)}</tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

type Week = { date: string; added: number; done: number; done_late: number };
/** Added vs finished per week, side by side: is work arriving faster than it gets done? */
function WeekColumns({ weeks }: { weeks: Week[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ i: number; x: number } | null>(null);
  const W = useWidth(ref, 520), H = 200, L = 28, R = 6, T = 12, B = 22;
  const max = niceMax(Math.max(1, ...weeks.flatMap((w) => [w.added, w.done])));
  const band = (W - L - R) / weeks.length, bw = Math.min(11, band * 0.32);
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  const bar = (cx: number, v: number) => { if (!v) return ""; const top = y(v), h = y(0) - top, r = Math.min(3, h); return `M${cx - bw / 2},${y(0)} V${top + r} Q${cx - bw / 2},${top} ${cx - bw / 2 + r},${top} H${cx + bw / 2 - r} Q${cx + bw / 2},${top} ${cx + bw / 2},${top + r} V${y(0)} Z`; };
  const tot = weeks.reduce((a, w) => ({ added: a.added + w.added, done: a.done + w.done }), { added: 0, done: 0 });
  return (
    <div className="chart" ref={ref} onMouseLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Last ${weeks.length} weeks: ${tot.added} items added, ${tot.done} finished`}>
        <g className="grid">{[0, max / 2, max].map((t) => <line key={t} x1={L} x2={W - R} y1={y(t)} y2={y(t)} />)}</g>
        <g className="axis">{[0, max / 2, max].map((t) => <text key={t} x={L - 6} y={y(t) + 3.5} textAnchor="end">{num(t)}</text>)}</g>
        {weeks.map((w, i) => {
          const cx = L + band * i + band / 2, cur = i === weeks.length - 1;
          const on = (e: React.MouseEvent | React.FocusEvent) => { const b = ref.current!.getBoundingClientRect(); setTip({ i, x: "clientX" in e ? e.clientX - b.left : (cx / W) * b.width }); };
          return (
            <g key={w.date} tabIndex={0} onMouseMove={on} onFocus={on} onBlur={() => setTip(null)} style={{ outline: "none" }}>
              <rect x={L + band * i} y={T} width={band} height={H - T - B} fill="transparent" />
              <path d={bar(cx - bw / 2 - 1, w.added)} style={{ fill: "var(--ink-3)", opacity: cur ? 0.55 : 1 }} />
              <path d={bar(cx + bw / 2 + 1, w.done)} style={{ fill: "var(--pc)", opacity: cur ? 0.55 : 1 }} />
              {(i % 2 === (weeks.length - 1) % 2 || weeks.length <= 8) && <text x={cx} y={H - 6} textAnchor="middle" style={cur ? { fill: "var(--ink)", fontWeight: 600 } : undefined}>{cur ? "now" : fd(w.date)}</text>}
            </g>
          );
        })}
        <line className="base" x1={L} x2={W - R} y1={y(0)} y2={y(0)} />
      </svg>
      {tip && (
        <div className="tip" style={{ left: tip.x, top: 20 }}>
          <div style={{ opacity: .8, marginBottom: 2 }}>Week of {fd(weeks[tip.i].date)}{tip.i === weeks.length - 1 ? " (so far)" : ""}</div>
          <div className="row"><i className="dot" style={{ background: "var(--ink-3)" }} />Added <b>{weeks[tip.i].added}</b></div>
          <div className="row"><i className="dot" />Finished <b>{weeks[tip.i].done}</b>{weeks[tip.i].done_late ? ` (${weeks[tip.i].done_late} late)` : ""}</div>
        </div>
      )}
      <div className="legend" style={{ paddingTop: 6 }}>
        <span><i className="dot" style={{ background: "var(--ink-3)" }} />Added ({tot.added})</span>
        <span><i className="dot" />Finished ({tot.done})</span>
      </div>
      <details className="tabletoggle">
        <summary>Show as a table</summary>
        <table><thead><tr><th>Week of</th><th>Added</th><th>Finished</th><th>Late</th></tr></thead>
          <tbody>{[...weeks].reverse().map((w) => <tr key={w.date}><td>{fd(w.date)}</td><td>{w.added}</td><td>{w.done}</td><td>{w.done_late}</td></tr>)}</tbody></table>
      </details>
    </div>
  );
}

export type ProductProps = {
  tiles: Tile[]; currency: string; users: Pt[]; active: Pt[]; paying: Pt[]; visits: Pt[];
  latest: { date: string; source: string } | null; extra: { key: string; value: number | null }[];
};
export type DeliveryProps = {
  tiles: Tile[]; weeks: Week[]; open: number;
  oldest: { id: string; title: string; age: number; due: string | null; late: boolean; owner: string | null; status: string }[];
  forecast: { milestone: { date: string; label: string } | null; scope: number; scopeIsDue: boolean; p50: string | null; p85: string | null; status: "on" | "risk" | "off" | null; samples: number; young: boolean; rate: number };
};

const VERDICT = { on: ["on-track", "On track"], risk: ["at-risk", "At risk"], off: ["off-track", "Off track"] } as const;

export default function ProjectStats({ project, product, delivery, today }: { project: { id: string; name: string }; product: ProductProps; delivery: DeliveryProps; today: string }) {
  const has = !!product.latest;
  const f = delivery.forecast;
  const cmd = `node agent/jarvis.mjs metrics ${project.id} --set users=120 --set active_users=45 --set visits=900`;
  const age = product.latest ? span(product.latest.date, today) : 0;
  return (
    <div className="pstats">
      <section className="ps-part">
        <div className="ps-head">
          <h2 className="ph-t">Product</h2>
          <span className="hint">{has ? `Latest snapshot ${fd(product.latest!.date)}${age > 1 ? ` (${age} days ago)` : ""} · ${product.latest!.source === "manual" ? "typed by hand" : `from the ${product.latest!.source} source`} · arrows compare with a week earlier` : "Users, traffic, revenue and costs"}</span>
        </div>
        {has ? (
          <>
            <div className="ps-tiles">{product.tiles.map((t) => <StatTile key={t.key} t={t} currency={product.currency} />)}</div>
            <div className="ps-charts">
              <LineChart title="Users" hint="Total, active in the last 7 days and paying" lines={[
                { key: "users", label: "Users", color: "var(--pc)", pts: product.users },
                { key: "active", label: "Active (7 d)", color: "var(--ink-2)", pts: product.active },
                { key: "paying", label: "Paying", color: "var(--ink-3)", dash: true, pts: product.paying },
              ]} />
              <LineChart title="Visitors" hint="Unique visitors over the 7 days before each snapshot" lines={[{ key: "visits", label: "Visitors", color: "var(--pc)", pts: product.visits }]} />
            </div>
            {product.extra.length > 0 && <div className="ps-extra"><span className="lbl">Other numbers</span>{product.extra.map((e) => <span key={e.key}><code>{e.key}</code> {e.value === null ? "—" : num(e.value)}</span>)}</div>}
          </>
        ) : (
          <>
            {product.tiles.some((t) => t.key === "expenses" && t.value !== null) && <div className="ps-tiles ps-tiles-few">{product.tiles.filter((t) => t.key === "expenses").map((t) => <StatTile key={t.key} t={t} currency={product.currency} />)}</div>}
            <div className="panel ps-empty">
              <EmptyArt kind="numbers" />
              <p><b>No product numbers for {project.name} yet.</b> Once they arrive this shows users, active users, visitors, revenue, expenses and cost per user, each with its trend, and users and visitors over time.</p>
              <div className="ps-ways">
                <div>
                  <span className="lbl">Type them in now</span>
                  <p>From any terminal on your Mac (keep going weekly; each call adds that day&apos;s snapshot):</p>
                  <pre><code>{cmd}</code></pre>
                </div>
                <div>
                  <span className="lbl">Or connect a source</span>
                  <p>In <code>jarvis.config.json</code>, a URL that returns JSON numbers (token from an env var) or a command run in the project folder. The Mac agent reads it once a day.</p>
                  <pre><code>{`"metrics": { "sources": {\n  "${project.id}": { "url": "https://…/metrics", "token_env": "METRICS_TOKEN" }\n} }`}</code></pre>
                </div>
              </div>
              <p className="hint">Standard keys: <code>users</code> <code>active_users</code> <code>paying_users</code> <code>mrr</code> (levels on the day) · <code>signups</code> <code>activated</code> <code>visits</code> <code>revenue</code> <code>churned</code> (totals over the last 7 days). Any other key is kept too. Details in docs/metrics.md.</p>
            </div>
          </>
        )}
      </section>

      <section className="ps-part">
        <div className="ps-head">
          <h2 className="ph-t">Delivery</h2>
          <span className="hint">From the checklist · {delivery.open} open items</span>
        </div>
        <div className="ps-tiles ps-tiles-5">{delivery.tiles.map((t) => <StatTile key={t.key} t={t} />)}</div>
        <div className="ps-grid">
          <div className="ps-col">
            <section className="panel ps-fc">
              <div className="ph"><h3 className="ps-h">Forecast</h3><span className="sp" />{f.status && <span className={`verdict v-${VERDICT[f.status][0]}`}>{VERDICT[f.status][1]}</span>}</div>
              <div className="pb ps-fc-b">
                {f.milestone ? <p className="ps-fc-t">{f.milestone.label} <span className="due">{fd(f.milestone.date)} · in {span(today, f.milestone.date)} d</span></p> : <p className="ps-fc-t">All open items <span className="due">no dated milestone</span></p>}
                {!f.scope ? <p>Nothing left {f.milestone ? "before this milestone" : "open"}.</p>
                  : !f.p50 ? <p>{f.scope} items to go and nothing finished in the last 8 weeks, so there is no pace to forecast from.</p>
                    : (
                      <>
                        <div className="ps-fc-row">
                          <div><span className="lbl">Likely (50%)</span><b>{fd(f.p50)}</b></div>
                          <div><span className="lbl">Safe bet (85%)</span><b className={f.milestone && f.p85! > f.milestone.date ? "ps-bad" : ""}>{fd(f.p85!)}</b></div>
                        </div>
                        <p className="hint">{f.scope} item{f.scope > 1 ? "s" : ""} {f.scopeIsDue ? "due by the milestone" : "open"}, simulated 2,000 times from {f.young ? "this week’s finished items so far (nothing finished before)" : `the last ${f.samples} weeks of finished items`} (avg {f.rate}/week).{f.milestone && !f.scopeIsDue ? " No open item is dated before the milestone, so this counts them all." : ""}</p>
                      </>
                    )}
              </div>
            </section>
            {delivery.oldest.length > 0 && (
              <section className="panel">
                <div className="ph"><h3 className="ps-h">Oldest open items</h3><span className="sp" /><span className="hint">Work that ages is usually stuck: finish, split or cancel it</span></div>
                <ul className="ps-old">
                  {delivery.oldest.map((i) => (
                    <li key={i.id}>
                      <span className="due ps-age">{i.age} d</span>
                      <Link href={`/p/${project.id}#item-${i.id}`}>{i.title}</Link>
                      {i.status === "doing" && <span className="pill">in progress</span>}
                      <span className={`due${i.late ? " late" : ""}`}>{i.due ? `${i.late ? "was due" : "due"} ${fd(i.due)}` : "no date"}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
          <section className="panel ps-wk">
            <div className="ph"><h3 className="ps-h">Added vs finished per week</h3><span className="sp" /><Link className="hint" href={`/?proj=${encodeURIComponent(project.id)}#box-daily`}>Day by day →</Link></div>
            <div className="pb" style={{ paddingTop: 6 }}><WeekColumns weeks={delivery.weeks} /></div>
          </section>
        </div>
      </section>
    </div>
  );
}
