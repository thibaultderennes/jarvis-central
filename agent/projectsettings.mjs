// Per-project settings the agent reads from the site (projects.review_every_days, projects.build_mode): pure helpers,
// no imports, so `npm test` in app/ can load them (app/test/projectsettings.test.mjs).

/** Build modes: both are Jarvis running the build; Lugh also loads the agent-skills pack (agent/lugh.mjs). */
export const BUILD_MODES = {
  goibniu: { label: "Jarvis (Goibniu)", short: "quick and direct, no extra skills" },
  lugh: { label: "Jarvis (Lugh)", short: "with the agent-skills pack: tests, review, docs" },
};

/** The project's build mode: its own setting, else the config default (worker.build_mode), else Goibniu. */
export function buildModeFor(project, configDefault) {
  if (project && BUILD_MODES[project.build_mode]) return project.build_mode;
  return BUILD_MODES[configDefault] ? configDefault : "goibniu";
}

/** Days between two advisor reviews of a project: 1–90, default 7 (the Monday run). */
export function reviewEvery(project) {
  const n = Math.round(Number(project?.review_every_days));
  return Number.isFinite(n) && n >= 1 && n <= 90 ? n : 7;
}

/** Whole days from a to b (YYYY-MM-DD). */
export function daysFrom(a, b) {
  const t = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  return Math.round((t(b) - t(a)) / 864e5);
}

/**
 * Projects whose advisor review is due today outside the Monday run: reviews on, a cadence other than 7 days, no
 * review queued already, and the last review (or the last attempt, so a failing review doesn't retry every hour)
 * at least `every` days ago. `last` and `tried`: {project id: YYYY-MM-DD}.
 */
export function reviewsDue(projects, { last = {}, tried = {}, today, busy = new Set() }) {
  return projects.filter((p) => {
    if (p.archived || p.reviews_enabled === false || busy.has(p.id)) return false;
    const every = reviewEvery(p);
    if (every === 7) return false; // the Monday run (weekly.mjs) reviews these
    const since = [last[p.id], tried[p.id]].filter(Boolean).sort().pop();
    return !since || daysFrom(since, today) >= every;
  });
}

/** The window a review of `days` days covers, ending today: { startDate, lastDate }. */
export function reviewWindow(today, days) {
  const add = (ymd, n) => new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10) + n)).toISOString().slice(0, 10);
  return { startDate: add(today, -(days - 1)), lastDate: today };
}
