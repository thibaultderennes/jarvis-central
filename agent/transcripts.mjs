// Read Claude Code session transcripts (~/.claude/projects/*/*.jsonl) for the weekly reviews.
// Only the owner's typed messages and cheap session statistics leave this module.
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { HOME } from "./lib.mjs";

const ROOT = path.join(HOME, ".claude", "projects");
const GAP_MS = 20 * 60_000;

function textOf(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    if (content.some((b) => b && b.type === "tool_result")) return null;
    return content.filter((b) => b && b.type === "text").map((b) => b.text).join("\n");
  }
  return null;
}
const isHuman = (d) => d.origin?.kind === "human" || (d.origin === undefined && (d.turnOrigin === "human" || d.promptSource === "typed"));

function transcriptFiles(sinceMs) {
  let dirs = [];
  try { dirs = fs.readdirSync(ROOT); } catch { return []; }
  const files = [];
  for (const d of dirs) {
    const full = path.join(ROOT, d);
    let names = [];
    try { names = fs.readdirSync(full); } catch { continue; }
    for (const n of names) {
      if (!n.endsWith(".jsonl")) continue;
      const f = path.join(full, n);
      try { if (fs.statSync(f).mtimeMs >= sinceMs) files.push(f); } catch {}
    }
  }
  return files;
}

/**
 * One streaming pass over every transcript touched since `since`.
 * Returns { turns: [{sessionId, cwd, timestamp, text}], sessions: Map(sessionId → stats) }.
 */
export async function scan({ since, until = new Date(), cwdPrefix } = {}) {
  const sinceMs = new Date(since).getTime(), untilMs = new Date(until).getTime();
  const turns = [];
  const sessions = new Map();
  const prLinks = new Map();
  for (const file of transcriptFiles(sinceMs)) {
    const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line || line.length > 2_000_000) continue;
      // cheap prefilter before JSON.parse
      if (!line.includes('"timestamp"') && !line.includes('"pr-link"')) continue;
      let d;
      try { d = JSON.parse(line); } catch { continue; }
      const sid = d.sessionId || path.basename(file, ".jsonl");
      if (d.type === "pr-link") {
        const u = d.prUrl || d.url;
        const pt = Date.parse(d.timestamp || "");
        if (u && pt >= sinceMs && pt < untilMs) (prLinks.get(sid) || prLinks.set(sid, new Set()).get(sid)).add(u);
        continue;
      }
      if (!d.timestamp) continue;
      const t = Date.parse(d.timestamp);
      if (!(t >= sinceMs && t < untilMs)) continue;
      const cwd = d.cwd;
      if (cwdPrefix && !(cwd && cwd.startsWith(cwdPrefix))) continue;
      let s = sessions.get(sid);
      if (!s) { s = { sessionId: sid, cwd: cwd || null, first: t, last: t, humanTurns: 0, interrupts: 0, activeMs: 0, _prev: null, prLinks: new Set() }; sessions.set(sid, s); }
      if (!s.cwd && cwd) s.cwd = cwd;
      if (s._prev !== null) { const gap = t - s._prev; if (gap > 0 && gap < GAP_MS) s.activeMs += gap; }
      s._prev = Math.max(s._prev ?? t, t);
      s.first = Math.min(s.first, t); s.last = Math.max(s.last, t);
      if (d.type !== "user") continue;
      const text = textOf(d.message?.content);
      if (text == null) continue;
      if (text.includes("[Request interrupted")) { s.interrupts++; continue; }
      if (!isHuman(d)) continue;
      const trimmed = text.trim();
      if (!trimmed || trimmed.startsWith("<")) continue;
      s.humanTurns++;
      turns.push({ sessionId: sid, cwd: cwd || s.cwd, timestamp: d.timestamp, text: trimmed });
    }
  }
  turns.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  for (const s of sessions.values()) { delete s._prev; s.prLinks = [...s.prLinks, ...(prLinks.get(s.sessionId) || [])]; }
  // headless runs (automation, the Jarvis worker) have no typed turns: they are not the owner's own sessions
  for (const [k, s] of sessions) if (!s.humanTurns) sessions.delete(k);
  return { turns, sessions };
}

export async function extractUserTurns({ since, until, cwdPrefix } = {}) {
  return (await scan({ since, until, cwdPrefix })).turns;
}

/** Aggregate session stats per cwd: {cwd: {sessions, humanTurns, interrupts, activeMinutes, first, last, prLinks}} */
export function statsByCwd(sessions) {
  const by = {};
  for (const s of sessions.values()) {
    const k = s.cwd || "(unknown)";
    const a = (by[k] ||= { sessions: 0, humanTurns: 0, interrupts: 0, activeMinutes: 0, first: null, last: null, prLinks: [] });
    a.sessions++; a.humanTurns += s.humanTurns; a.interrupts += s.interrupts; a.activeMinutes += Math.round(s.activeMs / 60_000);
    a.first = a.first ? Math.min(a.first, s.first) : s.first; a.last = a.last ? Math.max(a.last, s.last) : s.last;
    a.prLinks.push(...s.prLinks);
  }
  for (const a of Object.values(by)) { a.first = a.first && new Date(a.first).toISOString(); a.last = a.last && new Date(a.last).toISOString(); }
  return by;
}

/** Stats for sessions whose cwd starts with `dir` (worktrees under the project included). */
export function statsForDir(sessions, dir) {
  const agg = { sessions: 0, humanTurns: 0, interrupts: 0, activeMinutes: 0, prLinks: [] };
  if (!dir) return agg;
  for (const s of sessions.values()) {
    if (!s.cwd || !s.cwd.startsWith(dir)) continue;
    agg.sessions++; agg.humanTurns += s.humanTurns; agg.interrupts += s.interrupts; agg.activeMinutes += Math.round(s.activeMs / 60_000);
    agg.prLinks.push(...s.prLinks);
  }
  return agg;
}

// CLI: node transcripts.mjs [--days 7]  → counts only
if (import.meta.url === `file://${process.argv[1]}`) {
  const i = process.argv.indexOf("--days");
  const days = i > 0 ? Number(process.argv[i + 1]) : 7;
  const since = new Date(Date.now() - days * 864e5);
  const { turns, sessions } = await scan({ since });
  const by = statsByCwd(sessions);
  console.log(`Last ${days} days: ${turns.length} typed messages, ${sessions.size} sessions`);
  for (const [cwd, a] of Object.entries(by).sort((x, y) => y[1].activeMinutes - x[1].activeMinutes))
    console.log(`  ${cwd.replace(HOME, "~")}: ${a.sessions} sessions, ${a.humanTurns} turns, ${a.interrupts} interrupts, ~${a.activeMinutes} active min, ${a.prLinks.length} PR links`);
}
