#!/usr/bin/env node
// Weekly planner: turns the owner's open checklist items into time blocks for the coming week.
// Step A (claude -p, no tools): estimate minutes + priority for each candidate.
// Step B (this file, no AI): pack them into free slots around calendar events and caps.
// The scheduler runs it at jarvis.config.json → planner.run (default Sunday 17:00, local time).
//
//   node plan.mjs                         plan next week (Sunday → tomorrow's week; other days → next Monday)
//   node plan.mjs --week 2026-10-05       plan the week starting that Monday
//   node plan.mjs --dry-run               print the plan, don't POST
//   node plan.mjs --fixture FILE          read {projects, items, events?, todos?} from a JSON file instead of the API
//   node plan.mjs --no-ai                 skip step A (60 min / priority 3 for everything)
import fs from "node:fs";
import path from "node:path";
import { api, qs, makeLog, acquireLock, todayTZ, addDays, mondayOf, parseModelJSON, HOME, JARVIS_ROOT, TZ, CONFIG, OWNER } from "./lib.mjs";
import { runClaude } from "./claude.mjs";

const log = makeLog("plan");
const argv = process.argv.slice(2);
const flag = (k) => argv.includes(`--${k}`);
const opt = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const DRY = flag("dry-run"), FIXTURE = opt("fixture"), NO_AI = flag("no-ai");
const KNOWN = new Set(["--week", "--dry-run", "--fixture", "--no-ai", "--force"]);
if (flag("help") || argv.some((x, i) => x.startsWith("--") && !KNOWN.has(x) && !(i > 0 && ["--week", "--fixture"].includes(argv[i - 1])))) {
  console.log("Usage: node plan.mjs [--week YYYY-MM-DD] [--dry-run] [--no-ai] [--fixture file.json] [--force]\n  --force  rewrite Google Calendar for that week even if it isn't Sunday");
  process.exit(argv.includes("--help") ? 0 : 1);
}
const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// Defaults ← jarvis.config.json "planner" ← (optional) kv "planner.settings" saved from the website.
const P = CONFIG.planner || {};
const normWeekends = (w) => (w === "overflow" ? "if_overloaded" : w || "if_overloaded"); // "never" | "if_overloaded" (alias "overflow") | "always"
export const DEFAULTS = {
  work_days: P.work_days || ["Mon", "Tue", "Wed", "Thu", "Fri"],
  hours: P.hours || [["09:00", "12:30"], ["13:30", "18:00"]],
  max_focus_minutes_per_day: P.max_focus_minutes_per_day ?? 360,
  buffer_minutes: P.buffer_minutes ?? 15,
  weekends: normWeekends(P.weekends),
  project_caps: P.project_caps || {}, // minutes per week, per project id
  max_chunk_minutes: P.max_chunk_minutes ?? 120,
};

// ---------- time helpers (the configured timezone) ----------
const toMin = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
const toHHMM = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const localParts = (iso) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, min: (Number(p.hour) % 24) * 60 + Number(p.minute) };
};
const BLOCKING_ALLDAY = /vacation|holiday|day off|off work|\booo\b|out of office|travel|flight|congé|vacances|férié/i;

/** Busy intervals per date: {date: [[startMin, endMin], ...]} from calendar events and timed todos. */
export function busyByDay(events, todos, days) {
  const busy = Object.fromEntries(days.map((d) => [d, []]));
  const blockedDays = new Set();
  for (const e of events) {
    if (!e.start) continue;
    if (e.allDay) {
      if (!BLOCKING_ALLDAY.test(e.title || "")) continue;
      const s = e.start.slice(0, 10), en = (e.end || e.start).slice(0, 10);
      for (const d of days) if (d >= s && (d < en || d === s)) blockedDays.add(d);
      continue;
    }
    const a = localParts(e.start), b = localParts(e.end || e.start);
    for (const d of days) {
      if (d < a.date || d > b.date) continue;
      const from = d === a.date ? a.min : 0, to = d === b.date ? b.min : 24 * 60;
      if (to > from) busy[d].push([from, to]);
    }
  }
  for (const t of todos) if (t.time && busy[t.date] && !t.done && t.source !== "plan") busy[t.date].push([toMin(t.time), toMin(t.time) + 60]);
  for (const d of blockedDays) busy[d].push([0, 24 * 60]);
  return busy;
}

