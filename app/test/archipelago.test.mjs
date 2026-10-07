// The Archipelago (lib/archipelago.ts): land weights, radius clamping, building tiers, seeded shapes and the layout.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  areaWeight, buildingsFor, buoyFor, colsFor, hash, islandRadius, islandShape, islandSlots, layoutIslands, newSince,
  onTimeCount, routePoints, sample, sharedRoutes, wavesFor, weatherFor, LAND_DAYS, R_MAX, R_MIN, SHALLOW, WOBBLE,
} from "../lib/archipelago.ts";

const T = "2026-10-07";
const done = (done_on, due = null) => ({ status: "done", due, done_on });

test("land weight: on time 1, late 0.5, undated 0.25, only the last LAND_DAYS, only done items", () => {
  const w = areaWeight([
    done("2026-10-01", "2026-10-02"), // on time
    done("2026-10-03", "2026-10-02"), // late
    done("2026-10-05"),               // undated
    done("2026-10-05"), done("2026-10-05"), done("2026-10-05"),
    { status: "todo", due: "2026-10-01", done_on: null },  // open: never land
    { status: "cancelled", due: null, done_on: "2026-10-01" },
    done("2026-04-01", "2026-04-02"), // older than 180 days
    done("2026-10-08", "2026-10-09"), // after today
  ], T);
  assert.equal(LAND_DAYS, 180);
  assert.deepEqual([w.onTime, w.late, w.undated], [1, 1, 4]);
  assert.equal(w.weight, 1 + 0.5 + 4 * 0.25);
  assert.equal(areaWeight([done("2026-04-11", "2026-05-01")], T).weight, 1); // 179 days ago still counts
  assert.equal(areaWeight([done("2026-04-10", "2026-05-01")], T).weight, 0); // 180 days ago is outside
});

test("undated busywork barely grows land: 20 undated items weigh as much as 5 on time", () => {
  const busy = areaWeight(Array.from({ length: 20 }, () => done("2026-10-06")), T).weight;
  const real = areaWeight(Array.from({ length: 5 }, () => done("2026-10-06", "2026-10-06")), T).weight;
  assert.equal(busy, real);
});

test("radius: √ of the weight, biggest island gets the max, clamped both ways", () => {
  assert.equal(islandRadius(0, 0), R_MIN);
  assert.equal(islandRadius(0, 10), R_MIN);
  assert.equal(islandRadius(10, 10), R_MAX);
  assert.equal(islandRadius(40, 10), R_MAX); // never past the max
  assert.equal(islandRadius(0.01, 100), R_MIN); // never below the min
  assert.equal(islandRadius(25, 100), Math.round(R_MAX * 0.5 * 10) / 10); // a quarter of the weight, half the radius
  assert.ok(islandRadius(30, 100) > islandRadius(20, 100));
});

test("buildings: a hut per 5 on time, 5 huts make a house, 5 houses a tower, tallest first", () => {
  assert.deepEqual(buildingsFor(4), { buildings: [], units: 0, hidden: 0 });
  assert.deepEqual(buildingsFor(5).buildings, [{ tier: "hut", earnedAt: 5 }]);
  assert.deepEqual(buildingsFor(24).buildings.map((b) => b.tier), ["hut", "hut", "hut", "hut"]);
  assert.deepEqual(buildingsFor(25).buildings, [{ tier: "house", earnedAt: 25 }]);
  const b = buildingsFor(161); // 1 tower (125) + 1 house (25) + 2 huts (10) + 1 left over
  assert.deepEqual(b.buildings.map((x) => x.tier), ["tower", "house", "hut", "hut"]);
  assert.deepEqual(b.buildings.map((x) => x.earnedAt), [125, 150, 155, 160]);
  assert.equal(b.units, 32);
  const many = buildingsFor(125 * 14 + 24, 12); // 14 towers + 4 huts = 18 buildings, capped at 12
  assert.equal(many.buildings.length, 12);
  assert.equal(many.hidden, 6);
  assert.equal(many.buildings.at(-1).tier, "hut");
});

test("on-time count ignores late, undated and open items", () => {
  assert.equal(onTimeCount([done("2026-10-01", "2026-10-01"), done("2026-10-02", "2026-10-01"), done("2026-10-01"), { status: "todo", due: "2026-10-09", done_on: null }]), 1);
});

test("since your last visit: new huts only, never negative, nothing on a first visit", () => {
  assert.equal(newSince(12, 4), 2);
  assert.equal(newSince(12, 12), 0);
  assert.equal(newSince(3, 12), 0);
  assert.equal(newSince(12, null), 0);
  assert.equal(newSince(12, undefined), 0);
});

test("island shapes are seeded: same id, same coast; different ids differ; the coast stays near the radius", () => {
  const s = hash("app");
  assert.equal(hash("app"), s);
  assert.notEqual(hash("app"), hash("site"));
  assert.equal(islandShape(s, 40), islandShape(s, 40));
  assert.notEqual(islandShape(s, 40), islandShape(hash("site"), 40));
  assert.match(islandShape(s, 40), /^M[-\d. ]+(C[-\d. ]+)+Z$/);
  const nums = islandShape(s, 40).match(/-?\d+(\.\d+)?/g).map(Number);
  for (let i = 0; i < nums.length; i += 2) assert.ok(Math.hypot(nums[i], nums[i + 1]) <= 40 * (1 + WOBBLE) * 1.1);
});

