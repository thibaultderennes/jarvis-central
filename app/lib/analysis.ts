/*
 * Analysis reports: what a project's own analysis job concluded (a stats digest, a growth review, an ads report…),
 * shown on the project's Stats view beside the numbers, and listed under Docs and reviews as "Analyses".
 *
 * A report is a review row (type 'doc', meta.kind 'analysis'), so it needs no table of its own: it gets the Docs list,
 * Mark as read and the inbox for free. The job posts it with `jarvis analysis <project> --file report.json` (or
 * POST /api/agent/reviews); the API runs cleanAnalysis on meta, and the page reads it back with parseAnalysis, so a
 * malformed or older report still renders whatever is valid. Pure: `npm test` loads it. Format: docs/analysis.md.
 *
 *   meta = {
 *     kind: "analysis",
 *     source: "stats-digest",                    // the job's name: reports from one source form a history
 *     date: "2026-10-21",                        // the report's own date (Docs sorts by it)
 *     period?: { from, to },                     // the window the numbers cover
 *     numbers?: { key: number },                 // headline figures, shown as tiles
 *     series?: [{ key, label, chart?, unit?, points: [{ x: "YYYY-MM-DD", v, n? }] }],
 *     markers?: [{ x: "YYYY-MM-DD", label }],    // dated events drawn on every chart (a change, when it first airs…)
 *     tools?: [{ name, role: "source" | "destination", detail?, status?: "ok" | "degraded" | "failed", note? }],
 *   }
 *
 * Series that share `chart` are drawn on one chart (the chart's title is that value). A cohort view is just a series
 * whose x is the cohort's start date (e.g. retention by publish week), which is why x is a date and not a window.
 */

export type Unit = "n" | "pct" | "days" | "money";
export type Point = { x: string; v: number; n?: number };
export type ASeries = { key: string; label: string; chart: string; unit: Unit; points: Point[] };
export type Marker = { x: string; label: string };
export type ToolRole = "source" | "destination";
export type ToolStatus = "ok" | "degraded" | "failed";
export type Tool = { name: string; role: ToolRole; detail?: string; status?: ToolStatus; note?: string };
export type AnalysisMeta = {
  kind: "analysis"; source: string; date: string; file: string;
  period?: { from: string; to: string }; numbers: Record<string, number>;
  series: ASeries[]; markers: Marker[]; tools: Tool[];
};

const KEY = /^[a-z][a-z0-9_]{0,39}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UNITS: Unit[] = ["n", "pct", "days", "money"];
const LIMITS = { series: 12, points: 400, markers: 20, tools: 12, numbers: 24, text: 120 };

const str = (v: unknown, max = LIMITS.text) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const day = (v: unknown) => { const s = str(v, 40).slice(0, 10); return DATE.test(s) && !Number.isNaN(Date.parse(s)) ? s : ""; };
const fin = (v: unknown) => { const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v; return typeof n === "number" && Number.isFinite(n) ? Math.round(n * 100) / 100 : null; };
const arr = (v: unknown, max: number) => (Array.isArray(v) ? v.slice(0, max) : []);
const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** Is this review an analysis report? */
export const isAnalysis = (r: { type?: string; meta?: Record<string, unknown> | null }) => r.type === "doc" && r.meta?.kind === "analysis";

/**
 * Keep the valid parts of a report's meta, drop the rest. `fallbackDate` is used when meta.date is missing (the day it
 * was posted). Returns null when there's no source name: without it reports can't be grouped into a history.
 */
