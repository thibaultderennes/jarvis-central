#!/usr/bin/env node
// Daily roll-forward: work you didn't finish on an earlier day comes back to the top of today, by priority, instead
// of slipping silently. The worker runs it once a day (first pass after planner.rollover_at, on a work day).
//
// The rule (also in docs/config.md, "Daily roll-forward"):
//   Qualifies  - an undone todo dated in the last LOOKBACK_DAYS days before today, and
//              - an open checklist item (todo/doing, not done, not cancelled) due today or earlier, not owned by
//                Claude, that has no undone todo anywhere (past, today, later, or Someday).
//              Not parked: Someday todos (no date), projects with "Plan into my calendar" off, archived projects, and
//              todos whose linked item is closed are left alone.
//   Order      critical first, then most days overdue (since the date it was first meant for, or the item's due date),
//              then item priority (1 first, unknown counts as 3), then its old day and position.
//   Caps       at most planner.rollover_max_per_day carry into a day (counting what already rolled in today), and
//              never past planner.max_focus_minutes_per_day of load (the Today load bar's sum: undone todos linked to
//              an item weigh its estimate, 60 min when unknown; unlinked todos weigh nothing). What doesn't fit stays
//              where it is and is first in line tomorrow, one day more overdue.
//   Placement  today, above everything already on today's list, untimed (yesterday's time slot has passed).
//   Repeats    each carry adds 1 to the todo's `rollovers`. A todo still undone after planner.rollover_flag_after
//              carries is parked in Someday instead, and its checklist item (if any) is flagged
//              "check: re-scope" with a note: split it, re-date it, or cancel it.
//   Idempotent a second run on the same day finds nothing to move: carried todos are dated today, the cap counts
//              todos with rolled_at = today, and items with a todo are skipped.
//   Weekends   nothing runs on a day outside planner.work_days (unless planner.weekends is "always"); Monday picks up
//              Friday's leftovers as one carry, three days overdue.
//
//   node rollover.mjs                     roll today (posts to the site)
//   node rollover.mjs --dry-run           print what would move, change nothing
//   node rollover.mjs --date 2026-10-06   pretend today is that date
//   node rollover.mjs --fixture FILE      read {projects, items, todos} from a JSON file instead of the API (implies --dry-run)
import fs from "node:fs";
import path from "node:path";
import { api, qs, makeLog, todayTZ, addDays, cacheDir, CONFIG, TZ } from "./lib.mjs";

const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const LOOKBACK_DAYS = 14; // undone todos older than this are history, not work to carry
export const DEFAULT_EST = 60; // minutes for an item without an estimate (same as the Today load bar)
export const RESCOPE = "Re-scope:"; // refine_note prefix; the checklist shows these flags as "check: re-scope"

const P = CONFIG.planner || {};
export const ROLL_DEFAULTS = {
  rollover: P.rollover !== false,
  rollover_at: /^\d{1,2}:\d{2}$/.test(P.rollover_at || "") ? P.rollover_at : "04:00",
  rollover_max_per_day: P.rollover_max_per_day ?? 5,
  rollover_flag_after: P.rollover_flag_after ?? 3,
  max_focus_minutes_per_day: P.max_focus_minutes_per_day ?? 360,
  work_days: P.work_days || ["Mon", "Tue", "Wed", "Thu", "Fri"],
  weekends: P.weekends || "overflow",
};

const dayNum = (ymd) => Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)) / 864e5;
const daysBetween = (a, b) => Math.round(dayNum(b) - dayNum(a));
const weekdayOf = (ymd) => WD[(new Date(ymd + "T12:00:00Z").getUTCDay() + 6) % 7];
export const isWorkDay = (ymd, s) => s.weekends === "always" || (s.work_days || []).includes(weekdayOf(ymd));

/**
 * Pure: what today's roll-forward does. No network, no clock (today is passed in).
 * todos: every todo from today - LOOKBACK_DAYS onwards plus Someday ({id, date|null, title, done, project_id, item_id,
 * sort, rollovers?, rolled_from?, rolled_at?}); items: open items; projects: [{id, plan_enabled, archived}].
 * Returns {workday, moves, adds, parks, flags, waiting, load: {before, after, cap}, carried}.
 */
