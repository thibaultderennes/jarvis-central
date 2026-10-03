#!/usr/bin/env node
// Unit-economics models. A project opts in by keeping a model file in its folder (the first of `economics.files` that
// exists, default jarvis.economics.mjs / .cjs / .js, or the path in `economics.models.<project id>`). The model is
// plain JS that describes a grid (users × usage × plan mix × vendor option × one driver) and two functions that price
// one point of it; the contract is in docs/unit-economics.md. The website runs on Vercel and can't read project
// folders, so this script evaluates every point here, in a child process with a time limit, and uploads the results
// (`PUT /api/agent/economics`) for the project page's Finances tab. Only a changed result is uploaded. The inbox worker
// runs it once an hour (`economics.sync_minutes`).
//
//   node economics.mjs sync [--project id] [--dry-run]   evaluate and upload changed models (dry run: print only)
//   node economics.mjs eval <model file>                 evaluate one model file and print the JSON the site gets
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";
import { api, qs, CONFIG, cacheDir } from "./lib.mjs";

const E = CONFIG.economics || {};
const FILES = Array.isArray(E.files) && E.files.length ? E.files.map(String) : ["jarvis.economics.mjs", "jarvis.economics.cjs", "jarvis.economics.js"];
const MODELS = E.models && typeof E.models === "object" ? E.models : {};
const TIMEOUT = Math.max(5, Number(E.timeout_seconds ?? 30)) * 1000;
export const MAX_POINTS = 50_000; // scenario evaluations per model; keeps the upload well under a megabyte
const SELF = new URL(import.meta.url).pathname;

/** The model file for a project folder, or null when the project hasn't opted in. */
export function modelFile(p) {
  if (!p.dir) return null;
  const rel = MODELS[p.id];
  const list = rel ? [String(rel)] : FILES;
  for (const f of list) {
    const full = path.resolve(p.dir, f);
    // Stay inside the project folder: a config typo must not evaluate some other file on the Mac.
    if (!full.startsWith(path.resolve(p.dir) + path.sep)) continue;
    if (fs.existsSync(full) && fs.statSync(full).isFile()) return full;
  }
  return null;
}

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 100) / 100 : 0);
const str = (v, d = "") => (v === undefined || v === null ? d : String(v)).slice(0, 120);
const ids = (list, what) => {
  if (!Array.isArray(list) || !list.length) throw new Error(`${what} must be a non-empty array`);
  return list.map((x, i) => (typeof x === "object" && x ? { ...x, id: str(x.id ?? i), label: str(x.label ?? x.name ?? x.id ?? i) } : { id: str(x), label: str(x) }));
};
const numbers = (list, what) => {
  if (!Array.isArray(list) || !list.length || !list.every((v) => typeof v === "number" && Number.isFinite(v))) throw new Error(`${what} must be a non-empty array of numbers`);
  return list;
};

/**
 * Evaluate a loaded model over its whole grid. Pure apart from calling the model's functions. Returns the JSON the
 * site stores (see docs/unit-economics.md, "What the site receives").
 */
