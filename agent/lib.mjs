// Shared helpers for the Jarvis agent (CLI, worker, planner, weekly reviews).
// Settings come from <repo>/jarvis.config.json (gitignored), deep-merged over jarvis.config.example.json.
// Secrets come from ~/.config/jarvis/env. Nothing personal is hardcoded here.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const HOME = os.homedir();
export const AGENT_DIR = path.dirname(new URL(import.meta.url).pathname);
export const JARVIS_ROOT = path.dirname(AGENT_DIR);
export const CLI = path.join(AGENT_DIR, "jarvis.mjs");
export const CONFIG_FILE = path.join(JARVIS_ROOT, "jarvis.config.json");
export const EXAMPLE_CONFIG_FILE = path.join(JARVIS_ROOT, "jarvis.config.example.json");

export const expandHome = (p) => (typeof p === "string" && p.startsWith("~") ? path.join(HOME, p.slice(1)) : p);
const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
function deepMerge(base, over) {
  if (!isObj(base) || !isObj(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = isObj(v) && isObj(base[k]) ? deepMerge(base[k], v) : v;
  return out;
}
const readJSON = (f) => JSON.parse(fs.readFileSync(f, "utf8"));

/** Built-in defaults: the example config minus its illustrative sample values. */
function defaults() {
  let ex = {};
  try { ex = readJSON(EXAMPLE_CONFIG_FILE); } catch {}
  delete ex.$schema;
  ex.owner_name = "";
  ex.site_url = "";
  ex.timezone = "UTC";
  if (ex.projects) ex.projects = { ...ex.projects, overrides: {} };
  if (ex.planner) ex.planner = { ...ex.planner, project_caps: {} };
  return ex;
}

/** Load settings. `configExists` tells callers whether the owner created jarvis.config.json yet. */
export function loadSettings() {
  let user = {}, configExists = false, configError = null;
  if (fs.existsSync(CONFIG_FILE)) {
    configExists = true;
    try { user = readJSON(CONFIG_FILE); } catch (e) { configError = e.message; }
  }
  const cfg = deepMerge(defaults(), user);
  delete cfg.$schema;
  cfg.projects_root = expandHome(cfg.projects_root || "~/Projects");
  return { cfg, configExists, configError };
}
const _settings = loadSettings();
export const CONFIG = _settings.cfg;
export const CONFIG_EXISTS = _settings.configExists;
export const CONFIG_ERROR = _settings.configError;
export const TZ = process.env.JARVIS_TZ || CONFIG.timezone || "UTC";
export const PROJECTS_ROOT = CONFIG.projects_root;
export const OWNER = CONFIG.owner_name || "the owner";
export const ENV_FILE = path.join(HOME, ".config", "jarvis", "env");
export const LOG_DIR = process.platform === "darwin" ? path.join(HOME, "Library", "Logs", "jarvis") : path.join(HOME, ".local", "state", "jarvis", "logs");
const CACHE_DIR = path.join(HOME, ".cache", "jarvis");

/** KEY=VALUE lines from ~/.config/jarvis/env; real env vars win. */
export function loadConfig() {
  const cfg = {};
  try {
    for (const line of fs.readFileSync(ENV_FILE, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !line.trimStart().startsWith("#")) cfg[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
  for (const k of ["JARVIS_URL", "JARVIS_AGENT_TOKEN", "JARVIS_TZ"]) if (process.env[k]) cfg[k] = process.env[k];
  if (cfg.JARVIS_URL) cfg.JARVIS_URL = cfg.JARVIS_URL.replace(/\/+$/, "");
  return cfg;
}

export class ApiError extends Error {
  constructor(msg, status, body) { super(msg); this.status = status; this.body = body; }
}

/** Call the Jarvis agent API. `pathAndQuery` like "/api/agent/items?project=my-app". */
export async function api(method, pathAndQuery, body) {
  const cfg = loadConfig();
  if (!cfg.JARVIS_URL || !cfg.JARVIS_AGENT_TOKEN)
    throw new ApiError(`Missing JARVIS_URL or JARVIS_AGENT_TOKEN in ${ENV_FILE}`, 0);
  const url = cfg.JARVIS_URL + pathAndQuery;
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${cfg.JARVIS_AGENT_TOKEN}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    throw new ApiError(`${method} ${pathAndQuery} failed: ${e.name === "TimeoutError" ? "timed out after 30 s" : e.message}`, 0);
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const why = (data && data.error) || (typeof data === "string" ? data.slice(0, 300) : res.statusText);
    const hint = res.status === 401 ? " (check JARVIS_AGENT_TOKEN)" : "";
    throw new ApiError(`${method} ${pathAndQuery} → ${res.status}: ${why}${hint}`, res.status, data);
  }
  return data;
}

export const qs = (o) => {
  const p = Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== "");
  return p.length ? "?" + p.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&") : "";
};

/** Append a line to <LOG_DIR>/<name>.log (and echo to stderr when interactive). */
export function makeLog(name) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const file = path.join(LOG_DIR, `${name}.log`);
  return (...parts) => {
    const line = `${new Date().toISOString()} ${parts.map((p) => (typeof p === "string" ? p : JSON.stringify(p))).join(" ")}`;
    try { fs.appendFileSync(file, line + "\n"); } catch {}
    if (process.stderr.isTTY) process.stderr.write(line + "\n");
  };
}

/**
 * Wrap a log so a line keyed `key` is written only when `state` changed since the last pass (each pass is a new
 * process, so the last state lives in <cache>/<name>-logstate.json). Returns logChanged(key, state, ...parts).
 */
export function makeLogOnce(name, log) {
  const file = path.join(CACHE_DIR, `${name}-logstate.json`);
  let seen = {};
  try { seen = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
  return (key, state, ...parts) => {
    const s = JSON.stringify(state);
    if (seen[key] === s) return;
    seen[key] = s;
    try { fs.mkdirSync(CACHE_DIR, { recursive: true }); fs.writeFileSync(file, JSON.stringify(seen)); } catch {}
    log(...parts);
  };
}

/** Exclusive lock so launchd runs never overlap. Returns release() or null if held. Stale after 20 min. */
export function acquireLock(name, staleMs = 20 * 60_000) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const file = path.join(CACHE_DIR, `${name}.lock`);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(file, "wx");
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
      fs.closeSync(fd);
      const release = () => { try { fs.unlinkSync(file); } catch {} };
      process.on("exit", release);
      return release;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      let stale = false;
      try {
        const st = fs.statSync(file);
        const { pid } = JSON.parse(fs.readFileSync(file, "utf8") || "{}");
        let alive = false;
        if (pid) { try { process.kill(pid, 0); alive = true; } catch {} }
        stale = !alive || Date.now() - st.mtimeMs > staleMs;
      } catch { stale = true; }
      if (!stale) return null;
      try { fs.unlinkSync(file); } catch {}
    }
  }
  return null;
}

