// The daily roll-forward's leftovers (agent/rollover.mjs writes kv `rollover.today` each work-day morning).
// Pure helpers (no imports) so `npm test` can load them.

export type WaitingTask = { title: string; key: string | null; critical: boolean; overdue: number; reason: string };
export type RolloverDay = { date: string; workday?: boolean; carried?: number; load?: { before: number; after: number; cap: number }; waiting?: WaitingTask[] };
export type Waiting = { count: number; full: boolean; load: { before: number; after: number; cap: number } | null; tasks: WaitingTask[] };

/** What this morning's roll-forward couldn't fit on `day`, most important first; null when nothing waits or it's another day. */
export function waitingFor(v: RolloverDay | null | undefined, day: string): Waiting | null {
  if (!v || v.date !== day || !Array.isArray(v.waiting) || !v.waiting.length) return null;
  const tasks = [...v.waiting].sort((a, b) => Number(b.critical) - Number(a.critical) || (b.overdue || 0) - (a.overdue || 0));
  return { count: tasks.length, full: tasks.some((t) => /^no room today/.test(t.reason)), load: v.load || null, tasks };
}

/** "3 days late", "due today". */
export const lateLabel = (n: number) => (n <= 0 ? "due today" : n === 1 ? "1 day late" : `${n} days late`);
