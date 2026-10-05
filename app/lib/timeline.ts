import * as D from "./data";
import { getPlan, type Block } from "./plan";
import { getEvents, calendarConfigured } from "./calendar";
import { addDays, mondayOf, today } from "./time";
import { parseShift } from "./timelineRange";

/** One item on the timeline (open work only: done and cancelled are closed). */
export type TItem = { project_id: string; id: string; title: string; critical: boolean; late: boolean; status: string };
/** Open items due on one day, clustered. */
export type TDay = { date: string; items: TItem[] };
export type TMilestone = { date: string; label: string; project_id: string; name: string; color: string; openBefore: number; criticalBefore: number; lateBefore: number;
  prd: string | null; // moved on the Timeline: the date PRD.md still has until the Mac worker writes the new one in
};
/** Sunday-plan blocks on one day: the "sprint" a lane is in this week and next. */
export type TPlanDay = { date: string; minutes: number; blocks: { title: string; start: string; end: string }[] };
export type TLane = {
  key: string; label: string; sub: string; href: string | null; color: string;
  milestones: TMilestone[]; days: TDay[]; plan: TPlanDay[];
  before: TItem[]; // open items due before the visible range (overdue)
  later: number; // open items due after it
};
export type TCal = { date: string; events: { title: string; time: string | null; allDay: boolean }[] };
export type TimelineData = {
  from: string; to: string; today: string; lanes: TLane[]; guides: TMilestone[];
  shift: number; // weeks the window is moved from the default (?w=)
  calendar: TCal[] | null; calendarError: string | null; upcoming: TMilestone[]; undated: { id: string; name: string }[];
};

const mins = (a: string, b: string) => (+b.slice(0, 2) * 60 + +b.slice(3)) - (+a.slice(0, 2) * 60 + +a.slice(3));
const WEEKS_BEFORE = 1, WEEKS_AFTER = 8;


