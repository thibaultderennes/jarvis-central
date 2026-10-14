#!/usr/bin/env node
// Product metrics (users, active users, visits, revenue…) for the project page's Stats view and the Monday review.
// A project opts in with a source in jarvis.config.json → metrics.sources.<project id>:
//   {"url": "https://…", "token_env": "MY_APP_METRICS_TOKEN", "header": "Authorization", "map": {"visits": "results.visitors.value"}}
//   {"command": "python3 scripts/metrics.py", "map": {…}}
//   [{…}, {…}]   several sources for one project: their numbers are merged into one snapshot
// The URL is fetched (GET, `Bearer <token>` from the env var named by token_env, read from the environment or
// ~/.config/jarvis/env) or the command runs in the project folder; either must give a JSON object. `map` picks numbers
// by dotted path; without it every top-level number (or {"value": n}) is taken, from `metrics` when the object has one.
// The result is posted as today's snapshot (POST /api/agent/metrics). The inbox worker runs it once a day
// (metrics.sync_minutes). Secrets never go in the config: only the names of env vars.
//
// A live project (a website that answers, or a state that says live) with no numbers is a gap: `status` lists the
// gaps, doctor and the Monday reviews name them, and the worker adds one reminder todo a week (metrics.remind).
//
//   node metrics.mjs sync [--project id] [--dry-run]   fetch every source and post a snapshot (dry run: print only)
//   node metrics.mjs status                            live projects with no source, or no numbers in metrics.stale_days
import { exec } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { api, qs, CONFIG, cacheDir, loadConfig, todayTZ, addDays, mondayOf } from "./lib.mjs";

const M = CONFIG.metrics || {};
const SOURCES = M.sources && typeof M.sources === "object" ? M.sources : {};
const TIMEOUT = Math.max(5, Number(M.timeout_seconds ?? 30)) * 1000;
const KEY = /^[a-z][a-z0-9_]{0,39}$/;

const num = (v) => {
  if (v && typeof v === "object" && !Array.isArray(v) && "value" in v) v = v.value;
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};
// A dotted path. In an array a number picks that element, and a negative one counts from the end (-1 = the last).
const at = (o, p) => String(p).split(".").reduce((x, k) => (x == null ? undefined : Array.isArray(x) && /^-?\d+$/.test(k) ? x.at(+k) : x[k]), o);

/** A JSON value → {key: number}. Exported for tests and the CLI. */
export function pick(json, map) {
  const out = {};
  if (map && typeof map === "object") {
    for (const [k, p] of Object.entries(map)) { const n = num(at(json, p)); if (KEY.test(k) && n !== null) out[k] = n; }
    return out;
  }
  const src = json && typeof json.metrics === "object" && json.metrics ? json.metrics : json;
  if (!src || typeof src !== "object" || Array.isArray(src)) return out;
  for (const [k, v] of Object.entries(src)) { const n = num(v); if (KEY.test(k) && n !== null) out[k] = n; }
  return out;
}

/** A project's entry under metrics.sources → a list of sources (one object, or an array of them). */
export const sourceList = (entry) => (Array.isArray(entry) ? entry : entry ? [entry] : []).filter((x) => x && typeof x === "object");

const secrets = () => ({ ...loadConfig(), ...process.env });

