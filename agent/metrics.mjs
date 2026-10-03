#!/usr/bin/env node
// Product metrics (users, active users, visits, revenue…) for the project page's Stats view and the Monday review.
// A project opts in with a source in jarvis.config.json → metrics.sources.<project id>:
//   {"url": "https://…", "token_env": "MY_APP_METRICS_TOKEN", "header": "Authorization", "map": {"visits": "results.visitors.value"}}
//   {"command": "python3 scripts/metrics.py", "map": {…}}
// The URL is fetched (GET, `Bearer <token>` from the env var named by token_env, read from the environment or
// ~/.config/jarvis/env) or the command runs in the project folder; either must give a JSON object. `map` picks numbers
// by dotted path; without it every top-level number (or {"value": n}) is taken, from `metrics` when the object has one.
// The result is posted as today's snapshot (POST /api/agent/metrics). The inbox worker runs it once a day
// (metrics.sync_minutes). Secrets never go in the config: only the names of env vars.
//
//   node metrics.mjs sync [--project id] [--dry-run]   fetch every source and post a snapshot (dry run: print only)
import { exec } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { api, qs, CONFIG, cacheDir, loadConfig, todayTZ } from "./lib.mjs";

const M = CONFIG.metrics || {};
const SOURCES = M.sources && typeof M.sources === "object" ? M.sources : {};
const TIMEOUT = Math.max(5, Number(M.timeout_seconds ?? 30)) * 1000;
const KEY = /^[a-z][a-z0-9_]{0,39}$/;

const num = (v) => {
  if (v && typeof v === "object" && !Array.isArray(v) && "value" in v) v = v.value;
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};
const at = (o, p) => String(p).split(".").reduce((x, k) => (x == null ? undefined : x[/^\d+$/.test(k) && Array.isArray(x) ? +k : k]), o);

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

/** Fetch every configured source and post today's snapshot when the numbers changed. */
export async function syncMetrics(projects, log, { only = null, dryRun = false } = {}) {
  const out = { projects: 0, synced: 0, unchanged: 0, failed: 0 }, t = todayTZ();
  for (const [id, src] of Object.entries(SOURCES)) {
    if (only && id !== only) continue;
    const p = projects.find((x) => x.id === id);
    if (!p || !src || typeof src !== "object") { if (!p) log("metrics source for an unknown project", id); continue; }
    out.projects++;
    let metrics;
    try {
      metrics = pick(await fetchSource(src, p.dir), src.map);
      if (!Object.keys(metrics).length) throw new Error("the source gave no numbers (check `map`)");
    } catch (e) { out.failed++; log("metrics source failed", id, e.message); continue; }
    const [last] = dryRun ? [] : await api("GET", "/api/agent/metrics" + qs({ project: id, since: t })).catch(() => []);
    if (last && Object.entries(metrics).every(([k, v]) => last.metrics?.[k] === Math.round(v * 100) / 100)) { out.unchanged++; continue; }
    log(dryRun ? "would post" : "post", id, metrics);
    if (!dryRun) await api("POST", "/api/agent/metrics", { project_id: id, date: t, metrics, source: src.url ? "url" : "command" });
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

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "sync") {
    const i = rest.indexOf("--project");
    const only = i >= 0 ? rest[i + 1] : null, dryRun = rest.includes("--dry-run");
    const log = (...parts) => console.log(parts.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
    (async () => {
      if (!Object.keys(SOURCES).length) return console.log("No metrics sources in jarvis.config.json (metrics.sources.<project id>). See docs/metrics.md.");
      const projects = await api("GET", "/api/agent/projects");
      const r = await syncMetrics(projects, log, { only, dryRun });
      console.log(`${dryRun ? "would post" : "posted"} ${r.synced} snapshot(s), ${r.unchanged} unchanged, ${r.failed} failed, across ${r.projects} source(s)`);
    })().catch((e) => { console.error(e.message); process.exitCode = 1; });
  } else {
    console.log("Usage: node metrics.mjs sync [--project id] [--dry-run]");
    process.exitCode = cmd ? 1 : 0;
  }
}
