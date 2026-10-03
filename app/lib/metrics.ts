import { sql } from "./db";

/*
 * Product metrics per project (table metrics_snapshots): one row per project and day, a JSON object of numbers.
 * Written by agent/metrics.mjs (a project's source in jarvis.config.json) or by hand (`jarvis metrics <p> --set k=v`).
 * The standard keys are below and in docs/metrics.md; any other key matching KEY is kept and listed as "other".
 */
export type Snapshot = { project_id: string; date: string; metrics: Record<string, number>; source: string; updated_at: string };

/** Stock = a level on the day; flow = the total over the 7 days ending on the day (compare like with like). */
export const METRICS: Record<string, { label: string; kind: "stock" | "flow"; money?: boolean; hint: string }> = {
  users: { label: "Users", kind: "stock", hint: "Accounts (or customers) in total" },
  active_users: { label: "Active users", kind: "stock", hint: "Users active in the last 7 days (WAU)" },
  signups: { label: "Signups", kind: "flow", hint: "New accounts in the last 7 days" },
  activated: { label: "Activated", kind: "flow", hint: "New accounts in the last 7 days that reached the activation step" },
  visits: { label: "Visitors", kind: "flow", hint: "Unique visitors in the last 7 days" },
  paying_users: { label: "Paying users", kind: "stock", hint: "Customers paying now" },
  churned: { label: "Churned", kind: "flow", hint: "Paying users lost in the last 7 days" },
  mrr: { label: "MRR", kind: "stock", money: true, hint: "Monthly recurring revenue now" },
  revenue: { label: "Revenue", kind: "flow", money: true, hint: "Money collected in the last 7 days" },
};
export const KEY = /^[a-z][a-z0-9_]{0,39}$/;
export const MAX_KEYS = 40;

/** Keep finite numbers under valid keys; null means "remove this key". Returns null when nothing usable is left. */
export function cleanMetrics(v: unknown): { set: Record<string, number>; drop: string[] } | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const set: Record<string, number> = {}, drop: string[] = [];
  for (const [k, x] of Object.entries(v as Record<string, unknown>).slice(0, MAX_KEYS)) {
    if (!KEY.test(k)) continue;
    if (x === null) drop.push(k);
    else { const n = typeof x === "string" && x.trim() !== "" ? Number(x) : x; if (typeof n === "number" && Number.isFinite(n)) set[k] = Math.round(n * 100) / 100; }
  }
  return Object.keys(set).length || drop.length ? { set, drop } : null;
}

const d10 = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const norm = (r: Record<string, unknown>): Snapshot => ({
  project_id: String(r.project_id), date: d10(r.date), source: String(r.source || ""),
  metrics: (r.metrics && typeof r.metrics === "object" ? r.metrics : {}) as Record<string, number>,
  updated_at: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at || ""),
});
/** Postgres "relation does not exist": the deploy that adds the table hasn't migrated yet. */
const missing = (e: unknown) => (e as { code?: string })?.code === "42P01" || /metrics_snapshots.*does not exist/.test(String((e as Error)?.message));

/** Snapshots for one project (or all when `project` is empty), oldest first, from `since` (YYYY-MM-DD) on. */
export async function getMetrics(opts: { project?: string; since?: string; limit?: number } = {}): Promise<Snapshot[]> {
  const p = opts.project || null, since = opts.since || "1970-01-01", limit = Math.min(2000, Math.max(1, opts.limit || 400));
  try {
    const rows = await sql()`select * from (select project_id, date, metrics, source, updated_at from metrics_snapshots
      where (${p}::text is null or project_id = ${p}) and date >= ${since}::date order by date desc limit ${limit}) s order by date`;
    return rows.map(norm);
  } catch (e) { if (missing(e)) return []; throw e; }
}

/** Upsert the day's row: new keys are merged over what's there (a sync and a hand-typed number can share a day). */
export async function putMetrics(project: string, date: string, m: { set: Record<string, number>; drop: string[] }, source: string): Promise<Snapshot> {
  const [r] = await sql()`insert into metrics_snapshots (project_id, date, metrics, source) values (${project}, ${date}, ${JSON.stringify(m.set)}::jsonb, ${source.slice(0, 40)})
    on conflict (project_id, date) do update set metrics = (metrics_snapshots.metrics || excluded.metrics) - ${m.drop}::text[], source = excluded.source, updated_at = now()
    returning project_id, date, metrics, source, updated_at`;
  return norm(r);
}