/** Run one source and return its JSON. */
export async function fetchSource(src, dir) {
  if (src.url) {
    const env = secrets(), token = src.token_env ? env[src.token_env] : null;
    if (src.token_env && !token) throw new Error(`env var ${src.token_env} is not set (shell or ~/.config/jarvis/env)`);
    const header = src.header || "Authorization";
    const res = await fetch(src.url, { headers: { Accept: "application/json", ...(token ? { [header]: header === "Authorization" ? `Bearer ${token}` : token } : {}) }, signal: AbortSignal.timeout(TIMEOUT) });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} from the source URL`);
    return res.json();
  }
  if (src.command) {
    if (!dir || !fs.existsSync(dir)) throw new Error("the project has no folder on this Mac to run the command in");
    const stdout = await new Promise((resolve, reject) => exec(String(src.command), { cwd: dir, timeout: TIMEOUT, env: { ...secrets(), JARVIS_AGENT_TOKEN: "" }, maxBuffer: 4 * 1024 * 1024 }, (err, out, errOut) => {
      if (err?.killed) return reject(new Error(`the command took longer than ${TIMEOUT / 1000}s (metrics.timeout_seconds)`));
      if (err) return reject(new Error((errOut || err.message).trim().split("\n").slice(-2).join(" ").slice(0, 300)));
      resolve(out);
    }));
    const t = String(stdout).trim(), a = t.indexOf("{"), b = t.lastIndexOf("}");
    if (a < 0 || b < a) throw new Error("the command printed no JSON object");
    return JSON.parse(t.slice(a, b + 1));
  }
  throw new Error("a metrics source needs a url or a command");
}

/** Fetch every configured source and post today's snapshot when the numbers changed. With several sources for one
 * project, the numbers of those that answered are posted and each failure is logged. */
export async function syncMetrics(projects, log, { only = null, dryRun = false } = {}) {
  const out = { projects: 0, synced: 0, unchanged: 0, failed: 0 }, t = todayTZ();
  for (const [id, entry] of Object.entries(SOURCES)) {
    if (only && id !== only) continue;
    const p = projects.find((x) => x.id === id), list = sourceList(entry);
    if (!p || !list.length) { if (!p) log("metrics source for an unknown project", id); continue; }
    out.projects++;
    const metrics = {}, kinds = new Set();
    let errors = 0;
    for (const [i, src] of list.entries()) {
      try {
        const got = pick(await fetchSource(src, p.dir), src.map);
        if (!Object.keys(got).length) throw new Error("the source gave no numbers (check `map`)");
        Object.assign(metrics, got);
        kinds.add(src.url ? "url" : "command");
      } catch (e) { errors++; log("metrics source failed", id, `${list.length > 1 ? `source ${i + 1}: ` : ""}${e.message}`); }
    }
    if (errors) out.failed++;
    if (!Object.keys(metrics).length) continue;
    const [last] = dryRun ? [] : await api("GET", "/api/agent/metrics" + qs({ project: id, since: t })).catch(() => []);
    if (last && Object.entries(metrics).every(([k, v]) => last.metrics?.[k] === Math.round(v * 100) / 100)) { out.unchanged++; continue; }
    log(dryRun ? "would post" : "post", id, metrics);
    if (!dryRun) await api("POST", "/api/agent/metrics", { project_id: id, date: t, metrics, source: kinds.size === 1 ? [...kinds][0] : "mixed" });
    out.synced++;
  }
  return out;
}

/** For the worker's per-minute pass: at most every `metrics.sync_minutes` (default 1440, once a day; 0 = every pass). */
export async function syncMetricsDue(projects, log) {
  if (!Object.keys(SOURCES).length) return null;
  const every = Math.max(0, Number(M.sync_minutes ?? 1440)) * 60_000;
  const stamp = path.join(cacheDir(), "metrics.last-sync");
  if (every) { try { if (Date.now() - fs.statSync(stamp).mtimeMs < every) return null; } catch {} }
  try { return await syncMetrics(projects, log); }
  finally { try { fs.writeFileSync(stamp, new Date().toISOString()); } catch {} }
}

// ---------- gaps: live projects with no numbers ----------

/** Should this project have product numbers? Live = a website that answers (or one the owner set) or a state that says
 * live. `metrics.expect` adds ids (a channel, an app without a site), `metrics.skip` removes them (an internal tool).
 * Archived projects never do. */
export function expectsNumbers(p, { expect = [], skip = [] } = {}) {
  if (!p || p.archived || skip.includes(p.id)) return false;
  if (expect.includes(p.id)) return true;
  return !!(p.site_url || p.site?.live || /\blive\b/i.test(String(p.state || "")));
}

/**
 * Live projects with no recent numbers. Pure: for the CLI, doctor, the worker's reminder and the reviews.
 *   projects   /api/agent/projects rows
 *   sources    metrics.sources ({id: source | [sources]})
 *   snapshots  /api/agent/metrics rows (any range; the newest per project counts)
 * → [{id, name, source, last, days, why}] for each expected project whose newest snapshot is `staleDays` old or more
 *   (or missing). why: "no-source" (nothing connected), "never" (a source that has never posted), "stale" (it stopped).
 */
export function metricsGaps({ projects = [], sources = {}, snapshots = [], today, staleDays = 7, expect = [], skip = [] }) {
  const latest = {};
  for (const s of snapshots) if (!latest[s.project_id] || s.date > latest[s.project_id]) latest[s.project_id] = s.date;
  const cutoff = addDays(today, -Math.max(1, staleDays));
  const out = [];
  for (const p of projects) {
    if (!expectsNumbers(p, { expect, skip })) continue;
    const source = sourceList(sources?.[p.id]).length > 0, last = latest[p.id] || null;
    if (last && last > cutoff) continue;
    const days = last ? Math.round((Date.parse(today) - Date.parse(last)) / 86_400_000) : null;
    out.push({ id: p.id, name: p.name || p.id, source, last, days, why: !source ? "no-source" : last ? "stale" : "never" });
  }
  return out;
}

/** One line per gap, for doctor, the CLI and the review bundles. */
export const gapLine = (g) => `${g.name} (${g.id}): ${
  g.why === "no-source" ? `no source connected and ${g.last ? `nothing typed since ${g.last}` : "nothing ever typed by hand"}`
  : g.why === "never" ? "a source is set but has never posted (see metrics lines in the worker log)"
  : `the source hasn't posted since ${g.last} (see metrics lines in the worker log)`}`;

export const gapOptions = (m = M) => ({
  staleDays: Math.max(1, Number(m.stale_days ?? 7) || 7),
  expect: Array.isArray(m.expect) ? m.expect : [],
  skip: Array.isArray(m.skip) ? m.skip : [],
});

/** Gaps against the API: the projects (pass them in when you have them) and the snapshots of the last stale_days. */
export async function currentGaps(projects = null) {
  const o = gapOptions(), today = todayTZ();
  const ps = projects || (await api("GET", "/api/agent/projects"));
  const snapshots = await api("GET", "/api/agent/metrics" + qs({ since: addDays(today, -o.staleDays) }));
  return metricsGaps({ projects: ps, sources: SOURCES, snapshots, today, ...o });
}

/** The weekly reminder: one todo for every live project with no source and nothing typed lately (a broken source is
 * the worker log's and doctor's job, not a todo). Null when there is nothing to type. */
export function reminderTodo(gaps, today) {
  const typed = gaps.filter((g) => g.why === "no-source");
  if (!typed.length) return null;
  return {
    title: `Record this week's product numbers: ${typed.map((g) => g.name).join(", ")} (jarvis metrics <id> --set users=… --set visits=…)`.slice(0, 300),
    date: today, kind: "work", ...(typed.length === 1 ? { project_id: typed[0].id } : {}),
  };
}