test("slots sit inside the land, first one nearest the middle, deterministic", () => {
  const slots = islandSlots(hash("app"), 50, 17);
  assert.equal(slots.length, 17);
  assert.deepEqual(slots, islandSlots(hash("app"), 50, 17));
  const d = slots.map((p) => Math.hypot(p.x, p.y));
  assert.ok(d.every((x) => x <= 50 * (1 - WOBBLE)));
  assert.equal(Math.min(...d), d[0]);
  assert.deepEqual(islandSlots(1, 50, 1), [{ x: 0, y: 0 }]);
  assert.deepEqual(islandSlots(1, 50, 0), []);
});

test("the buoy sits offshore, beside the island, never below it", () => {
  for (const id of ["a", "b", "c", "app", "site", "jarvis", "x1", "x2"]) {
    const b = buoyFor(hash(id), 40);
    assert.ok(Math.hypot(b.x, b.y) > 40 * SHALLOW * (1 + WOBBLE));
    assert.ok(b.y < 40 * 0.6);
  }
});

test("route points run end to end, sampling keeps order and both ends", () => {
  const p = routePoints(3, { x: 0, y: 0 }, { x: 100, y: 0 });
  assert.equal(p.length, 5);
  assert.deepEqual(p[0], { x: 0, y: 0 });
  assert.deepEqual(p[4], { x: 100, y: 0 });
  assert.deepEqual(sample([1, 2, 3], 10), [1, 2, 3]);
  const s = sample(Array.from({ length: 30 }, (_, i) => i), 10);
  assert.equal(s.length, 10);
  assert.equal(s[0], 0);
  assert.equal(s[9], 29);
  assert.ok(s.every((v, i) => i === 0 || v > s[i - 1]));
});

test("weather follows the verdict", () => {
  assert.equal(weatherFor("off-track"), "storm");
  assert.equal(weatherFor("at-risk"), "cloud");
  assert.equal(weatherFor("on-track"), "clear");
  assert.equal(weatherFor("idle"), null);
  assert.equal(weatherFor(null), null);
});

test("layout: deterministic, top 3 in the middle, no two islands overlap", () => {
  for (const n of [1, 2, 3, 4, 7, 12, 15, 23]) {
    const cols = colsFor(n), cellW = 204, cellH = 216;
    const L = layoutIslands(n, { cols, cellW, cellH, seed: 7 });
    assert.equal(L.slots.length, n);
    assert.deepEqual(L, layoutIslands(n, { cols, cellW, cellH, seed: 7 }));
    // Every island, with its shallows and buoy, fits in a circle this big; none may touch another.
    const reach = R_MAX * SHALLOW * (1 + WOBBLE);
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const a = L.slots[i], b = L.slots[j];
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y) > 2 * reach, `n=${n}: ${i} and ${j} overlap`);
    }
    for (const p of L.slots) assert.ok(p.x > reach && p.x < L.width - reach && p.y > 0 && p.y < L.height);
    if (n >= 7) {
      const cx = L.width / 2, cy = L.height / 2, dist = (p) => Math.hypot(p.x - cx, p.y - cy);
      const top = Math.max(...L.slots.slice(0, 3).map(dist)), rest = Math.min(...L.slots.slice(3).map(dist));
      assert.ok(top <= rest + 0.12 * cellW, `n=${n}: top 3 not central`);
    }
  }
  assert.deepEqual(layoutIslands(0, { cols: 3, cellW: 100, cellH: 100 }).slots, []);
  const one = layoutIslands(5, { cols: 1, cellW: 300, cellH: 230 });
  assert.ok(one.slots.every((p) => Math.abs(p.x - 150) <= 0.04 * 300 + 0.01)); // narrow: one column
  assert.equal(one.height, 5 * 230);
});

test("columns grow with the count, up to 5", () => {
  assert.deepEqual([1, 2, 3, 6, 10, 15, 40].map((n) => colsFor(n)), [1, 2, 3, 3, 4, 5, 5]);
});

test("shared routes link islands whose next deadlines fall on the same day", () => {
  assert.deepEqual(sharedRoutes(["2026-10-09", null, "2026-10-20", "2026-10-09", "2026-10-09"]), [[0, 3], [3, 4]]);
  assert.deepEqual(sharedRoutes([null, "2026-10-09"]), []);
});

test("waves stay clear of islands and of each other", () => {
  const avoid = [{ x: 100, y: 100, r: 80 }];
  const w = wavesFor(3, 600, 300, avoid, 12);
  assert.deepEqual(w, wavesFor(3, 600, 300, avoid, 12));
  assert.ok(w.length > 0);
  assert.ok(w.every((p) => Math.hypot(p.x - 100, p.y - 100) >= 80));
});

test("the sea route leaves the shore and ends at the buoy, staying off the land", async () => {
  const { seaRoute } = await import("../lib/archipelago.ts");
  for (const id of ["a", "b", "app", "site"]) {
    const b = buoyFor(hash(id), 40), pts = seaRoute(8, 40, b);
    assert.equal(pts.length, 10);
    assert.ok(Math.abs(pts[9].x - b.x) < 0.2 && Math.abs(pts[9].y - b.y) < 0.2);
    assert.ok(Math.hypot(pts[0].x, pts[0].y) < 40);
    assert.ok(pts.slice(1).every((p) => Math.hypot(p.x, p.y) > 40 * (1 + WOBBLE)));
    assert.ok(pts[0].y < 0); // leaves from the top half, away from the label
  }
});

test("layout: with central 0, islands keep reading order (narrow maps list the top 3 first)", () => {
  const L = layoutIslands(5, { cols: 1, cellW: 300, cellH: 204, central: 0 });
  assert.ok(L.slots.every((p, i) => i === 0 || p.y > L.slots[i - 1].y));
});