/** Free intervals of one day: working hours minus busy (each busy interval padded by the buffer). */
function freeIntervals(hours, busy, buffer) {
  let free = hours.map(([a, b]) => [toMin(a), toMin(b)]);
  for (const [bs, be] of busy) {
    const s = bs - buffer, e = be + buffer, out = [];
    for (const [fs_, fe] of free) {
      if (e <= fs_ || s >= fe) { out.push([fs_, fe]); continue; }
      if (s > fs_) out.push([fs_, s]);
      if (e < fe) out.push([e, fe]);
    }
    free = out;
  }
  return free.filter(([a, b]) => b - a >= 15);
}

/**
 * Deterministic packer. candidates: [{key, project_id, item_id, title, due, critical, minutes, priority, not_before, split_ok}]
 * Returns {blocks, unscheduled, usedWeekend}.
 */
export function pack({ candidates, weekStart, settings, busy }) {
  const S = { ...DEFAULTS, ...settings, project_caps: { ...DEFAULTS.project_caps, ...(settings?.project_caps || {}) } };
  S.weekends = normWeekends(S.weekends);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const sunday = days[6];
  const round5 = (m) => Math.ceil(m / 5) * 5;
  const state = Object.fromEntries(days.map((d) => [d, { busy: [...(busy[d] || [])], focus: 0 }]));
  const projUsed = {};
  const blocks = [], unscheduled = [];
  const order = [...candidates].sort((a, b) =>
    (a.due || "9999").localeCompare(b.due || "9999") || (a.priority ?? 3) - (b.priority ?? 3) || (b.critical === true) - (a.critical === true));

  const tryPlace = (c, minutes, allowed) => {
    for (const d of allowed) {
      const st = state[d];
      if (st.focus + minutes > S.max_focus_minutes_per_day) continue;
      for (const [a, b] of freeIntervals(S.hours, st.busy, S.buffer_minutes)) {
        const start = round5(a);
        if (b - start >= minutes) {
          st.busy.push([start, start + minutes]); st.focus += minutes;
          return { date: d, start: toHHMM(start), end: toHHMM(start + minutes) };
        }
      }
    }
    return null;
  };

  const place = (c, allowWeekend) => {
    const workDays = days.filter((d, i) => allowWeekend || S.weekends === "always" || S.work_days.includes(WD[i]));
    const last = c.due && c.due < sunday ? (c.due < weekStart ? sunday : c.due) : sunday; // overdue → any day, earliest first
    const first = c.not_before && c.not_before > weekStart ? c.not_before : weekStart;
    const allowed = workDays.filter((d) => d >= first && d <= last);
    const cap = S.project_caps[c.project_id];
    let remaining = c.minutes, reason = null;
    const chunk = c.split_ok !== false ? S.max_chunk_minutes : Infinity;
    const placed = [];
    if (!allowed.length) reason = first > sunday ? `can't start before ${first}` : c.due && c.due < first ? "due before its earliest start day" : "no working day in its window";
    while (remaining > 0 && !reason) {
      let m = Math.min(remaining, chunk);
      if (m < remaining && remaining - m < 30) m = remaining <= chunk + 30 ? remaining : m; // avoid a tiny tail chunk
      if (cap !== undefined && (projUsed[c.project_id] || 0) + m > cap) { reason = `${c.project_id} weekly cap (${cap} min) reached`; break; }
      const slot = tryPlace(c, m, allowed);
      if (!slot) { reason = placed.length ? `only ${c.minutes - remaining} of ${c.minutes} min fit before ${c.due && c.due <= sunday && c.due >= weekStart ? "its due date" : "the end of the week"}` : `no free ${m}-min slot before ${c.due && c.due <= sunday && c.due >= weekStart ? `its due date (${c.due})` : "the end of the week"}`; break; }
      placed.push({ ...slot, minutes: m });
      projUsed[c.project_id] = (projUsed[c.project_id] || 0) + m;
      remaining -= m;
    }
    return { placed, remaining, reason };
  };

  let usedWeekend = false;
  const leftovers = [];
  for (const c of order) {
    const r = place(c, false);
    r.placed.forEach((s, i) => blocks.push({ project_id: c.project_id, item_id: c.item_id, title: r.placed.length > 1 ? `${c.title} (${i + 1}/${r.placed.length}${r.remaining ? "+" : ""})` : c.title, date: s.date, start: s.start, end: s.end }));
    if (r.remaining > 0) leftovers.push({ c, r });
  }
  // weekends only when the weekdays overflowed
  for (const { c, r } of leftovers) {
    if (S.weekends === "if_overloaded" && !/cap/.test(r.reason || "")) {
      const w = place({ ...c, minutes: r.remaining }, true);
      if (w.placed.length) usedWeekend = true;
      w.placed.forEach((s) => blocks.push({ project_id: c.project_id, item_id: c.item_id, title: `${c.title} (weekend)`, date: s.date, start: s.start, end: s.end }));
      if (w.remaining > 0) unscheduled.push({ project_id: c.project_id, item_id: c.item_id, title: c.title, reason: w.reason || r.reason, minutes: w.remaining });
    } else unscheduled.push({ project_id: c.project_id, item_id: c.item_id, title: c.title, reason: r.reason, minutes: r.remaining });
  }
  blocks.sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
  return { blocks, unscheduled, usedWeekend, projUsed };
}