export async function evaluate(model) {
  // `export default {…}` or CommonJS `module.exports` (which import() exposes as default) win over named exports.
  const m = model?.default && typeof model.default === "object" && typeof model.default.scenario === "function" ? model.default : model;
  if (!m || typeof m.scenario !== "function") throw new Error("the model must export scenario({ option, users, usage, mix, driver })");
  const options = ids(m.options ?? [{ id: "default", label: "Current" }], "options");
  const mixes = ids(m.mixes ?? [{ id: "default", label: "Default mix" }], "mixes");
  const plans = m.plans ? ids(m.plans, "plans").map((p) => ({ id: p.id, label: p.label, price: num(p.price), yearly: p.yearly == null ? null : num(p.yearly) })) : [];
  const users = numbers(m.users ?? [0, 10, 25, 50, 100, 250, 500], "users").map(Math.round).sort((a, b) => a - b);
  const usage = numbers(m.usage ?? [1], "usage");
  const driver = m.driver ? { id: str(m.driver.id, "driver"), label: str(m.driver.label ?? m.driver.id, "Driver"), unit: str(m.driver.unit), values: numbers(m.driver.values, "driver.values") } : null;
  const dvals = driver ? driver.values : [null];
  const points = options.length * mixes.length * usage.length * dvals.length * users.length;
  if (points > MAX_POINTS) throw new Error(`the grid has ${points} points; keep it under ${MAX_POINTS}`);

  const pick = (list, v, d) => (list.some((x) => (x.id ?? x) === v) ? v : d);
  const dflt = m.defaults || {};
  const defaults = {
    option: pick(options, dflt.option, options[0].id),
    mix: pick(mixes, dflt.mix, mixes[0].id),
    usage: usage.includes(dflt.usage) ? dflt.usage : usage[usage.length - 1],
    driver: driver ? (driver.values.includes(dflt.driver ?? m.driver.default) ? (dflt.driver ?? m.driver.default) : driver.values[0]) : null,
    plan: plans.length ? pick(plans, dflt.plan, plans[0].id) : null,
    users: users.includes(dflt.users) ? dflt.users : users[Math.min(users.length - 1, Math.floor(users.length / 2))],
  };

  // Cost lines, in first-seen order; labels from `lineLabels`.
  const lineIds = [], lineIndex = new Map();
  const labels = m.lineLabels || {};
  const grid = {};
  for (let o = 0; o < options.length; o++) for (let x = 0; x < mixes.length; x++) for (let u = 0; u < usage.length; u++) for (let d = 0; d < dvals.length; d++) {
    const rows = [];
    for (const n of users) {
      const r = await m.scenario({ option: options[o].id, users: n, usage: usage[u], mix: mixes[x].id, driver: dvals[d] });
      const lines = r?.lines && typeof r.lines === "object" ? r.lines : {};
      const vals = [];
      for (const [k, v] of Object.entries(lines)) {
        if (!lineIndex.has(k)) { lineIndex.set(k, lineIds.length); lineIds.push(k); }
        vals[lineIndex.get(k)] = num(v);
      }
      const total = typeof r?.total === "number" ? num(r.total) : num(vals.reduce((a, b) => a + (b || 0), 0));
      rows.push([num(r?.revenue), total, ...vals]);
    }
    grid[`${o}.${x}.${u}.${d}`] = rows;
  }
  // Pad rows whose model returned fewer lines than were seen elsewhere.
  for (const rows of Object.values(grid)) for (const row of rows) for (let i = 0; i < lineIds.length; i++) row[2 + i] ??= 0;

  // Fixed = declared in `fixed`, else a line that doesn't move between the smallest and largest non-zero user count
  // at the default point.
  const declared = Array.isArray(m.fixed) ? new Set(m.fixed.map(String)) : null;
  const base = grid[`${options.findIndex((x) => x.id === defaults.option)}.${mixes.findIndex((x) => x.id === defaults.mix)}.${usage.indexOf(defaults.usage)}.${driver ? driver.values.indexOf(defaults.driver) : 0}`];
  const nz = users.map((n, i) => (n > 0 ? i : -1)).filter((i) => i >= 0);
  const lines = lineIds.map((id, i) => ({
    id, label: str(labels[id] ?? id),
    fixed: declared ? declared.has(id) : nz.length > 1 ? base[nz[0]][2 + i] === base[nz[nz.length - 1]][2 + i] : false,
  }));

  // Margin per subscriber: option × usage × driver → one row per plan [monthly revenue, monthly cost, yearly revenue/12, yearly cost/12].
  const planGrid = {};
  if (plans.length && typeof m.plan === "function") {
    for (let o = 0; o < options.length; o++) for (let u = 0; u < usage.length; u++) for (let d = 0; d < dvals.length; d++) {
      const rows = [];
      for (const p of plans) {
        const mo = await m.plan({ option: options[o].id, plan: p.id, usage: usage[u], driver: dvals[d], yearly: false });
        const yr = p.yearly == null ? null : await m.plan({ option: options[o].id, plan: p.id, usage: usage[u], driver: dvals[d], yearly: true });
        rows.push([num(mo?.revenue), num(mo?.cost), yr ? num(yr.revenue) : null, yr ? num(yr.cost) : null]);
      }
      planGrid[`${o}.${u}.${d}`] = rows;
    }
  }

  const thresholds = (Array.isArray(m.thresholds) ? m.thresholds : m.threshold ? [m.threshold] : [])
    .filter((t) => t && typeof t.users === "number").slice(0, 5).map((t) => ({ users: Math.round(t.users), label: str(t.label, `${t.users} users`) }));

  return {
    v: 1, title: str(m.title, "Unit economics"), currency: str(m.currency, "USD").toUpperCase().slice(0, 3), note: str(m.note).slice(0, 300),
    options: options.map(({ id, label }) => ({ id, label })), mixes: mixes.map(({ id, label }) => ({ id, label })), plans,
    users, usage, driver, thresholds, defaults, lines, grid, planGrid,
  };
}

