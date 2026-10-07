// The project map (/map): one region per active project, sized by workload, fogged when neglected, with a trail
// toward the next deadline. Pure functions (no imports) so `npm test` can load them; the page feeds them rows.
//
// The one game rule, "ground taken": a region's trail holds the items due inside the current milestone window,
// from the previous deadline (or WINDOW_DAYS before today when there is none) up to and including the next deadline.
// Only an item finished on or before its due date takes ground. An item finished late, or still open past its due
// date, is a lost step: it stays in the count, so that milestone can no longer reach 100%. Items with no due date,
// cancelled items and items due outside the window don't count at all, so ticking off undated busywork moves nothing.

export type MapItem = {
  id: string; title: string; status: string; due: string | null;
  /** The day it was finished (YYYY-MM-DD in the owner's timezone), or null. */
  done_on: string | null;
};
export type MapProject = { id: string; name: string; color: string; deadlines: { date: string; label: string }[] };
export type MapReview = { project_id: string | null; verdict: string | null; headline: string; week_start: string | null; created_at: string };

export type StepState = "on-time" | "late" | "open";
export type Step = { id: string; title: string; due: string; state: StepState };
export type Trail = {
  /** Exclusive start of the window: the previous deadline, or WINDOW_DAYS before today. */
  from: string; deadline: { date: string; label: string }; daysLeft: number;
  steps: Step[]; onTime: number; late: number; open: number; total: number;
  /** 0–100, on-time share of the window's items; null when no item is due in the window. */
  pct: number | null;
  /** Steps due before today: the "you are here" marker sits after them. */
  passed: number;
};
export type Size = "s" | "m" | "l";
export type Region = {
  id: string; name: string; color: string; href: string;
  open: number; overdue: number; dueSoon: number; done28: number; onTime28: number;
  next: { date: string; label: string; daysLeft: number } | null;
  review: { verdict: string | null; headline: string } | null;
  lastDone: string | null; quietDays: number | null; fog: boolean; size: Size;
  trail: Trail | null;
};

export const FOG_DAYS = 14;
export const WINDOW_DAYS = 30;
export const SOON_DAYS = 7;

const DAY = 86_400_000;
const ms = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
export const daysFrom = (a: string, b: string) => Math.round((ms(b) - ms(a)) / DAY);
export const shift = (d: string, n: number) => new Date(ms(d) + n * DAY).toISOString().slice(0, 10);
const isOpen = (i: { status: string }) => i.status === "todo" || i.status === "doing";

/** The milestone trail for one project, or null when it has no deadline from today on. */
export function trailFor(deadlines: MapProject["deadlines"], items: MapItem[], today: string): Trail | null {
  const ds = [...(deadlines || [])].filter((d) => d && /^\d{4}-\d{2}-\d{2}$/.test(d.date)).sort((a, b) => a.date.localeCompare(b.date));
  const deadline = ds.find((d) => d.date >= today);
  if (!deadline) return null;
  const prev = ds.filter((d) => d.date < today).pop();
  const from = prev ? prev.date : shift(today, -WINDOW_DAYS);
  const steps: Step[] = items
    .filter((i) => i.status !== "cancelled" && i.due && i.due > from && i.due <= deadline.date && (i.status === "done" || isOpen(i)))
    .map((i): Step => ({
      id: i.id, title: i.title, due: i.due!,
      state: i.status === "done" ? (i.done_on && i.done_on <= i.due! ? "on-time" : "late") : i.due! < today ? "late" : "open",
    }))
    .sort((a, b) => a.due.localeCompare(b.due) || a.id.localeCompare(b.id));
  const onTime = steps.filter((s) => s.state === "on-time").length, late = steps.filter((s) => s.state === "late").length;
  return {
    from, deadline, daysLeft: daysFrom(today, deadline.date), steps, onTime, late, open: steps.length - onTime - late, total: steps.length,
    pct: steps.length ? Math.round((onTime / steps.length) * 100) : null,
    passed: steps.filter((s) => s.due < today).length,
  };
}

