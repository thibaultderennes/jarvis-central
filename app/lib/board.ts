import * as D from "./data";
import { getEvents, calendarConfigured } from "./calendar";
import { addDays, timeInTZ, today } from "./time";
import type { BItem } from "@/components/Board";

/** Everything the Today/Week board needs for a date range. */
export async function boardData(from: string, to: string) {
  const t = today();
  const [projects, items, todos, cal] = await Promise.all([
    D.getProjects(), D.getItems(), D.getTodos(from, to, true), getEvents(from, to),
  ]);
  const active = projects;
  const topIds = new Set(D.splitFeatured(projects).featured.map((p) => p.id));
  const secName = (pid: string, s: string) => active.find((p) => p.id === pid)?.sections.find((x) => x.id === s)?.name || s;
  const toB = (i: D.Item): BItem => ({ project_id: i.project_id, id: i.id, title: i.title, due: i.due, status: i.status, critical: i.critical, owner: i.owner, secName: secName(i.project_id, i.section) });
  const horizon = addDays(t, 14);
  const backlog = items.filter((i) => i.status !== "done" && ((i.due && i.due <= horizon) || i.status === "doing"))
    .sort((a, b) => (a.due || "9").localeCompare(b.due || "9") || Number(b.critical) - Number(a.critical)).map(toB);
  const due = items.filter((i) => i.due && i.due >= from && i.due <= to).map(toB);
  return {
    today: t, nowTime: timeInTZ(new Date()), todos, backlog, due,
    events: cal.events, calendarOn: calendarConfigured(), calendarError: cal.error,
    projects: projects.map((p) => ({ id: p.id, name: p.name, color: D.displayColor(p, topIds) })),
  };
}
