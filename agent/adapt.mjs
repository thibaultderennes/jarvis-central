// Adaptive planning (planner.adapt): size next week from what actually got done in the last two, and check that the
// planner's working hours match when the owner really works. Used by plan.mjs before packing.
//
//   planner.adapt            "suggest" (default): notes only · "apply": also caps idle projects · "off"
//   planner.adapt_min_todos  3: the most an idle project (nothing done in 2 weeks) gets under "apply"
//
// Evidence, all read-only: the planner's own todos (source 'plan') and checklist items finished per project
// (GET /api/agent/stats items=1) over the 14 days before the planned week; the owner's actions on the site
// (GET /api/agent/activity) and typed Claude Code messages (agent/transcripts.mjs) for the hours check, with their
// active Claude minutes per project folder.
import { api, qs, addDays, TZ } from "./lib.mjs";
import { scan, statsForDir } from "./transcripts.mjs";

export const MODES = ["suggest", "apply", "off"];
export const normMode = (m) => (MODES.includes(m) ? m : "suggest");
const HISTORY_DAYS = 14;
const MACHINE = new Set(["calendar_feed", "calendar_sync"]); // feed polls and syncs: not the owner

const toMin = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
const pad = (n) => String(n).padStart(2, "0");
const hourOf = (iso) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hour12: false }).format(new Date(iso))) % 24;

/**
 * Per-project history over the window: {project_id: {planned, todosDone, itemsDone, activeMinutes}}.
 * todos: [{project_id, done, source}] · itemsDone: [{project_id}] · minutes: {project_id: n}
 */
export function projectHistory({ todos = [], itemsDone = [], minutes = {} }) {
  const h = {};
  const row = (p) => (h[p] ||= { planned: 0, todosDone: 0, itemsDone: 0, activeMinutes: 0 });
  // Count the planner's own todos; a site from before the `source` column has none marked, so then every project todo counts.
  const marked = todos.some((t) => t.source === "plan");
  for (const t of todos) {
    if (!t.project_id || (marked && t.source !== "plan")) continue;
    row(t.project_id).planned++;
    if (t.done) row(t.project_id).todosDone++;
  }
  for (const i of itemsDone) if (i.project_id) row(i.project_id).itemsDone++;
  for (const [p, m] of Object.entries(minutes)) if (m > 0) row(p).activeMinutes = m;
  return h;
}

/**
 * Which projects to cap and what to say. A project is idle when the planner gave it todos but nothing moved:
 * no todo done, no item done, no active Claude minutes. Explicit caps (config, site "Hours per week") always win.
 * Returns {caps: {project_id: maxCandidates}, lines: [markdown bullet]}.
 */
export function adaptDecision({ history, mode, minTodos = 3, explicit = new Set(), names = {} }) {
  const caps = {}, lines = [];
  if (mode === "off") return { caps, lines };
  const rows = Object.entries(history).filter(([, r]) => r.planned > 0).sort((a, b) => b[1].planned - a[1].planned);
  if (!rows.length) return { caps, lines };
  const parts = rows.map(([p, r]) => {
    const idle = r.todosDone === 0 && r.itemsDone === 0 && r.activeMinutes === 0;
    const pinned = explicit.has(p);
    if (idle && !pinned && mode === "apply") caps[p] = minTodos;
    const done = `${r.todosDone} done${r.itemsDone ? `, ${r.itemsDone} item${r.itemsDone === 1 ? "" : "s"} closed` : ""}${r.activeMinutes ? `, ${r.activeMinutes} min in Claude Code` : ""}`;
    const tail = !idle ? "" : pinned ? " · idle, but its weekly hours are set explicitly, so they stand"
      : mode === "apply" ? ` · idle: capped at ${minTodos} task${minTodos === 1 ? "" : "s"} this week`
      : ` · idle: consider at most ${minTodos} tasks, or switch planning off for it (planner.adapt "apply" does this automatically)`;
    return `${names[p] || p}: planned ${r.planned}, ${done}${tail}`;
  });
  const planned = rows.reduce((s, [, r]) => s + r.planned, 0), done = rows.reduce((s, [, r]) => s + r.todosDone, 0);
  lines.push(`- Last 2 weeks: ${done} of ${planned} planned tasks done (${Math.round((done / planned) * 100)}%).`);
  for (const p of parts) lines.push(`  - ${p}`);
  return { caps, lines };
}

