// The daily roll-forward's leftovers (agent/rollover.mjs writes kv `rollover.today` each work-day morning).
// Pure helpers (no imports) so `npm test` can load them.

export type WaitingTask = { title: string; key: string | null; critical: boolean; overdue: number; reason: string };
export type RolloverDay = { date: string; workday?: boolean; carried?: number; load?: { before: number; after: number; cap: number }; waiting?: WaitingTask[] };
export type Waiting = { count: number; full: boolean; load: { before: number; after: number; cap: number } | null; tasks: WaitingTask[] };

/**
 * What this morning's roll-forward couldn't fit on `day`, most important first; null when nothing waits or it's another
 * day. The list is a morning snapshot, so `openKeys` (the `project/id` of every open item in an active project, read
 * now) drops what was closed, cancelled or paused since; one row per item even when several of its todos waited.
 */
export function waitingFor(v: RolloverDay | null | undefined, day: string, openKeys?: Set<string>): Waiting | null {
  if (!v || v.date !== day || !Array.isArray(v.waiting) || !v.waiting.length) return null;
  const seen = new Set<string>();
  const tasks = [...v.waiting].sort((a, b) => Number(b.critical) - Number(a.critical) || (b.overdue || 0) - (a.overdue || 0))
    .filter((t) => !t.key || ((!openKeys || openKeys.has(t.key)) && !seen.has(t.key) && !!seen.add(t.key)));
  if (!tasks.length) return null;
  return { count: tasks.length, full: tasks.some((t) => /^no room today/.test(t.reason)), load: v.load || null, tasks };
}

/** "3 days late", "due today". */
export const lateLabel = (n: number) => (n <= 0 ? "due today" : n === 1 ? "1 day late" : `${n} days late`);