// ---------- data ----------
/** Offline fixture: a JSON file shaped like the API ({projects, items, events?, todos?, settings?}). */
function loadFixture(file) {
  const d = JSON.parse(fs.readFileSync(file, "utf8"));
  return { projects: d.projects || [], items: (d.items || []).filter((i) => i.status !== "done"), events: d.events || [], todos: d.todos || [], settings: d.settings || {} };
}

async function loadLive(weekStart) {
  const sunday = addDays(weekStart, 6);
  const [projects, items, events, todos] = await Promise.all([
    api("GET", "/api/agent/projects"),
    api("GET", "/api/agent/items" + qs({ open: 1 })),
    api("GET", "/api/agent/calendar" + qs({ from: weekStart, to: sunday })).catch((e) => { log("calendar unavailable", e.message); return []; }),
    api("GET", "/api/agent/todos" + qs({ from: weekStart, to: sunday })).catch(() => []),
  ]);
  let settings = {};
  try { const r = await api("GET", "/api/agent/kv" + qs({ key: "planner.settings" })); settings = (r && (r.value ?? r)) || {}; if (typeof settings !== "object") settings = {}; }
  catch (e) { if (e.status !== 404) log("planner settings unavailable, using defaults", e.message); }
  return { projects, items, events, todos, settings };
}

export function selectCandidates(items, weekStart, todos = []) {
  const sunday = addDays(weekStart, 6), nextSunday = addDays(weekStart, 13);
  const planned = new Set(todos.filter((t) => t.item_id).map((t) => `${t.project_id}/${t.item_id}`));
  const wanted = (i) => i.status !== "done" && ((i.due && i.due <= sunday) || i.status === "doing" || (i.critical && i.due && i.due <= nextSunday));
  const mine = [], claude = [];
  for (const i of items) {
    if (!wanted(i)) continue;
    if (i.owner === "claude") { claude.push(i); continue; }
    const key = `${i.project_id}/${i.id}`;
    if (planned.has(key)) continue;
    mine.push({ key, project_id: i.project_id, item_id: i.id, title: i.title, section: i.section, status: i.status, due: i.due || null, critical: !!i.critical, owner: i.owner || null, detail: (i.detail || "").slice(0, 300), note: (i.note || "").slice(0, 200) });
  }
  return { founder: mine, claude };
}