export function rollForward({ today, todos = [], items = [], projects = [], settings = {} }) {
  const S = { ...ROLL_DEFAULTS, ...settings };
  const out = { workday: true, moves: [], adds: [], parks: [], flags: [], waiting: [], load: { before: 0, after: 0, cap: S.max_focus_minutes_per_day }, carried: 0 };
  if (!isWorkDay(today, S)) { out.workday = false; return out; }

  const parked = new Set(projects.filter((p) => p.plan_enabled === false || p.archived).map((p) => p.id));
  const key = (x) => (x.project_id && x.item_id ? `${x.project_id}/${x.item_id}` : null);
  const open = new Map(items.filter((i) => i.status === "todo" || i.status === "doing").map((i) => [`${i.project_id}/${i.id}`, i]));
  const minutesOf = (k) => (k ? open.get(k)?.estimate_minutes || DEFAULT_EST : 0);
  const from = addDays(today, -LOOKBACK_DAYS);

  // Today's committed load, as the Today load bar counts it.
  const onToday = todos.filter((t) => t.date === today);
  const counted = new Set();
  for (const t of onToday) { const k = key(t); if (!t.done && k && !counted.has(k)) { counted.add(k); out.load.before += minutesOf(k); } }
  let load = out.load.before;
  let room = Math.max(0, S.rollover_max_per_day - onToday.filter((t) => t.rolled_at === today).length);

  // 1. Undone todos from earlier days: carry, or park + flag once they have rolled too often.
  const cands = [];
  const flagged = new Set();
  for (const t of todos) {
    if (t.done || !t.date || t.date >= today || t.date < from) continue;
    if (t.project_id && parked.has(t.project_id)) continue;
    const k = key(t), item = k ? open.get(k) : null;
    if (k && !item) continue; // its item is closed (or in an archived project): nothing to carry
    const rollovers = Number(t.rollovers) || 0;
    if (rollovers >= S.rollover_flag_after) {
      out.parks.push({ id: t.id, title: t.title, rollovers });
      if (item && !flagged.has(k) && !(item.refine === "flagged" && String(item.refine_note || "").startsWith(RESCOPE))) {
        flagged.add(k);
        out.flags.push({ project_id: item.project_id, id: item.id, refine: "flagged",
          refine_note: `${RESCOPE} carried to the next day ${rollovers} times without being done (first planned for ${t.rolled_from || t.date}). Split it, give it a realistic date, or cancel it. Its todo is in Someday.` });
      }
      continue;
    }
    const since = [t.rolled_from || t.date, item?.due].filter(Boolean).sort()[0];
    cands.push({ kind: "todo", t, k, title: t.title, critical: !!item?.critical, overdue: daysBetween(since, today), priority: item?.priority ?? 3, day: t.date, pos: Number(t.sort) || 0 });
  }

  // 2. Open items due today or earlier with no undone todo anywhere.
  const hasTodo = new Set(todos.filter((t) => !t.done && key(t)).map(key));
  for (const [k, i] of open) {
    if (!i.due || i.due > today || i.owner === "claude" || parked.has(i.project_id) || hasTodo.has(k)) continue;
    cands.push({ kind: "item", i, k, title: i.title, critical: !!i.critical, overdue: daysBetween(i.due, today), priority: i.priority ?? 3, day: i.due, pos: Infinity });
  }

  cands.sort((a, b) => (b.critical - a.critical) || (b.overdue - a.overdue) || (a.priority - b.priority) || a.day.localeCompare(b.day) || (a.pos === b.pos ? 0 : a.pos < b.pos ? -1 : 1) || a.title.localeCompare(b.title));

  // 3. Fill today within the caps, most important first.
  const chosen = [];
  for (const c of cands) {
    const m = c.k && !counted.has(c.k) ? minutesOf(c.k) : 0;
    if (room <= 0) { out.waiting.push({ title: c.title, key: c.k, reason: `daily carry-over cap (${S.rollover_max_per_day}) reached` }); continue; }
    if (m && load + m > S.max_focus_minutes_per_day && load > 0) { out.waiting.push({ title: c.title, key: c.k, reason: `no room today (${load} of ${S.max_focus_minutes_per_day} focus min used, needs ${m})` }); continue; }
    if (c.k) counted.add(c.k);
    load += m; room--; chosen.push(c);
  }
  out.load.after = load;

  // 4. Above today's list, in priority order.
  const top = onToday.length ? Math.min(...onToday.map((t) => Number(t.sort) || 0)) : 1;
  chosen.forEach((c, idx) => {
    const sort = top - (chosen.length - idx);
    if (c.kind === "todo") out.moves.push({ id: c.t.id, title: c.title, date: today, sort, time: null, rollovers: (Number(c.t.rollovers) || 0) + 1, rolled_from: c.t.rolled_from || c.t.date, rolled_at: today, overdue: c.overdue });
    else out.adds.push({ date: today, title: c.title, kind: "work", project_id: c.i.project_id, item_id: c.i.id, sort, source: "rollover", rolled_from: c.i.due, rolled_at: today, overdue: c.overdue });
  });
  out.carried = chosen.length;
  return out;
}