export function cleanAnalysis(input: unknown, fallbackDate = ""): AnalysisMeta | null {
  const m = obj(input); if (!m) return null;
  const source = str(m.source, 60).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!source) return null;
  const date = day(m.date) || day(fallbackDate);
  const p = obj(m.period), from = day(p?.from), to = day(p?.to);
  const numbers: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj(m.numbers) || {}).slice(0, LIMITS.numbers)) { const n = fin(v); if (KEY.test(k) && n !== null) numbers[k] = n; }
  const seen = new Set<string>();
  const series: ASeries[] = [];
  for (const s of arr(m.series, LIMITS.series)) {
    const o = obj(s); if (!o) continue;
    const key = str(o.key, 40); if (!KEY.test(key) || seen.has(key)) continue;
    const points = arr(o.points, LIMITS.points).map((q) => { const x = obj(q); if (!x) return null; const d = day(x.x), v = fin(x.v), n = fin(x.n); return d && v !== null ? { x: d, v, ...(n !== null && n >= 0 ? { n } : {}) } : null; })
      .filter((q): q is Point => !!q).sort((a, b) => a.x.localeCompare(b.x));
    if (!points.length) continue;
    seen.add(key);
    series.push({ key, label: str(o.label) || key, chart: str(o.chart) || str(o.label) || key, unit: UNITS.includes(o.unit as Unit) ? (o.unit as Unit) : "n", points });
  }
  const markers = arr(m.markers, LIMITS.markers).map((q) => { const o = obj(q); const x = day(o?.x), label = str(o?.label); return x && label ? { x, label } : null; }).filter((q): q is Marker => !!q);
  const tools = arr(m.tools, LIMITS.tools).map((q): Tool | null => {
    const o = obj(q); const name = str(o?.name, 60); if (!o || !name) return null;
    const t: Tool = { name, role: o.role === "destination" ? "destination" : "source" };
    const detail = str(o.detail), note = str(o.note, 240);
    if (detail) t.detail = detail;
    if (o.status === "ok" || o.status === "degraded" || o.status === "failed") t.status = o.status;
    if (note) t.note = note;
    return t;
  }).filter((q): q is Tool => !!q);
  return {
    kind: "analysis", source, date, file: `analysis/${source}/${date || "undated"}`,
    ...(from && to ? { period: from <= to ? { from, to } : { from: to, to: from } } : {}),
    numbers, series, markers, tools,
  };
}

/** A stored review → its analysis view, or null when it isn't one. Same rules as cleanAnalysis (old rows stay safe). */
export function parseAnalysis<T extends { type?: string; created_at: string; meta?: Record<string, unknown> | null }>(r: T): (AnalysisMeta & { review: T }) | null {
  if (!isAnalysis(r)) return null;
  const a = cleanAnalysis(r.meta, r.created_at.slice(0, 10));
  return a ? { ...a, review: r } : null;
}

/** The newest report first, per source. */
export function latestBySource<T extends { type?: string; created_at: string; meta?: Record<string, unknown> | null }>(list: T[]) {
  const out = new Map<string, AnalysisMeta & { review: T }>();
  for (const a of list.map(parseAnalysis).filter((x): x is AnalysisMeta & { review: T } => !!x)) {
    const cur = out.get(a.source);
    if (!cur || a.date > cur.date || (a.date === cur.date && a.review.created_at > cur.review.created_at)) out.set(a.source, a);
  }
  return [...out.values()].sort((a, b) => b.date.localeCompare(a.date));
}

/** Series grouped by chart, in the order they first appear. */
export function charts(series: ASeries[]): { title: string; unit: Unit; series: ASeries[] }[] {
  const by = new Map<string, ASeries[]>();
  for (const s of series) by.set(s.chart, [...(by.get(s.chart) || []), s]);
  return [...by.entries()].map(([title, ss]) => ({ title, unit: ss[0].unit, series: ss }));
}

export type ConnectedTool = Tool & { via: string[]; last: string };
/**
 * Connected tools: every data source and destination the project's reports name, newest status per tool (a tool named
 * by two sources is one row), plus the product-metrics feed when there is one. Sorted sources first, then by name.
 */
export function connectedTools(reports: AnalysisMeta[], metrics?: { date: string; source: string } | null): ConnectedTool[] {
  const by = new Map<string, ConnectedTool>();
  for (const r of [...reports].sort((a, b) => a.date.localeCompare(b.date))) {
    for (const t of r.tools) {
      const k = `${t.role}:${t.name.toLowerCase()}`, cur = by.get(k);
      by.set(k, { ...t, via: [...new Set([...(cur?.via || []), r.source])], last: r.date });
    }
  }
  if (metrics) by.set("source:product metrics", { name: "Product metrics", role: "source", detail: `metrics snapshot (${metrics.source || "manual"})`, status: "ok", via: ["metrics"], last: metrics.date });
  return [...by.values()].sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name) : a.role === "source" ? -1 : 1));
}
