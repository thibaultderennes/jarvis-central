// What Today lists: checklist items, not work todos. Pure (no imports) so `npm test` can load it.
//
// On a day's list, an item (not cancelled) shows when it is
//   due      due that day;
//   doing    in progress, you or both own it (Today only: Claude's in-progress items are builds, not your work);
//   carried  overdue and carried in by this morning's roll-forward (kv rollover.today, that date only);
//   planned  linked to a todo dated that day (work todos from before items replaced them show as their item);
//   done     finished that day (it leaves the open list but still counts in "N of M done").
// Personal todos (no linked item) stay todos. Overdue items not carried wait in Later → Overdue.

export type TodayWhy = "carried" | "due" | "doing" | "planned" | "done";
type Base = { project_id: string; id: string; due: string | null; status: string; critical: boolean; owner: string | null; estimate_minutes: number | null };
type TodoRef = { id: string; date: string | null; project_id: string | null; item_id: string | null; sort: number; done: boolean };
export type TodayRow<T> = { item: T; why: TodayWhy; late: boolean; todo: string | null };

export const DEFAULT_EST = 60; // minutes for an item without an estimate
const k = (x: { project_id: string; id: string }) => `${x.project_id}/${x.id}`;
const tk = (t: TodoRef) => `${t.project_id}/${t.item_id}`;

/**
 * The day's work rows, open first in the order to do them (critical, then most late, then due, in progress, planned),
 * then the ones finished that day. `doneOn` gives the local YYYY-MM-DD an item was finished, or null.
 */
export function todayWork<T extends Base>({ day, today, items, todos, carried = [], doneOn }: {
  day: string; today: string; items: T[]; todos: TodoRef[]; carried?: string[]; doneOn: (i: T) => string | null;
}): { open: TodayRow<T>[]; done: TodayRow<T>[] } {
  const byKey = new Map(items.filter((i) => i.status !== "cancelled").map((i) => [k(i), i]));
  const rows = new Map<string, TodayRow<T>>();
  const put = (i: T | undefined, why: TodayWhy, todo: string | null = null) => {
    if (!i || rows.has(k(i))) return;
    rows.set(k(i), { item: i, why: i.status === "done" ? "done" : why, late: !!i.due && i.due < day, todo });
  };
  // A carried item given a new due date since ("→") is no longer carried.
  for (const key of carried) { const i = byKey.get(key); if (i && (i.status === "done" || (i.due && i.due < day))) put(i, "carried"); }
  for (const i of byKey.values()) if (i.due === day) put(i, "due");
  if (day === today) for (const i of byKey.values()) if (i.status === "doing" && i.owner !== "claude") put(i, "doing");
  for (const t of [...todos].sort((a, b) => a.sort - b.sort)) if (t.date === day && t.project_id && t.item_id) put(byKey.get(tk(t)), "planned", t.id);
  for (const i of byKey.values()) if (i.status === "done" && doneOn(i) === day) put(i, "done");

  const rank: Record<TodayWhy, number> = { carried: 0, due: 1, doing: 2, planned: 3, done: 4 };
  const all = [...rows.values()];
  const open = all.filter((r) => r.why !== "done").sort((a, b) =>
    Number(b.item.critical) - Number(a.item.critical) || Number(b.late) - Number(a.late)
    || (a.late && b.late ? a.item.due!.localeCompare(b.item.due!) : 0) || rank[a.why] - rank[b.why]);
  return { open, done: all.filter((r) => r.why === "done") };
}

/** Minutes of open work on the list (each item's estimate, DEFAULT_EST when unknown). */
export const workLoad = (rows: { item: Base }[]) => rows.reduce((s, r) => s + (r.item.estimate_minutes || DEFAULT_EST), 0);

/** Todos that stay todos on Today: everything not linked to a checklist item. */
export const isPersonal = (t: { project_id: string | null; item_id: string | null }) => !(t.project_id && t.item_id);
