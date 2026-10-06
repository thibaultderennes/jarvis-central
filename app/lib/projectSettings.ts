// Project Settings (the project page's Settings view): review schedule and build mode. Pure, so `npm test` loads it.
// The agent has its own copy of the rules in agent/projectsettings.mjs (the site and the Mac agent don't share code).

export type BuildMode = "goibniu" | "lugh";
/** Both modes are Jarvis running the build; Lugh also loads engineering skills (agent/lugh.mjs). */
export const BUILD_MODES: { id: BuildMode; name: string; what: string }[] = [
  { id: "goibniu", name: "Jarvis (Goibniu)", what: "The smith who forges fast. Builds quick and direct, with no extra skills." },
  { id: "lugh", name: "Jarvis (Lugh)", what: "Skilled in all the arts. Adds skills for tests, code review and docs: slower, uses more tokens." },
];
export const isBuildMode = (v: unknown): v is BuildMode => v === "goibniu" || v === "lugh";

/** The mode a build of this project runs in: its own setting, else the worker's default, else Goibniu. */
export function effectiveBuildMode(own: unknown, workerDefault: unknown): BuildMode {
  return isBuildMode(own) ? own : isBuildMode(workerDefault) ? workerDefault : "goibniu";
}

/** Days between reviews, as typed: a whole number 1–90, or null when it isn't one. */
export function normEvery(v: unknown): number | null {
  const n = typeof v === "string" ? (v.trim() === "" ? NaN : Number(v)) : Number(v);
  if (!Number.isFinite(n) || n !== Math.round(n) || n < 1 || n > 90) return null;
  return n;
}
/** The stored value, with the default (7, the Monday run) for a row from before the setting existed. */
export const reviewEvery = (v: unknown) => normEvery(v) ?? 7;

const addDays = (ymd: string, n: number) => new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10) + n)).toISOString().slice(0, 10);

/**
 * The day the next review is due, for the Settings view: `every` days after the last one, or today when none has run
 * or it is overdue (the worker checks hourly). Null for every 7 days: the weekly run reviews those on its own day
 * (reviews.run in the agent's config), which the site only knows as a phrase.
 */
export function nextReview({ every, last, today }: { every: number; last: string | null; today: string }): string | null {
  if (every === 7) return null;
  const due = last ? addDays(last, every) : today;
  return due < today ? today : due;
}