function byDay(list: TItem[], due: (i: TItem) => string): TDay[] {
  const m = new Map<string, TItem[]>();
  for (const i of list) { const d = due(i); m.set(d, [...(m.get(d) || []), i]); }
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, items]) => ({ date, items: items.sort((a, b) => Number(b.late) - Number(a.late) || Number(b.critical) - Number(a.critical)) }));
}
function planDays(blocks: Block[]): TPlanDay[] {
  const m = new Map<string, TPlanDay>();
  for (const b of blocks) {
    const d = m.get(b.date) || { date: b.date, minutes: 0, blocks: [] };
    d.minutes += Math.max(0, mins(b.start, b.end)); d.blocks.push({ title: b.title, start: b.start, end: b.end });
    m.set(b.date, d);
  }
  return [...m.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Timeline from data that already exists: PRD milestones (project deadlines), checklist due dates,
 * the Sunday-plan blocks of every planned week in range, and (overview only) calendar events.
 * Overview: one lane per project with something dated. Project: one lane per checklist section.
 * `shift` moves the window by whole weeks (last week → 8 weeks out by default), clamped to SHIFT_MIN…SHIFT_MAX.
 */
export async function timelineData(opts: { project?: string; shift?: number } = {}): Promise<TimelineData> {
  const t = today(), shift = parseShift(opts.shift ?? 0);
  const base = addDays(mondayOf(t), 7 * shift);
  const from = addDays(base, -7 * WEEKS_BEFORE), to = addDays(base, 7 * WEEKS_AFTER + 6);
  const weeks = Array.from({ length: WEEKS_BEFORE + WEEKS_AFTER + 1 }, (_, i) => addDays(from, 7 * i));
  const [projects, items, plans, cal] = await Promise.all([
    D.getProjects(), D.getItems({ project: opts.project, open: true }), Promise.all(weeks.map((w) => getPlan(w).catch(() => null))),
    opts.project ? Promise.resolve(null) : getEvents(from, to),
  ]);
  const topIds = new Set(D.splitFeatured(projects).featured.map((p) => p.id));
  const color = (p: D.Project) => (opts.project ? p.color : D.displayColor(p, topIds));
  const blocks = plans.flatMap((p) => p?.blocks || []).filter((b) => b.date >= from && b.date <= to);
  const toT = (i: D.Item): TItem => ({ project_id: i.project_id, id: i.id, title: i.title, critical: i.critical, late: !!i.due && i.due < t, status: i.status });
  const dated = items.filter((i) => i.due);

  const scope = opts.project ? projects.filter((p) => p.id === opts.project) : projects;
  const milestonesOf = (p: D.Project): TMilestone[] => (p.deadlines || []).filter((d) => d && /^\d{4}-\d{2}-\d{2}$/.test(d.date)).map((d) => {
    const before = dated.filter((i) => i.project_id === p.id && i.due! <= d.date);
    return { date: d.date, label: d.label, project_id: p.id, name: p.name, color: color(p), openBefore: before.length, criticalBefore: before.filter((i) => i.critical).length, lateBefore: before.filter((i) => i.due! < t).length, prd: (d as { prd?: string }).prd || null };
  }).sort((a, b) => a.date.localeCompare(b.date));
  const allMilestones = scope.flatMap(milestonesOf).sort((a, b) => a.date.localeCompare(b.date));
  const inRange = (d: string) => d >= from && d <= to;

  const lane = (key: string, label: string, sub: string, href: string | null, c: string, its: D.Item[], ms: TMilestone[], bl: Block[]): TLane => {
    const ti = its.filter((i) => i.due).map(toT);
    const due = new Map(its.map((i) => [i.id, i.due!]));
    return {
      key, label, sub, href, color: c, milestones: ms.filter((m) => inRange(m.date)),
      days: byDay(ti.filter((i) => inRange(due.get(i.id)!)), (i) => due.get(i.id)!),
      plan: planDays(bl), before: ti.filter((i) => due.get(i.id)! < from), later: ti.filter((i) => due.get(i.id)! > to).length,
    };
  };

  let lanes: TLane[];
  if (opts.project) {
    const p = scope[0];
    const secs = p ? [...p.sections] : [];
    const known = new Set(secs.map((s) => s.id));
    const orphan = [...new Set(items.map((i) => i.section).filter((s) => !known.has(s)))];
    const secOf = new Map(items.map((i) => [i.id, i.section]));
    const firstSec = secs[0]?.id || orphan[0];
    lanes = [...secs.map((s) => ({ id: s.id, name: s.name })), ...orphan.map((s) => ({ id: s, name: s }))].map((s) => {
      const its = items.filter((i) => i.section === s.id);
      const bl = blocks.filter((b) => b.project_id === p.id && (secOf.get(b.item_id) || firstSec) === s.id);
      return lane(s.id, s.name, `${its.length} open · ${its.filter((i) => !i.due).length} undated`, null, p.color, its, [], bl);
    }).filter((l) => l.days.length || l.plan.length || l.before.length || l.later);
    const ms = allMilestones.filter((m) => inRange(m.date));
    if (p && ms.length) lanes.unshift(lane("_milestones", "Milestones", "From PRD.md", null, p.color, [], ms, []));
  } else {
    const ordered = [...scope].sort((a, b) => Number(topIds.has(b.id)) - Number(topIds.has(a.id)));
    lanes = ordered.map((p) => {
      const its = items.filter((i) => i.project_id === p.id);
      return lane(p.id, p.name, `${its.length} open${p.state ? ` · ${p.state}` : ""}`, `/p/${p.id}?v=timeline`, color(p), its, milestonesOf(p), blocks.filter((b) => b.project_id === p.id));
    }).filter((l) => l.days.length || l.milestones.length || l.plan.length || l.before.length);
  }
  const shown = new Set(lanes.map((l) => l.key));
  const undated = opts.project ? [] : scope.filter((p) => !shown.has(p.id)).map((p) => ({ id: p.id, name: p.name }));

  const calendar: TCal[] | null = cal && calendarConfigured() ? (() => {
    const m = new Map<string, TCal>();
    for (const e of cal.events) {
      const d = m.get(e.date) || { date: e.date, events: [] };
      d.events.push({ title: e.title, time: e.startTime, allDay: e.allDay }); m.set(e.date, d);
    }
    return [...m.values()];
  })() : null;

  return {
    from, to, today: t, shift, lanes, guides: opts.project ? allMilestones.filter((m) => inRange(m.date)) : [],
    calendar, calendarError: cal?.error || null,
    upcoming: allMilestones.filter((m) => m.date >= addDays(t, -7)).slice(0, 12), undated,
  };
}