/** One line per change, for the log and --dry-run. */
export function describe(r) {
  if (!r.workday) return ["Not a work day: nothing rolls today."];
  const L = [];
  for (const x of [...r.moves, ...r.adds].sort((a, b) => a.sort - b.sort)) // in the order they now sit on today
    L.push(x.id ? `carry   ${x.title}  (${x.overdue} day(s) overdue, carry ${x.rollovers})` : `add     ${x.title}  [${x.project_id}/${x.item_id}] (due ${x.rolled_from}, ${x.overdue} day(s) overdue)`);
  for (const p of r.parks) L.push(`park    ${p.title}  (carried ${p.rollovers} times → Someday)`);
  for (const f of r.flags) L.push(`flag    [${f.project_id}/${f.id}] check: re-scope`);
  for (const w of r.waiting) L.push(`wait    ${w.title}  (${w.reason})`);
  L.push(`load    ${r.load.before} → ${r.load.after} of ${r.load.cap} min`);
  return L;
}

async function load(today, fixture) {
  if (fixture) {
    const d = JSON.parse(fs.readFileSync(fixture, "utf8"));
    return { projects: d.projects || [], items: d.items || [], todos: d.todos || [], settings: d.settings || {} };
  }
  const [projects, items, todos] = await Promise.all([
    api("GET", "/api/agent/projects"),
    api("GET", "/api/agent/items" + qs({ open: 1 })),
    api("GET", "/api/agent/todos" + qs({ from: addDays(today, -LOOKBACK_DAYS), to: addDays(today, 60), someday: 1 })),
  ]);
  // planner settings saved from the website win over jarvis.config.json, as in plan.mjs.
  let settings = {};
  try { const r = await api("GET", "/api/agent/kv" + qs({ key: "planner.settings" })); const v = r && (r.value ?? r); if (v && typeof v === "object") settings = v; }
  catch (e) { if (e.status !== 404) throw e; }
  const pick = ["max_focus_minutes_per_day", "work_days", "weekends"];
  return { projects, items, todos, settings: Object.fromEntries(pick.filter((k) => settings[k] !== undefined).map((k) => [k, settings[k]])) };
}

/** Compute and (unless dry) apply today's roll-forward. */
export async function runRollover({ today = todayTZ(), dry = false, fixture = null, log = () => {} } = {}) {
  const d = await load(today, fixture);
  const r = rollForward({ today, ...d });
  if (dry || fixture) return r;
  for (const m of r.moves) await api("PATCH", "/api/agent/todos", { id: m.id, date: m.date, sort: m.sort, time: null, rollovers: m.rollovers, rolled_from: m.rolled_from, rolled_at: m.rolled_at });
  for (const a of r.adds) await api("POST", "/api/agent/todos", { date: a.date, title: a.title, kind: a.kind, project_id: a.project_id, item_id: a.item_id, sort: a.sort, source: a.source, rolled_from: a.rolled_from, rolled_at: a.rolled_at });
  for (const p of r.parks) await api("PATCH", "/api/agent/todos", { id: p.id, date: null, time: null });
  for (const f of r.flags) await api("PATCH", "/api/agent/items", f).catch((e) => log("rollover: flag failed", f.id, e.message));
  return r;
}

/**
 * Worker hook: once per day, on the first pass at or after planner.rollover_at. The day is stamped in the cache even
 * when nothing moved, so a todo you send back to an earlier day doesn't bounce again until tomorrow.
 */
export async function rolloverDue(log) {
  if (!ROLL_DEFAULTS.rollover) return null;
  const today = todayTZ();
  const now = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
  if (now.padStart(5, "0") < ROLL_DEFAULTS.rollover_at.padStart(5, "0")) return null;
  const stamp = path.join(cacheDir(), "rollover.last-day");
  try { if (fs.readFileSync(stamp, "utf8").trim() === today) return null; } catch {}
  try { return await runRollover({ today, log }); }
  finally { try { fs.writeFileSync(stamp, today); } catch {} } // a failed day is retried tomorrow (14-day lookback)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const opt = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
  if (argv.includes("--help")) { console.log("Usage: node rollover.mjs [--dry-run] [--date YYYY-MM-DD] [--fixture file.json]"); process.exit(0); }
  const log = makeLog("rollover");
  const today = opt("date") || todayTZ(), fixture = opt("fixture") || null, dry = argv.includes("--dry-run") || !!fixture;
  runRollover({ today, dry, fixture, log }).then((r) => {
    console.log(describe(r).join("\n"));
    if (dry) console.log("\n(dry run: nothing changed)");
    else log("rollover", { today, carried: r.carried, moved: r.moves.length, added: r.adds.length, parked: r.parks.length, flagged: r.flags.length, waiting: r.waiting.length });
  }).catch((e) => { console.error(e.message); process.exitCode = 1; });
}