function estimatePrompt({ candidates, weekStart, projects, busy, settings }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const busyLine = days.map((d, i) => `${WD[i]} ${d}: ${Math.round((busy[d] || []).reduce((s, [a, b]) => s + (b - a), 0) / 60 * 10) / 10} h of calendar events`).join("\n");
  const deadlines = projects.filter((p) => (p.deadlines || []).length).map((p) => `- ${p.name}: ${p.deadlines.map((d) => `${d.label} ${d.date}`).join("; ")}`).join("\n");
  return `You help ${OWNER}, who works alone, plan the week of ${weekStart} (Mon) to ${days[6]} (Sun), timezone ${TZ}. Stance: ${CONFIG.reviews?.stance || "be sceptical and specific"} If the week is overloaded, say so plainly and say what should move.

For each candidate task below, estimate:
- "minutes": realistic focused time for one person to do it alone, 15-240 (people underestimate; admin and outreach take longer than they look).
- "priority": 1 (do first) to 5 (can slip), from deadlines, criticality and what each task unblocks.
- optional "not_before": "YYYY-MM-DD" if it clearly can't start earlier in this week.
- optional "split_ok": false if it must be done in one sitting (a call, a meeting prep); default true.

Also write "notes_md": 3-6 short bullets: is this week realistic (the packer allows ${settings.max_focus_minutes_per_day} focus minutes a day on ${settings.work_days.join(", ")}), what to drop or move, and any task that looks mis-dated or should be split.

Project deadlines:
${deadlines || "(none)"}

Calendar load:
${busyLine}

Candidates (JSON lines):
${candidates.map((c) => JSON.stringify(c)).join("\n")}

Output ONLY one JSON object, no prose before or after, no code fences:
{"estimates": [{"key": "<key>", "minutes": 60, "priority": 2, "not_before": null, "split_ok": true}], "notes_md": "- ..."}
Include every key exactly once.`;
}

function applyEstimates(candidates, est) {
  const by = new Map((est?.estimates || []).map((e) => [e.key, e]));
  let missing = 0;
  const out = candidates.map((c) => {
    const e = by.get(c.key);
    if (!e) missing++;
    const minutes = Math.min(240, Math.max(15, Math.round(Number(e?.minutes) || 60)));
    const priority = Math.min(5, Math.max(1, Math.round(Number(e?.priority) || 3)));
    const not_before = /^\d{4}-\d{2}-\d{2}$/.test(e?.not_before || "") ? e.not_before : null;
    return { ...c, minutes, priority, not_before, split_ok: e?.split_ok !== false };
  });
  return { candidates: out, missing };
}

function summary({ weekStart, blocks, unscheduled, claude, notes, projUsed }) {
  const L = [`Plan for the week of ${weekStart}`, ""];
  for (let i = 0; i < 7; i++) {
    const d = addDays(weekStart, i), bs = blocks.filter((b) => b.date === d);
    if (!bs.length) continue;
    const mins = bs.reduce((s, b) => s + toMin(b.end) - toMin(b.start), 0);
    L.push(`${WD[i]} ${d} — ${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, "0")}`);
    for (const b of bs) L.push(`  ${b.start}-${b.end}  [${b.project_id}/${b.item_id}] ${b.title}`);
  }
  L.push("", `Per project (min): ${JSON.stringify(projUsed)}`);
  if (unscheduled.length) { L.push("", `Didn't fit (${unscheduled.length}):`); for (const u of unscheduled) L.push(`  [${u.project_id}/${u.item_id}] ${u.title} — ${u.reason}`); }
  if (notes) L.push("", notes);
  return L.join("\n");
}

