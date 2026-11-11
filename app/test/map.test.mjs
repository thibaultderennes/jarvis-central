// The project map (lib/map.ts): region stats, size, fog and the "ground taken" rule.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRegions, nextStop, sizeOf, totals, trailFor, trailPoints, FOG_DAYS, WINDOW_DAYS } from "../lib/map.ts";

const T = "2026-10-07";
let n = 0;
const it = (o = {}) => ({ project_id: "app", id: `i${++n}`, title: `Item ${n}`, status: "todo", due: null, done_on: null, ...o });
const proj = (o = {}) => ({ id: "app", name: "App", color: "p1", deadlines: [{ date: "2026-10-20", label: "Beta" }], ...o });

test("trail: only items due in the window count; on time takes ground, late and lapsed don't", () => {
  const items = [
    it({ status: "done", due: "2026-10-05", done_on: "2026-10-04" }), // on time
    it({ status: "done", due: "2026-10-05", done_on: "2026-10-06" }), // finished late
    it({ status: "todo", due: "2026-10-06" }),                          // open past its date: late
    it({ status: "todo", due: "2026-10-15" }),                          // open, ahead
    it({ status: "done", due: null, done_on: "2026-10-06" }),           // undated: ignored
    it({ status: "cancelled", due: "2026-10-10" }),                     // cancelled: ignored
    it({ status: "todo", due: "2026-10-25" }),                          // after the deadline: ignored
  ];
  const t = trailFor([{ date: "2026-10-20", label: "Beta" }], items, T);
  assert.equal(t.total, 4);
  assert.deepEqual([t.onTime, t.late, t.open], [1, 2, 1]);
  assert.equal(t.pct, 25);
  assert.equal(t.passed, 3);
  assert.equal(t.daysLeft, 13);
  assert.deepEqual(t.steps.map((s) => s.state), ["on-time", "late", "late", "open"]);
});

test("trail: the window opens at the previous deadline, or WINDOW_DAYS back", () => {
  const old = it({ status: "done", due: "2026-09-20", done_on: "2026-09-19" });
  const recent = it({ status: "done", due: "2026-10-02", done_on: "2026-10-01" });
  const withPrev = trailFor([{ date: "2026-09-30", label: "Alpha" }, { date: "2026-10-20", label: "Beta" }], [old, recent], T);
  assert.equal(withPrev.from, "2026-09-30");
  assert.equal(withPrev.total, 1);
  const noPrev = trailFor([{ date: "2026-10-20", label: "Beta" }], [old, recent], T);
  assert.equal(WINDOW_DAYS, 30);
  assert.equal(noPrev.from, "2026-09-07");
  assert.equal(noPrev.total, 2);
});

test("trail: no deadline ahead means no trail; a deadline today still counts", () => {
  assert.equal(trailFor([{ date: "2026-10-01", label: "Past" }], [], T), null);
  assert.equal(trailFor([], [], T), null);
  const t = trailFor([{ date: T, label: "Today" }], [it({ due: T })], T);
  assert.equal(t.daysLeft, 0);
  assert.equal(t.steps[0].state, "open");
  assert.equal(t.pct, 0);
  assert.equal(trailFor([{ date: "2026-10-20", label: "Beta" }], [], T).pct, null);
});

test("ticking undated items never moves the trail", () => {
  const base = [it({ due: "2026-10-12" })];
  const busy = [...base, ...Array.from({ length: 20 }, () => it({ status: "done", due: null, done_on: T }))];
  assert.deepEqual(trailFor(proj().deadlines, base, T), trailFor(proj().deadlines, busy, T));
});

test("regions: counts, latest review, fog after FOG_DAYS without a finished item", () => {
  const items = [
    it({ due: "2026-10-01" }), it({ due: "2026-10-10" }), it({}),
    it({ status: "done", due: "2026-09-30", done_on: "2026-09-20" }),
    it({ project_id: "quiet", status: "done", done_on: "2026-09-01" }), it({ project_id: "quiet" }),
  ];
  const reviews = [
    { project_id: "app", verdict: "at-risk", headline: "old", week_start: "2026-09-28", created_at: "2026-09-28T08:00:00Z" },
    { project_id: "app", verdict: "on-track", headline: "new", week_start: "2026-10-05", created_at: "2026-10-05T08:00:00Z" },
  ];
  const [a, q, none] = buildRegions([proj(), proj({ id: "quiet", name: "Quiet", deadlines: [] }), proj({ id: "none", name: "None", deadlines: [] })], items, reviews, T);
  assert.deepEqual([a.open, a.overdue, a.dueSoon, a.done28, a.onTime28], [3, 1, 1, 1, 1]);
  assert.deepEqual(a.review, { verdict: "on-track", headline: "new" });
  assert.equal(a.quietDays, 17);
  assert.ok(a.quietDays >= FOG_DAYS && a.fog);
  assert.equal(a.href, "/p/app");
  assert.equal(q.quietDays, 36);
  assert.equal(q.trail, null);
  assert.equal(none.quietDays, null);
  assert.ok(none.fog);
  const fresh = buildRegions([proj()], [it({ status: "done", done_on: "2026-10-06" })], [], T)[0];
  assert.equal(fresh.fog, false);
});

test("size follows open items with floors", () => {
  assert.equal(sizeOf(0, 0), "s");
  assert.equal(sizeOf(2, 2), "s");
  assert.equal(sizeOf(3, 4), "m");
  assert.equal(sizeOf(8, 8), "l");
  assert.equal(sizeOf(10, 40), "m");
  assert.equal(sizeOf(24, 40), "l");
  assert.equal(sizeOf(9, 40), "s");
});

test("next stop and totals", () => {
  const rs = buildRegions(
    [proj({ id: "a", deadlines: [{ date: "2026-10-30", label: "X" }] }), proj({ id: "b", deadlines: [{ date: "2026-10-09", label: "Y" }] }), proj({ id: "c", deadlines: [] })],
    [it({ project_id: "b", due: "2026-10-08" }), it({ project_id: "a", status: "done", due: "2026-10-05", done_on: "2026-10-05" }), it({ project_id: "a", due: "2026-10-01" })],
    [], T);
  assert.equal(nextStop(rs), "b");
  assert.equal(nextStop([]), null);
  const s = totals(rs);
  assert.deepEqual([s.regions, s.open, s.overdue, s.onTime, s.steps, s.pct], [3, 2, 1, 1, 3, 33]);
});

test("trail points stay inside the box and are deterministic", () => {
  const p = trailPoints(7, 320, 44, 10);
  assert.equal(p.length, 7);
  assert.equal(p[0].x, 10);
  assert.equal(p[6].x, 310);
  assert.ok(p.every((q) => q.y >= 10 && q.y <= 34));
  assert.deepEqual(p, trailPoints(7, 320, 44, 10));
  assert.deepEqual(trailPoints(0, 320, 44), []);
  assert.deepEqual(trailPoints(1, 320, 44, 10), [{ x: 160, y: 22 }]);
});
