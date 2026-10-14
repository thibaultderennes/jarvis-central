#!/usr/bin/env node
// Inbox upkeep. A reply the owner opened sits in Pending until they mark it treated; for the ones that are only FYI
// (refine and comment notes, plain discuss answers) that's busywork. The worker marks those treated once they've been
// opened for `inbox.auto_treat_fyi_days` days (0 = off), at most once an hour. Never touched: needs_you, error, work
// still with Claude, anything with a branch or PR, merge notes, setup/plan/review/screen/website runs, item builds, and
// a message the owner moved back to Pending after an auto-treat.
//
//   node inbox.mjs auto-treat [--dry-run]   run the sweep now (dry run: list what it would mark, change nothing)
import fs from "node:fs";
import path from "node:path";
import { api, qs, CONFIG, cacheDir } from "./lib.mjs";

const DAY = 864e5;
/** How far back the sweep looks for messages (by creation date). */
const LOOKBACK_DAYS = 90;

export const autoTreatDays = (cfg = CONFIG) => { const n = Number(cfg.inbox?.auto_treat_fyi_days ?? 3); return Number.isFinite(n) && n > 0 ? n : 0; };

/** A reply that only informs: a refine or comment note, or a discussion answered without code. */
export function isFyi(m) {
  const meta = m.meta || {};
  if (!["answered", "done"].includes(m.status)) return false;
  if (meta.pr_url || meta.branch || m.item_id) return false;
  if (meta.kind === "refine" || meta.kind === "comment") return true;
  return m.status === "answered" && ["discuss", "auto"].includes(m.mode) && !meta.kind && meta.mode !== "code";
}

/** FYI replies opened at least `days` days ago and still pending. */
export function dueForAutoTreat(messages, days, now = Date.now()) {
  if (!days) return [];
  return messages.filter((m) => m.opened_at && !m.treated_at && !m.archived && !m.meta?.auto_treated
    && now - +new Date(m.opened_at) >= days * DAY && isFyi(m));
}

async function recentMessages(now) {
  const out = [], seen = new Set();
  let since = new Date(now - LOOKBACK_DAYS * DAY).toISOString();
  for (let page = 0; page < 10; page++) {
    const rows = await api("GET", "/api/agent/messages" + qs({ since, limit: 200 }));
    const fresh = rows.filter((m) => !seen.has(m.id));
    for (const m of fresh) seen.add(m.id), out.push(m);
    if (rows.length < 200 || !fresh.length) break;
    since = rows[rows.length - 1].created_at;
  }
  return out;
}

export async function autoTreat({ log = () => {}, dryRun = false, now = Date.now() } = {}) {
  const days = autoTreatDays();
  if (!days) return { days, treated: [] };
  const due = dueForAutoTreat(await recentMessages(now), days, now);
  if (!dryRun) for (const m of due) {
    await api("PATCH", "/api/agent/messages", { id: m.id, treated: true, meta: { auto_treated: true } });
  }
  if (due.length) log(dryRun ? "inbox: would auto-treat" : "inbox: auto-treated", due.length, due.map((m) => m.id.slice(0, 8)));
  return { days, treated: due };
}

/** The worker's hourly call. */
export async function autoTreatDue(log) {
  if (!autoTreatDays()) return null;
  const stamp = path.join(cacheDir(), "inbox.last-auto-treat");
  try { if (Date.now() - fs.statSync(stamp).mtimeMs < 60 * 60_000) return null; } catch {}
  try { return await autoTreat({ log }); }
  finally { try { fs.writeFileSync(stamp, new Date().toISOString()); } catch {} }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd !== "auto-treat") {
    console.log("Usage: node inbox.mjs auto-treat [--dry-run]");
    process.exitCode = cmd ? 1 : 0;
  } else {
    const dryRun = rest.includes("--dry-run");
    autoTreat({ dryRun }).then(({ days, treated }) => {
      if (!days) return console.log("inbox.auto_treat_fyi_days is 0: auto-treat is off.");
      console.log(`${dryRun ? "Would mark" : "Marked"} ${treated.length} FYI repl${treated.length === 1 ? "y" : "ies"} treated (opened ${days}+ days ago).`);
      for (const m of treated) console.log(`- ${m.id.slice(0, 8)} ${String(m.text).split("\n")[0].slice(0, 80)}`);
    }).catch((e) => { console.error(e.message); process.exitCode = 1; });
  }
}
