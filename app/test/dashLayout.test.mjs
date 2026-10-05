// The dashboard layout (lib/dashLayout.ts): what the browser sends is cleaned before it is saved, and boxes never overlap.
import { test } from "node:test";
import assert from "node:assert/strict";
import { BOXES, defaultLayout, sanitizeLayout, sanitizeTab, settle } from "../lib/dashLayout.ts";

const overlap = (l) => l.some((a, i) => l.some((b, j) => i < j && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + (b.min ? 1 : b.h) && b.y < a.y + (a.min ? 1 : a.h)));

test("defaults: every box on its own tab, none overlapping", () => {
  const d = defaultLayout();
  for (const [tab, list] of Object.entries(d)) {
    for (const p of list) assert.equal(BOXES[p.id].tab, tab);
    assert.equal(overlap(list), false, `${tab} overlaps`);
  }
  assert.equal(Object.values(d).flat().length, Object.keys(BOXES).length);
});

test("sanitizeTab drops unknown, foreign and repeated boxes and clamps to the grid", () => {
  const l = sanitizeTab("overview", [
    { id: "needs", x: 11, y: -3, w: 99, h: 0 }, { id: "needs", x: 0, y: 0, w: 4, h: 4 }, { id: "timeline", x: 0, y: 0, w: 4, h: 4 },
    { id: "<script>", x: 0, y: 0, w: 4, h: 4 }, { id: "reviews", x: "3", y: "2", w: "5", h: "3", min: 1 },
  ]);
  assert.deepEqual(l, [{ id: "needs", w: 12, x: 0, y: 0, h: 1 }, { id: "reviews", w: 5, x: 3, y: 2, h: 3, min: true }]);
  assert.deepEqual(sanitizeTab("stats", "nope").map((p) => p.id), Object.keys(BOXES).filter((k) => BOXES[k].tab === "stats"));
});

test("sanitizeLayout fills missing tabs with their defaults and keeps an emptied tab empty", () => {
  const l = sanitizeLayout({ overview: [] });
  assert.deepEqual(l.overview, []);
  assert.deepEqual(l.timeline, defaultLayout().timeline);
  assert.deepEqual(sanitizeLayout(null), defaultLayout());
});

test("settle: a dropped box keeps its place, the ones under it move down, nothing overlaps", () => {
  const start = defaultLayout().overview;
  const dropped = start.map((p) => (p.id === "top3" ? { ...p, x: 0, y: 0 } : p));
  const out = settle(dropped, "top3");
  assert.equal(overlap(out), false);
  const top3 = out.find((p) => p.id === "top3");
  assert.deepEqual([top3.x, top3.y], [0, 0]);
  assert.ok(out.find((p) => p.id === "needs").y >= top3.h);
});

test("settle floats boxes up into the space a removed box leaves", () => {
  const out = settle(defaultLayout().overview.filter((p) => p.id !== "needs"), null);
  assert.equal(overlap(out), false);
  // top3 spans all 12 columns, so it rises only to just below reviews + sprints (rows 0–5 on columns 7–11)
  assert.equal(out.find((p) => p.id === "top3").y, 6);
  const narrow = settle([{ id: "reviews", x: 0, y: 9, w: 5, h: 3 }], null);
  assert.equal(narrow[0].y, 0, "a lone box floats to the top");
});