async function main() {
  const release = DRY ? () => {} : acquireLock("plan", 60 * 60_000);
  if (!release) return log("another plan run is in progress");
  const today = todayTZ();
  const weekStart = opt("week") ? mondayOf(opt("week")) : (new Date(today + "T12:00:00Z").getUTCDay() === 0 ? addDays(today, 1) : addDays(mondayOf(today), 7));
  const data = FIXTURE ? loadFixture(FIXTURE) : await loadLive(weekStart);
  const S = { ...DEFAULTS, ...data.settings, project_caps: { ...DEFAULTS.project_caps, ...(data.settings.project_caps || {}) } };
  S.weekends = normWeekends(S.weekends);
  // Per-project settings from the site win over jarvis.config.json: "Plan into my calendar" off → skip the
  // project; "Hours per week" → its weekly cap.
  const planOff = new Set(data.projects.filter((p) => p.plan_enabled === false).map((p) => p.id));
  for (const p of data.projects) if (Number.isFinite(p.weekly_minutes) && p.weekly_minutes !== null) S.project_caps[p.id] = p.weekly_minutes;
  if (planOff.size) data.items = data.items.filter((i) => !planOff.has(i.project_id));
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const busy = busyByDay(data.events, data.todos, days);
  // Never plan into the past: earlier days are closed, and today opens 15 minutes from now.
  const nowMin = (() => { const [h, m] = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date()).split(":").map(Number); return h * 60 + m; })();
  for (const d of days) { if (d < today) busy[d].push([0, 24 * 60]); else if (d === today) busy[d].push([0, nowMin + 15]); }
  const { founder, claude } = selectCandidates(data.items, weekStart, data.todos);
  log("plan start", { weekStart, candidates: founder.length, claude: claude.length, events: data.events.length, dry: DRY, fixture: !!FIXTURE });

  let est = null, cost = 0;
  if (founder.length && !NO_AI) {
    try {
      const res = await runClaude({ prompt: estimatePrompt({ candidates: founder, weekStart, projects: data.projects, busy, settings: S }), cwd: JARVIS_ROOT, tools: "", maxTurns: 3, timeoutMs: 10 * 60_000, log });
      est = parseModelJSON(res.result); cost = res.cost_usd || 0;
      log("estimates", { n: est.estimates?.length, cost_usd: cost, s: res.duration_s });
    } catch (e) { log("estimate step failed, using defaults", e.message); }
  }
  const { candidates, missing } = applyEstimates(founder, est);
  const { blocks, unscheduled, usedWeekend, projUsed } = pack({ candidates, weekStart, settings: S, busy });
  const extra = [];
  if (missing && est) extra.push(`- ${missing} task(s) had no estimate; planned at 60 min, priority 3.`);
  if (!est && founder.length) extra.push(`- Time estimates weren't available; every task is planned at 60 min.`);
  if (usedWeekend) extra.push(`- The weekdays overflowed, so some blocks landed on the weekend.`);
  if (claude.length) extra.push(`- Claude's own items due this week (not on your calendar): ${claude.map((i) => `\`${i.id}\` (${i.project_id})`).join(", ")}.`);
  const notes_md = [est?.notes_md?.trim(), ...extra].filter(Boolean).join("\n");
  const body = { week_start: weekStart, blocks, unscheduled: unscheduled.map(({ minutes, ...u }) => u), notes_md };

  console.log(summary({ weekStart, blocks, unscheduled, claude, notes: notes_md, projUsed }));
  if (DRY) console.log(`\n(dry run: nothing posted${cost ? `; estimate step cost $${cost.toFixed(3)}` : ""})`);
  else {
    if (flag("force")) body.force = true;
    const r = await api("POST", "/api/agent/plan", body);
    log("plan posted", { weekStart, blocks: blocks.length, unscheduled: unscheduled.length, cost_usd: cost, result: r && (r.version ?? r.ok ?? null) });
  }
  release();
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { log("plan crashed", e.stack || e.message); console.error(e.message); process.exitCode = 1; });
