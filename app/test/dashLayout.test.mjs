// The dashboard layout (lib/dashLayout.ts): Home is one page; what the browser sends is cleaned before it is saved,
// and boxes never overlap.
import { test } from "node:test";
import assert from "node:assert/strict";
import { BOXES, OLD_TAB_ANCHOR, SECTIONS, defaultLayout, sanitizeLayout, sanitizeTab, settle } from "../lib/dashLayout.ts";

const overlap = (l) => l.some((a, i) => l.some((b, j) => i < j && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + (b.min ? 1 : b.h) && b.y < a.y + (a.min ? 1 : a.h)));

test("defaults: one page with every box, top 3 first, none overlapping", () => {
  const d = defaultLayout().home;
  assert.equal(d.length, Object.keys(BOXES).length);
  assert.equal(overlap(d), false);
  const top3 = d.find((p) => p.id === "top3");
  assert.deepEqual([top3.x, top3.y], [0, 0]);
  assert.ok(d.every((p) => p.id === "top3" || p.y >= top3.h), "nothing above the top 3");
});

test("sections point at real boxes, and old tab links land on them", () => {
  for (const s of SECTIONS) assert.ok(BOXES[s.box], s.id);
  for (const a of Object.values(OLD_TAB_ANCHOR)) assert.ok(BOXES[a.replace("box-", "")], a);
});

test("sanitizeTab drops unknown and repeated boxes and clamps to the grid", () => {
  const l = sanitizeTab("home", [
    { id: "needs", x: 11, y: -3, w: 99, h: 0 }, { id: "needs", x: 0, y: 0, w: 4, h: 4 },
    { id: "<script>", x: 0, y: 0, w: 4, h: 4 }, { id: "reviews", x: "3", y: "2", w: "5", h: "3", min: 1 },
  ]);
  assert.deepEqual(l, [{ id: "needs", w: 12, x: 0, y: 0, h: 1 }, { id: "reviews", w: 5, x: 3, y: 2, h: 3, min: true }]);
  assert.deepEqual(sanitizeTab("home", "nope").map((p) => p.id), Object.keys(BOXES));
});

test("sanitizeLayout: an old per-tab layout gives the new default; an emptied page stays empty", () => {
  assert.deepEqual(sanitizeLayout({ overview: [{ id: "needs", x: 0, y: 0, w: 4, h: 4 }], stats: [] }), defaultLayout());
  assert.deepEqual(sanitizeLayout({ home: [] }).home, []);
  assert.deepEqual(sanitizeLayout(null), defaultLayout());
});

test("settle: a dropped box keeps its place, the ones under it move down, nothing overlaps", () => {
  const start = defaultLayout().home;
  const dropped = start.map((p) => (p.id === "map" ? { ...p, x: 0, y: 0 } : p));
  const out = settle(dropped, "map");
  assert.equal(overlap(out), false);
  const map = out.find((p) => p.id === "map");
  assert.deepEqual([map.x, map.y], [0, 0]);
  assert.ok(out.find((p) => p.id === "top3").y >= map.h);
});

test("settle floats boxes up into the space a removed box leaves", () => {
  const out = settle(defaultLayout().home.filter((p) => p.id !== "top3"), null);
  assert.equal(overlap(out), false);
  assert.equal(out.find((p) => p.id === "needs").y, 0);
  const narrow = settle([{ id: "reviews", x: 0, y: 9, w: 5, h: 3 }], null);
  assert.equal(narrow[0].y, 0, "a lone box floats to the top");
});