/** Load and evaluate one model file in this process. Used by the child process `eval` starts. */
async function evalHere(file) {
  // stdout carries the result: anything the model logs goes to stderr instead.
  console.log = console.info = console.warn = console.error;
  const mod = await import(pathToFileURL(path.resolve(file)).href);
  return evaluate(mod);
}

/** Evaluate a model file in a child Node process with a time limit, so a slow or broken model can't stall the worker. */
export function evalFile(file) {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [SELF, "eval", file], { cwd: path.dirname(file), timeout: TIMEOUT, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err?.killed) return reject(new Error(`the model took longer than ${TIMEOUT / 1000}s (economics.timeout_seconds)`));
      if (err) return reject(new Error((stderr || err.message).trim().split("\n").slice(-3).join(" ").slice(0, 400)));
      try { resolve(JSON.parse(stdout)); } catch { reject(new Error("the model printed something that isn't JSON")); }
    });
  });
}

const sha = (v) => crypto.createHash("sha256").update(JSON.stringify(v)).digest("hex");

/** Evaluate every opted-in project's model and upload changed results. `dryRun` reads the site but posts nothing. */
export async function syncEconomics(projects, log, { only = null, dryRun = false } = {}) {
  const out = { projects: 0, synced: 0, unchanged: 0, failed: 0 };
  for (const p of projects) {
    if (only && p.id !== only) continue;
    if (!p.dir || !fs.existsSync(p.dir)) continue;
    const file = modelFile(p);
    if (!file) continue;
    out.projects++;
    const rel = path.relative(p.dir, file);
    let data;
    try { data = await evalFile(file); }
    catch (e) {
      out.failed++;
      log("economics model failed", p.id, { file: rel, error: e.message });
      if (!dryRun) await api("PUT", "/api/agent/economics", { project_id: p.id, file: rel, error: e.message }).catch(() => {});
      continue;
    }
    const hash = sha(data);
    const stored = await api("GET", "/api/agent/economics" + qs({ project: p.id })).catch(() => null);
    if (stored?.sha === hash && !stored?.error) { out.unchanged++; continue; }
    log(dryRun ? "would sync" : "sync", p.id, { file: rel, points: Object.values(data.grid).reduce((a, r) => a + r.length, 0), lines: data.lines.length });
    if (!dryRun) await api("PUT", "/api/agent/economics", { project_id: p.id, file: rel, sha: hash, data });
    out.synced++;
  }
  return out;
}

/** For the worker's per-minute pass: runs the sync at most every `economics.sync_minutes` (default 60; 0 = every pass). */
export async function syncEconomicsDue(projects, log) {
  const every = Math.max(0, Number(E.sync_minutes ?? 60)) * 60_000;
  const stamp = path.join(cacheDir(), "economics.last-sync");
  if (every) { try { if (Date.now() - fs.statSync(stamp).mtimeMs < every) return null; } catch {} }
  try { return await syncEconomics(projects, log); }
  finally { try { fs.writeFileSync(stamp, new Date().toISOString()); } catch {} }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "eval" && rest[0]) {
    evalHere(rest[0]).then((d) => process.stdout.write(JSON.stringify(d))).catch((e) => { console.error(e.message); process.exitCode = 1; });
  } else if (cmd === "sync") {
    const i = rest.indexOf("--project");
    const only = i >= 0 ? rest[i + 1] : null, dryRun = rest.includes("--dry-run");
    const log = (...parts) => console.log(parts.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
    (async () => {
      const projects = await api("GET", "/api/agent/projects");
      if (only && !projects.some((p) => p.id === only)) throw new Error(`no project ${only}`);
      const r = await syncEconomics(projects, log, { only, dryRun });
      console.log(`${dryRun ? "would sync" : "synced"} ${r.synced} model(s), ${r.unchanged} unchanged, ${r.failed} failed, across ${r.projects} project(s) with a model`);
    })().catch((e) => { console.error(e.message); process.exitCode = 1; });
  } else {
    console.log("Usage: node economics.mjs sync [--project id] [--dry-run] | node economics.mjs eval <model file>");
    process.exitCode = cmd ? 1 : 0;
  }
}
