#!/usr/bin/env node
// Security audit reports. Each project keeps them as markdown files in its folder (`audits.dir`, default docs/audits,
// one file per run such as 2026-10-01-sued-hacked.md, usually written by a scheduled audit that opens a PR). This
// script mirrors them to the site as reviews of type "security" (the project page's Docs and reviews (Security audits)): one review per
// file, keyed by the file's path relative to the project folder, so a re-run updates instead of duplicating, and a
// file whose content hash matches the stored one is skipped. The inbox worker runs it once an hour
// (`audits.sync_minutes`); nothing is ever deleted on the site.
//
//   node audits.mjs sync [--project id] [--dry-run]   mirror new or changed reports (dry run: read only, print)
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { api, qs, CONFIG, cacheDir } from "./lib.mjs";

const A = CONFIG.audits || {};
/** Folder, relative to the project folder, that holds the reports. */
export const AUDITS_DIR = String(A.dir || "docs/audits").replace(/^\/+|\/+$/g, "") || "docs/audits";
const SKIP = new Set(["prompts.md", "readme.md"]);
const SEVERITIES = ["critical", "high", "medium", "low"];
const VERDICT = (c) => (c.critical > 0 ? "off-track" : c.high > 0 ? "at-risk" : "on-track");

const plain = (s) => String(s || "").replace(/[*_`#>|]+/g, "").replace(/\s+/g, " ").trim();
const heading = (line) => { const m = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/); return m ? { depth: m[1].length, text: plain(m[2]) } : null; };
const listItem = (line) => { const m = line.match(/^\s{0,3}(?:[-*+]|\d+[.)])\s+(.+)$/); return m ? plain(m[1]) : null; };

/**
 * Findings per severity. First a summary line such as "2 critical, 5 high, 3 low" (its text becomes the headline);
 * else CRITICAL / HIGH / MEDIUM / LOW sections counted by their sub-headings (or top-level list items); else lines that
 * mark a FAIL with a severity. Null when the file has none of these.
 */
export function parseCounts(md) {
  const lines = md.split("\n");
  for (const line of lines) {
    const found = {};
    for (const s of SEVERITIES) { const m = line.match(new RegExp(`(\\d+)\\s+${s}\\b`, "i")); if (m) found[s] = +m[1]; }
    if ("critical" in found && "high" in found) return { counts: { critical: 0, high: 0, medium: 0, low: 0, ...found }, line: plain(line).slice(0, 200) };
  }
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  let cur = null, sections = 0;
  for (const line of lines) {
    const h = heading(line);
    if (h) {
      if (cur && h.depth > cur.depth) { counts[cur.sev]++; cur.subs++; continue; }
      // "CRITICAL", "High (2)", "Low findings", "Medium: 3" open a section; "High-level summary" does not.
      const sev = SEVERITIES.find((s) => new RegExp(`^${s}(\\s+(findings|issues|severity|risks?))?(\\s*[(:]\\s*\\d+\\s*\\)?)?$`, "i").test(h.text));
      cur = sev ? { sev, depth: h.depth, subs: 0, items: 0 } : null;
      if (sev) sections++;
      continue;
    }
    if (cur && !cur.subs && listItem(line) && !/^\s*(none|no findings|nothing)\b/i.test(listItem(line))) { counts[cur.sev]++; cur.items++; }
  }
  if (sections) return { counts, line: "" };
  let fails = 0;
  for (const line of lines) {
    if (!/\bFAIL\b/.test(line)) continue;
    // Exactly one severity on the line: "FAIL (HIGH) …" counts, an echoed prompt ("rate it CRITICAL, HIGH, or LOW") doesn't.
    const sevs = SEVERITIES.filter((s) => new RegExp(`\\b${s}\\b`, "i").test(line));
    if (sevs.length === 1) { counts[sevs[0]]++; fails++; }
  }
  return fails ? { counts, line: "" } : null;
}

/** The first list item under a heading that ranks the findings ("Ranked", "Fix order", "Recommended order"). */
export function parseTopRanked(md) {
  let inside = false, depth = 0;
  for (const line of md.split("\n")) {
    const h = heading(line);
    if (h) { if (inside && h.depth <= depth) return null; inside = /\b(rank(ed|ing)?|fix order|recommended order)\b/i.test(h.text); depth = h.depth; continue; }
    if (!inside) continue;
    const item = listItem(line);
    if (item) return item.slice(0, 160);
  }
  return null;
}

/** Title, headline, verdict, date and hash for one report file. Pure. */
export function parseAudit(md, name) {
  const h1 = md.split("\n").map(heading).find((h) => h && h.depth === 1);
  const title = (h1?.text || name.replace(/\.md$/i, "")).slice(0, 200);
  const dm = name.match(/^(\d{4}-\d{2}-\d{2})/);
  const date = dm && !Number.isNaN(Date.parse(dm[1])) ? dm[1] : null;
  const parsed = parseCounts(md);
  const c = parsed?.counts || null;
  let headline = parsed ? parsed.line || `${c.critical} critical, ${c.high} high, ${c.medium} medium, ${c.low} low` : "";
  const top = parseTopRanked(md);
  if (top) headline = (headline ? `${headline} · first: ${top}` : `First: ${top}`).slice(0, 240);
  return { title, headline, verdict: c ? VERDICT(c) : null, counts: c, date, sha: crypto.createHash("sha256").update(md).digest("hex") };
}

/** Every report in <dir>/<AUDITS_DIR>, oldest name first; PROMPTS.md / README.md and dotfiles are not reports. */
export function readAudits(dir) {
  const full = path.join(dir, AUDITS_DIR);
  let names = [];
  try { names = fs.readdirSync(full, { withFileTypes: true }).filter((e) => e.isFile() && /\.md$/i.test(e.name) && !e.name.startsWith(".") && !SKIP.has(e.name.toLowerCase())).map((e) => e.name); } catch { return []; }
  return names.sort().map((name) => {
    const md = fs.readFileSync(path.join(full, name), "utf8");
    return { ...parseAudit(md, name), file: path.posix.join(...AUDITS_DIR.split(/[\\/]+/), name), md };
  });
}

/** Newest report first: by the date in the file name, then by when the site saw it. */
export const newestFirst = (a, b) => String(b.meta?.date || "").localeCompare(String(a.meta?.date || "")) || String(b.created_at).localeCompare(String(a.created_at));

/** Mirror every project's reports to the site. Returns counts; `dryRun` reads the site but posts nothing. */
export async function syncAudits(projects, log, { only = null, dryRun = false } = {}) {
  const out = { projects: 0, synced: 0, unchanged: 0 };
  for (const p of projects) {
    if (only && p.id !== only) continue;
    if (!p.dir || !fs.existsSync(p.dir)) continue;
    const files = readAudits(p.dir);
    if (!files.length) continue;
    out.projects++;
    const stored = await api("GET", "/api/agent/reviews" + qs({ type: "security", project: p.id, limit: 500 }));
    const byFile = new Map(stored.map((r) => [r.meta?.file, r]));
    for (const f of files) {
      if (byFile.get(f.file)?.meta?.sha === f.sha) { out.unchanged++; continue; }
      const body = {
        type: "security", project_id: p.id, title: f.title, headline: f.headline, verdict: f.verdict || undefined, body_md: f.md,
        meta: { kind: "security-audit", file: f.file, date: f.date, sha: f.sha, counts: f.counts },
      };
      log(dryRun ? "would sync" : "sync", p.id, { file: f.file, date: f.date, verdict: f.verdict, headline: f.headline, new: !byFile.has(f.file) });
      if (!dryRun) await api("POST", "/api/agent/reviews", body);
      out.synced++;
    }
  }
  return out;
}

/** For the worker's per-minute pass: runs the sync at most every `audits.sync_minutes` (default 60; 0 = every pass). */
export async function syncAuditsDue(projects, log) {
  const every = Math.max(0, Number(A.sync_minutes ?? 60)) * 60_000;
  const stamp = path.join(cacheDir(), "audits.last-sync");
  if (every) { try { if (Date.now() - fs.statSync(stamp).mtimeMs < every) return null; } catch {} }
  try { return await syncAudits(projects, log); }
  finally { try { fs.writeFileSync(stamp, new Date().toISOString()); } catch {} }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd !== "sync") {
    console.log("Usage: node audits.mjs sync [--project id] [--dry-run]");
    process.exitCode = cmd ? 1 : 0;
  } else {
    const i = rest.indexOf("--project");
    const only = i >= 0 ? rest[i + 1] : null, dryRun = rest.includes("--dry-run");
    const log = (...parts) => console.log(parts.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
    (async () => {
      const projects = await api("GET", "/api/agent/projects");
      if (only && !projects.some((p) => p.id === only)) throw new Error(`no project ${only}`);
      const r = await syncAudits(projects, log, { only, dryRun });
      console.log(`${dryRun ? "would sync" : "synced"} ${r.synced} report(s), ${r.unchanged} unchanged, across ${r.projects} project(s) with reports in ${AUDITS_DIR}/`);
    })().catch((e) => { console.error(e.message); process.exitCode = 1; });
  }
}