/** Region size from workload: open items relative to the busiest project, with floors so small lists stay small. */
export function sizeOf(open: number, maxOpen: number): Size {
  if (open >= Math.max(8, 0.6 * maxOpen)) return "l";
  if (open >= Math.max(3, 0.25 * maxOpen)) return "m";
  return "s";
}

/** One region per project, in the order given. `color` is the display colour (top 3 keep their slot, others "other"). */
export function buildRegions(projects: MapProject[], items: (MapItem & { project_id: string })[], reviews: MapReview[], today: string): Region[] {
  const latest = new Map<string, MapReview>();
  for (const r of reviews) {
    if (!r.project_id) continue;
    const cur = latest.get(r.project_id);
    const key = (x: MapReview) => `${x.week_start || ""}|${x.created_at}`;
    if (!cur || key(r) > key(cur)) latest.set(r.project_id, r);
  }
  const rows = projects.map((p) => {
    const its = items.filter((i) => i.project_id === p.id);
    const open = its.filter(isOpen);
    const done = its.filter((i) => i.status === "done" && i.done_on);
    const recent = done.filter((i) => i.done_on! > shift(today, -28) && i.done_on! <= today);
    const lastDone = done.map((i) => i.done_on!).filter((d) => d <= today).sort().pop() || null;
    const quietDays = lastDone ? daysFrom(lastDone, today) : null;
    const trail = trailFor(p.deadlines, its, today);
    const nextD = trail ? trail.deadline : null;
    const rv = latest.get(p.id);
    return {
      id: p.id, name: p.name, color: p.color, href: `/p/${encodeURIComponent(p.id)}`,
      open: open.length,
      overdue: open.filter((i) => i.due && i.due < today).length,
      dueSoon: open.filter((i) => i.due && i.due >= today && i.due <= shift(today, SOON_DAYS)).length,
      done28: recent.length,
      onTime28: recent.filter((i) => i.due && i.done_on! <= i.due).length,
      next: nextD ? { ...nextD, daysLeft: daysFrom(today, nextD.date) } : null,
      review: rv ? { verdict: rv.verdict, headline: rv.headline } : null,
      lastDone, quietDays, fog: quietDays === null || quietDays >= FOG_DAYS, size: "s" as Size, trail,
    };
  });
  const maxOpen = Math.max(0, ...rows.map((r) => r.open));
  return rows.map((r) => ({ ...r, size: sizeOf(r.open, maxOpen) }));
}

/** The region whose next deadline comes first (ties: the one with more open steps on its trail). */
export function nextStop(regions: Region[]): string | null {
  const withD = regions.filter((r) => r.next).sort((a, b) => a.next!.date.localeCompare(b.next!.date) || (b.trail?.open || 0) - (a.trail?.open || 0));
  return withD[0]?.id || null;
}

/** Map-wide totals for the header. */
export function totals(regions: Region[]) {
  const t = regions.reduce((a, r) => ({ open: a.open + r.open, overdue: a.overdue + r.overdue, fog: a.fog + (r.fog ? 1 : 0), onTime: a.onTime + (r.trail?.onTime || 0), steps: a.steps + (r.trail?.total || 0) }), { open: 0, overdue: 0, fog: 0, onTime: 0, steps: 0 });
  return { ...t, regions: regions.length, pct: t.steps ? Math.round((t.onTime / t.steps) * 100) : null };
}

/** Evenly spaced points along a gentle wave, for drawing the trail: deterministic, no randomness. */
export function trailPoints(n: number, width: number, height: number, pad = 8): { x: number; y: number }[] {
  if (n <= 0) return [];
  const mid = height / 2, amp = Math.max(0, mid - pad);
  return Array.from({ length: n }, (_, i) => {
    const t = n === 1 ? 0.5 : i / (n - 1);
    return { x: Math.round((pad + t * (width - 2 * pad)) * 10) / 10, y: Math.round((mid + amp * Math.sin(t * Math.PI * 2)) * 10) / 10 };
  });
}