/** Keep at most caps[project] candidates per capped project (they arrive sorted by importance); the rest go unscheduled. */
export function applyCaps(candidates, caps) {
  const n = {}, keep = [], dropped = [];
  for (const c of candidates) {
    const cap = caps[c.project_id];
    if (cap === undefined || (n[c.project_id] = (n[c.project_id] || 0) + 1) <= cap) keep.push(c);
    else dropped.push({ project_id: c.project_id, item_id: c.item_id, title: c.title, reason: `adaptive cap: nothing done on ${c.project_id} in 2 weeks, so at most ${cap} tasks`, minutes: c.minutes });
  }
  return { keep, dropped };
}

/**
 * Do the configured hours match when the owner actually works? `hours`: [[HH:MM, HH:MM]], `hoursOfDay`: [0-23] of each
 * owner action. Speaks only with ≥ 20 actions and when under half fall inside the hours; proposes the hour ranges that
 * hold most of the activity (each hour with at least a third of the busiest hour's count, adjacent hours merged).
 */
export function hoursCheck({ hours, hoursOfDay, minEvents = 20 }) {
  if (hoursOfDay.length < minEvents) return null;
  const ranges = hours.map(([a, b]) => [toMin(a), toMin(b)]);
  const inside = hoursOfDay.filter((h) => ranges.some(([a, b]) => h * 60 >= a && h * 60 < b)).length;
  const share = inside / hoursOfDay.length;
  if (share >= 0.5) return null;
  const hist = Array(24).fill(0);
  for (const h of hoursOfDay) hist[h]++;
  const top = Math.max(...hist), busy = hist.map((n) => n >= Math.max(2, top / 3));
  const proposed = [];
  for (let h = 0; h < 24; h++) {
    if (!busy[h]) continue;
    let e = h; while (e + 1 < 24 && busy[e + 1]) e++;
    proposed.push([`${pad(h)}:00`, e + 1 === 24 ? "23:59" : `${pad(e + 1)}:00`]);
    h = e;
  }
  return {
    share, proposed,
    line: `- Hours check: ${Math.round((1 - share) * 100)}% of your last ${hoursOfDay.length} actions (site + typed Claude Code messages, 2 weeks) fell outside planner.hours ${JSON.stringify(hours)}. Your busy hours were ${proposed.map(([a, b]) => `${a}–${b}`).join(", ")}: consider \`"hours": ${JSON.stringify(proposed)}\` in jarvis.config.json.`,
  };
}

/** Live evidence for the 14 days before `weekStart`. Every source is optional: a failure just means less to say. */
export async function loadHistory({ weekStart, projects, log = () => {} }) {
  const from = addDays(weekStart, -HISTORY_DAYS), to = addDays(weekStart, -1);
  const since = new Date(from + "T00:00:00Z").toISOString(), until = new Date(weekStart + "T00:00:00Z");
  const [todos, stats, activity, sessions] = await Promise.all([
    api("GET", "/api/agent/todos" + qs({ from, to })).catch((e) => { log("adapt: todos unavailable", e.message); return []; }),
    api("GET", "/api/agent/stats" + qs({ bucket: "day", n: HISTORY_DAYS + 7, items: 1 })).catch((e) => { log("adapt: stats unavailable", e.message); return null; }),
    api("GET", "/api/agent/activity" + qs({ since })).catch((e) => { log("adapt: activity unavailable", e.message); return []; }),
    scan({ since, until }).then((r) => r).catch((e) => { log("adapt: transcripts unavailable", e.message); return null; }),
  ]);
  const itemsDone = (stats?.days || []).filter((d) => d.date >= from && d.date <= to).flatMap((d) => d.items?.done || []);
  const minutes = {};
  if (sessions) for (const p of projects) if (p.dir) minutes[p.id] = statsForDir(sessions.sessions, p.dir).activeMinutes;
  const actions = [
    ...(activity || []).filter((a) => !MACHINE.has(a.kind) && a.at && a.at < until.toISOString()).map((a) => a.at),
    ...(sessions?.turns || []).map((t) => t.timestamp),
  ];
  return { todos, itemsDone, minutes, hoursOfDay: actions.map(hourOf) };
}
