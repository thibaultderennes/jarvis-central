import { sql } from "./db";
import { addDays, isDate, zonedToUtc } from "./time";

export type Block = { uid?: string; project_id: string; item_id: string; title: string; date: string; start: string; end: string };
export type WeekPlan = { week_start: string; blocks: Block[]; unscheduled: { project_id: string; item_id: string; title: string; reason: string }[]; notes_md: string; version: number; updated_at: string; synced_version: number | null; synced_at: string | null; synced_count: number | null; force_resync?: boolean };

const d10 = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const ts = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));
const norm = (r: Record<string, unknown>) => ({ ...r, week_start: d10(r.week_start), updated_at: ts(r.updated_at), synced_at: ts(r.synced_at) }) as WeekPlan;

export async function getPlan(week: string): Promise<WeekPlan | null> {
  const rows = await sql()`select * from week_plans where week_start = ${week}`;
  return rows[0] ? norm(rows[0]) : null;
}

const hhmm = (s: unknown) => typeof s === "string" && /^\d{2}:\d{2}$/.test(s);
/** Save a week's plan and replace that week's planner-made todos (done ones are kept). */
export async function savePlan(p: { week_start: string; blocks: Block[]; unscheduled?: WeekPlan["unscheduled"]; notes_md?: string; force?: boolean }): Promise<WeekPlan> {
  const end = addDays(p.week_start, 6);
  const blocks = (p.blocks || []).filter((b) => isDate(b.date) && b.date >= p.week_start && b.date <= end && hhmm(b.start) && hhmm(b.end) && b.title)
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))
    .map((b, i) => ({ ...b, uid: `jarvis-${p.week_start}-${i}` }));
  const rows = await sql()`insert into week_plans (week_start, blocks, unscheduled, notes_md, force_resync)
    values (${p.week_start}, ${JSON.stringify(blocks)}, ${JSON.stringify(p.unscheduled || [])}, ${p.notes_md || ""}, ${!!p.force})
    on conflict (week_start) do update set blocks = excluded.blocks, unscheduled = excluded.unscheduled, notes_md = excluded.notes_md,
      force_resync = excluded.force_resync, version = week_plans.version + 1, updated_at = now()
    returning *`;
  await sql()`delete from todos where source = 'plan' and not done and date between ${p.week_start} and ${end}`;
  let sort = 1;
  for (const b of blocks) {
    await sql()`insert into todos (date, title, kind, project_id, item_id, time, sort, source)
      values (${b.date}, ${b.title}, 'work', ${b.project_id || null}, ${b.item_id || null}, ${b.start}, ${sort++}, 'plan')`;
  }
  return norm(rows[0]);
}

/** Plan as calendar events with real instants, for the Apps Script. */
export function planEvents(plan: WeekPlan, siteUrl: string, colors: Record<string, string>) {
  return plan.blocks.map((b) => ({
    uid: b.uid, title: b.title,
    start: zonedToUtc(b.date, b.start).toISOString(), end: zonedToUtc(b.date, b.end).toISOString(),
    color: colors[b.project_id] || "other",
    description: `${b.project_id} · ${b.item_id}\nPlanned by Jarvis on Sunday. Checklist: ${siteUrl}/p/${b.project_id}`,
  }));
}