export const cacheDir = (...p) => { const d = path.join(CACHE_DIR, ...p); fs.mkdirSync(d, { recursive: true }); return d; };

/** YYYY-MM-DD for a Date in the Jarvis timezone. */
export function dateTZ(d = new Date(), tz = TZ) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
export const todayTZ = () => dateTZ(new Date());
export function addDays(ymd, n) {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}
/** Monday (YYYY-MM-DD) of the week containing ymd. */
export function mondayOf(ymd = todayTZ()) {
  const [y, m, d] = ymd.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 Sun
  return addDays(ymd, -((wd + 6) % 7));
}
/** Start of a local (TZ) calendar day as a UTC Date. */
export function tzDayStart(ymd, tz = TZ) {
  const [y, m, d] = ymd.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, 12);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(guess));
  const g = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const asUTC = Date.UTC(+g.year, +g.month - 1, +g.day, +g.hour % 24, +g.minute);
  const offset = asUTC - guess; // tz offset in ms
  return new Date(Date.UTC(y, m - 1, d) - offset);
}

/** Lenient JSON extraction from model output: strips fences, takes first { .. last }. */
export function parseModelJSON(text) {
  if (!text) throw new Error("empty model output");
  let t = String(text).trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(t); } catch {}
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b <= a) throw new Error("no JSON object in model output");
  return JSON.parse(t.slice(a, b + 1));
}

export const hostName = () => os.hostname();