/** For the worker: the first pass of each week (Monday or later) adds the reminder todo. Off with metrics.remind: false. */
export async function remindMetricsDue(projects, log) {
  if (M.remind === false) return null;
  const week = mondayOf(todayTZ()), stamp = path.join(cacheDir(), "metrics.last-reminder");
  try { if (fs.readFileSync(stamp, "utf8").trim() >= week) return null; } catch {}
  const gaps = await currentGaps(projects);
  const todo = reminderTodo(gaps, todayTZ());
  if (todo) { await api("POST", "/api/agent/todos", todo); log("metrics reminder added", todo.title); }
  try { fs.writeFileSync(stamp, week); } catch {}
  return { gaps: gaps.length, todo: !!todo };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "status") {
    currentGaps().then((gaps) => {
      if (!gaps.length) return console.log("Every live project has numbers from the last week (or is skipped in metrics.skip).");
      console.log(`${gaps.length} live project(s) without recent numbers:`);
      for (const g of gaps) console.log(`- ${gapLine(g)}`);
      console.log("\nType them: node agent/jarvis.mjs metrics <id> --set users=… --set active_users=… --set visits=…\nOr connect a source: metrics.sources.<id> in jarvis.config.json (docs/metrics.md). Not a product? Add its id to metrics.skip.");
    }).catch((e) => { console.error(e.message); process.exitCode = 1; });
  } else if (cmd === "sync") {
    const i = rest.indexOf("--project");
    const only = i >= 0 ? rest[i + 1] : null, dryRun = rest.includes("--dry-run");
    const log = (...parts) => console.log(parts.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
    (async () => {
      if (!Object.keys(SOURCES).length) return console.log("No metrics sources in jarvis.config.json (metrics.sources.<project id>). See docs/metrics.md.");
      const projects = await api("GET", "/api/agent/projects");
      const r = await syncMetrics(projects, log, { only, dryRun });
      console.log(`${dryRun ? "would post" : "posted"} ${r.synced} snapshot(s), ${r.unchanged} unchanged, ${r.failed} with a failed source, across ${r.projects} project(s)`);
    })().catch((e) => { console.error(e.message); process.exitCode = 1; });
  } else {
    console.log("Usage: node metrics.mjs sync [--project id] [--dry-run]\n       node metrics.mjs status");
    process.exitCode = cmd ? 1 : 0;
  }
}
