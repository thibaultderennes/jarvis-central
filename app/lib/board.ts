import * as D from "./data";
import { getEvents, calendarConfigured } from "./calendar";
import { addDays, timeInTZ, today } from "./time";
import type { BItem } from "@/components/Board";

/** Focus capacity per day, in minutes (the planner's `max_focus_minutes_per_day`, set as JARVIS_FOCUS_MINUTES on the site). */
export const CAP_MINUTES = Math.max(60, Number(process.env.JARVIS_FOCUS_MINUTES) || 360);

/** Everything the Today/Week board needs for a date range. */
export async function boardData(from: string, to: string) {
  const t = today();
  const [projects, items, allTodos, cal] = await Promise.all([
    D.getProjects(), D.getItems(), D.getTodos(from, to, true), getEvents(from, to),
  ]);
  // A paused project is out of Today and the Week board: its todos too, not only its items (getItems leaves those out).
  const paused = new Set(projects.filter((p) => p.paused_at).map((p) => p.id));
  const todos = allTodos.filter((x) => !x.project_id || !paused.has(x.project_id));
  const active = projects;
  const topIds = new Set(D.splitFeatured(projects).featured.map((p) => p.id));
  const secName = (pid: string, s: string) => active.find((p) => p.id === pid)?.sections.find((x) => x.id === s)?.name || s;
  const toB = (i: D.Item): BItem => ({ project_id: i.project_id, id: i.id, title: i.title, due: i.due, status: i.status, critical: i.critical, owner: i.owner, secName: secName(i.project_id, i.section), estimate_minutes: i.estimate_minutes });
  const horizon = addDays(t, 14);
  // Backlog: open work (cancelled and done are closed) due within two weeks, overdue included, or already in progress.
  const backlog = items.filter((i) => D.isOpen(i) && ((i.due && i.due <= horizon) || i.status === "doing"))
    .sort((a, b) => (a.due || "9").localeCompare(b.due || "9") || Number(b.critical) - Number(a.critical)).map(toB);
  // Due in the range: done ones stay (struck through), cancelled ones disappear.
  const due = items.filter((i) => i.status !== "cancelled" && i.due && i.due >= from && i.due <= to).map(toB);
  return {
    today: t, nowTime: timeInTZ(new Date()), todos, backlog, due, capMinutes: CAP_MINUTES,
    events: cal.events, calendarOn: calendarConfigured(), calendarError: cal.error,
    projects: projects.map((p) => ({ id: p.id, name: p.name, color: D.displayColor(p, topIds) })),
  };
}
