// The Villages (lib/villages.ts): cleared ground, hall tiers, what each building stands for, and the world layout.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  alongRoad, areaWeight, bankState, buildWorld, cellOrder, coinsFor, colsFor, forestTile, hallTier, hash, homesState,
  housesFor, LAND_DAYS, newSince, onTimeCount, planVillage, plotFor, PLOTS, policeState, sample, shopState, TILE_KEYS,
  waterTile, weatherFor, workshopState, CELL_W, CELL_H, CORE_W, CORE_H,
} from "../lib/villages.ts";

const T = "2026-10-07";
const done = (done_on, due = null) => ({ status: "done", due, done_on });
const village = (id, o = {}) => ({ id, weight: 0, tier: "small", houses: 0, deadline: true, built: { police: false, bank: false, shop: false, workshop: false }, ...o });

test("cleared ground: on time 1, late 0.5, undated 0.25, only the last LAND_DAYS, only done items", () => {
  const w = areaWeight([
    done("2026-10-01", "2026-10-02"), done("2026-10-03", "2026-10-02"), done("2026-10-05"),
    done("2026-10-05"), done("2026-10-05"), done("2026-10-05"),
    { status: "todo", due: "2026-10-01", done_on: null }, { status: "cancelled", due: null, done_on: "2026-10-01" },
    done("2026-04-01", "2026-04-02"), done("2026-10-08", "2026-10-09"),
  ], T);
  assert.equal(LAND_DAYS, 180);
  assert.deepEqual([w.onTime, w.late, w.undated], [1, 1, 4]);
  assert.equal(w.weight, 1 + 0.5 + 4 * 0.25);
  assert.equal(areaWeight([done("2026-04-11", "2026-05-01")], T).weight, 1);
  assert.equal(areaWeight([done("2026-04-10", "2026-05-01")], T).weight, 0);
  assert.equal(onTimeCount([done("2026-10-01", "2026-10-01"), done("2026-10-02", "2026-10-01"), done("2026-10-01")]), 1);
});

test("plot size: area grows with the weight, never shrinks, smallest plot for nothing done", () => {
  assert.deepEqual(plotFor(0, 0), PLOTS[0]);
  assert.deepEqual(plotFor(0, 10), PLOTS[0]);
  assert.deepEqual(plotFor(10, 10), PLOTS.at(-1));
  let prev = 0;
  for (let w = 0; w <= 20; w++) {
    const p = plotFor(w, 20), a = p.w * p.h;
    assert.ok(a >= prev, `area shrank at ${w}`);
    prev = a;
  }
  for (const p of PLOTS) { assert.ok(p.w >= CORE_W + 2 && p.h >= CORE_H + 2); assert.ok(p.w + 2 <= CELL_W && p.h + 4 <= CELL_H); }
});

test("town hall tiers: small, hall at 25, town hall at 125", () => {
  assert.deepEqual(hallTier(0), { tier: "small", since: 0, next: 25 });
  assert.equal(hallTier(24).tier, "small");
  assert.deepEqual(hallTier(25), { tier: "hall", since: 25, next: 125 });
  assert.equal(hallTier(124).tier, "hall");
  assert.deepEqual(hallTier(125), { tier: "town", since: 125, next: null });
  assert.equal(newSince(30, 26), 4);
  assert.equal(newSince(3, 12), 0);
  assert.equal(newSince(12, null), 0);
});

test("police station: empty lot without checks; the latest of each check, worst wins", () => {
  assert.deepEqual(policeState([]), { built: false });
  assert.deepEqual(policeState([{ type: "project", title: "x", verdict: "off-track", created_at: "2026-10-01" }]), { built: false });
  const sec = (date, verdict, counts) => ({ type: "security", title: `audit ${date}`, verdict, created_at: `${date}T09:00:00Z`, meta: { date, counts } });
  const scr = (date, verdict, fail, kind = "vibecoded") => ({ type: "screening", title: "s", verdict, created_at: `${date}T09:00:00Z`, meta: { kind, counts: { fail } } });
  // An old critical audit is replaced by a newer clean one.
  assert.equal(policeState([sec("2026-09-01", "off-track", { critical: 2 }), sec("2026-10-01", "on-track", { critical: 0, high: 0 })]).level, "calm");
  assert.equal(policeState([sec("2026-10-01", "on-track", { critical: 0 }), scr("2026-10-02", "at-risk", 0)]).level, "amber");
  assert.equal(policeState([scr("2026-10-02", "on-track", 3)]).level, "amber");
  assert.equal(policeState([sec("2026-10-01", null, { critical: 1 })]).level, "red");
  const p = policeState([scr("2026-10-02", "off-track", 0, "prelaunch"), scr("2026-10-03", "on-track", 0, "vibecoded")]);
  assert.equal(p.level, "red");
  assert.equal(p.checks.length, 2);
});

test("bank: costs a month per currency, revenue from MRR or weekly revenue, a cost sign when not covered", () => {
  assert.deepEqual(bankState([], []), { built: false });
  const costs = [{ amount: 34, currency: "USD", period: "month" }, { amount: 60, currency: "USD", period: "year" }, { amount: 9, currency: "USD", period: "month", active: false }];
  const b = bankState(costs, []);
  assert.deepEqual(b.costs, [{ currency: "USD", monthly: 39 }]);
  assert.equal(b.revenue, null);
  assert.equal(b.costSign, true);
  assert.equal(b.coins, 0);
  const rich = bankState(costs, [{ date: "2026-10-01", metrics: { mrr: 120 } }, { date: "2026-10-05", metrics: { mrr: 1500 } }]);
  assert.equal(rich.revenue, 1500);
  assert.equal(rich.costSign, false);
  assert.equal(rich.coins, 3);
  const weekly = bankState([], [{ date: "2026-10-05", metrics: { revenue: 120 } }]);
  assert.equal(weekly.revenue, 520);
  assert.equal(weekly.costSign, false);
  assert.equal(bankState([{ amount: 10, currency: "USD", period: "month" }, { amount: 10, currency: "CAD", period: "month" }], [{ date: "2026-10-01", metrics: { mrr: 5 } }]).costSign, false); // two currencies: not compared
  assert.deepEqual([0, 0.5, 1, 99, 100, 999, 1000, 10000, 1e7].map(coinsFor), [0, 0, 1, 1, 2, 2, 3, 4, 4]);
});

test("shop: growing, flat or declining over the window; one snapshot is flat; none is an empty lot", () => {
  const s = (date, m) => ({ date, metrics: m });
  assert.deepEqual(shopState([], T), { built: false });
  assert.equal(shopState([s("2026-09-20", { visits: 100 }), s("2026-10-05", { visits: 130 })], T).trend, "up");
  assert.equal(shopState([s("2026-09-20", { visits: 100 }), s("2026-10-05", { visits: 103 })], T).trend, "flat");
  assert.equal(shopState([s("2026-09-20", { visits: 100 }), s("2026-10-05", { visits: 60 })], T).trend, "down");
  assert.equal(shopState([s("2026-10-05", { visits: 60 })], T).trend, "flat");
  assert.deepEqual(shopState([s("2026-08-01", { visits: 1 }), s("2026-08-20", { visits: 9 })], T), { built: false }); // too old
  const fb = shopState([s("2026-10-01", { visits: 50 }), s("2026-09-20", { signups: 4 }), s("2026-10-05", { signups: 9 })], T);
  assert.equal(fb.metric, "signups"); // visits has one point only; signups spans the window
});

test("houses: a log scale of users, paying users first, lots for sale without a count", () => {
  assert.deepEqual([0, 1, 9, 10, 99, 100, 1000, 1e4, 1e5, 1e9].map(housesFor), [0, 1, 1, 2, 2, 3, 4, 5, 6, 6]);
  assert.deepEqual(homesState([]), { built: false });
  assert.deepEqual(homesState([{ date: "2026-10-01", metrics: { users: 120 } }]), { built: true, metric: "users", count: 120, houses: 3 });
  assert.equal(homesState([{ date: "2026-10-01", metrics: { users: 120, paying_users: 8 } }]).metric, "paying_users");
});

test("workshop: builds running, PRs waiting, stopped builds; no repo and no build is an empty lot", () => {
  assert.deepEqual(workshopState([], false), { built: false });
  const it = (id, build_status, status = "doing", pr_url = null) => ({ id, title: id, status, build_status, pr_url, build_note: "tests failed" });
  const w = workshopState([it("a", "working"), it("b", "pr_open", "doing", "https://example.com/pr/1"), it("c", "failed"), it("d", "failed", "done"), it("e", "merged", "done")], false);
  assert.equal(w.built, true);
  assert.deepEqual([w.running, w.waiting, w.failed.length], [1, 1, 1]);
  assert.equal(w.prUrl, "https://example.com/pr/1");
  assert.equal(workshopState([it("b", "pr_open", "doing", "u1"), it("c", "merge_requested", "doing", "u2")], true).prUrl, null); // two PRs: the checklist
  assert.deepEqual(workshopState([], true), { built: true, running: 0, waiting: 0, failed: [], prUrl: null });
});

test("weather and sampling", () => {
  assert.deepEqual(["off-track", "at-risk", "on-track", "idle", null].map(weatherFor), ["storm", "cloud", "clear", null, null]);
  const s = sample(Array.from({ length: 30 }, (_, i) => i), 10);
  assert.equal(s.length, 10);
  assert.deepEqual([s[0], s[9]], [0, 29]);
});

test("cells: top 3 central, a short last row uses whole cells", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 7, 12].map(colsFor), [1, 2, 2, 2, 3, 3, 3]);
  const c = cellOrder(7, 3);
  assert.equal(c.length, 7);
  assert.ok(c.every((p) => Number.isInteger(p.x)));
  const cx = c.reduce((a, p) => a + p.x, 0) / 7, cy = c.reduce((a, p) => a + p.y, 0) / 7, d = (p) => Math.hypot(p.x - cx, (p.y - cy) * 1.1);
  assert.ok(Math.max(...c.slice(0, 3).map(d)) <= Math.min(...c.slice(3).map(d)) + 1e-9); // the top 3 nearest the middle
  assert.equal(new Set(c.map((p) => `${p.x},${p.y}`)).size, 7);
  assert.deepEqual(cellOrder(5, 1, 0).map((p) => p.y), [0, 1, 2, 3, 4]);
});

function check(world, n) {
  const key = (x, y) => `${x},${y}`;
  // Every tile inside the world, from the known set.
  const keys = new Set(TILE_KEYS);
  for (const t of world.tiles) { assert.ok(keys.has(t.t), `unknown tile ${t.t}`); assert.ok(t.x >= 0 && t.y >= 0 && t.x < world.w && t.y < world.h); }
  for (const v of world.villages) for (const t of [...v.ground, ...v.parts.flatMap((p) => p.tiles)]) assert.ok(keys.has(t.t), `unknown tile ${t.t}`);
  // No two villages overlap: each one (ring, road, signpost) stays in its own cell; cells don't overlap.
  assert.equal(world.villages.length, n);
  for (const v of world.villages) {
    const inCell = (x, y) => x >= v.cell.x && x < v.cell.x + v.cell.w && y >= v.cell.y && y < v.cell.y + v.cell.h;
    assert.ok(inCell(v.ring.x, v.ring.y) && inCell(v.ring.x + v.ring.w - 1, v.ring.y + v.ring.h - 1), `${v.id} ring leaves its cell`);
    for (const p of v.road) assert.ok(inCell(p.x, p.y), `${v.id} road leaves its cell`);
  }
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const a = world.villages[i].cell, b = world.villages[j].cell;
    assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `cells ${i} and ${j} overlap`);
  }
  // The river never runs through a village.
  const water = new Set(world.river.map((p) => key(p.x, p.y)));
  for (const v of world.villages) for (let y = v.ring.y; y < v.ring.y + v.ring.h; y++) for (let x = v.ring.x; x < v.ring.x + v.ring.w; x++) assert.ok(!water.has(key(x, y)));
}

test("world: deterministic, villages never overlap, the river stays in its gap with a bridge per road", () => {
  for (const n of [1, 2, 3, 4, 5, 7, 9, 12]) {
    const vs = Array.from({ length: n }, (_, i) => village(`p${i}`, { weight: i * 3, tier: ["small", "hall", "town"][i % 3], houses: i % 7, built: { police: !!(i % 2), bank: true, shop: false, workshop: !!(i % 3) } }));
    const o = { cols: colsFor(n), seed: 7 };
    const w = buildWorld(vs, o);
    assert.deepEqual(w, buildWorld(vs, o));
    check(w, n);
    const rows = Math.ceil(n / colsFor(n));
    assert.equal(w.bridges.length, rows * 2); // one high road per row of cells, two water tiles wide
  }
  const narrow = buildWorld([village("app")], { cols: 1, central: 0, river: false, border: 0 });
  assert.equal(narrow.river.length, 0);
  assert.equal(narrow.w, CELL_W);
  check(narrow, 1);
});

test("a village: buildings in place, sized by tier; empty lots when nothing is recorded; roads reach the signpost", () => {
  for (const id of ["a", "b", "app", "site", "docs", "shop"]) {
    const p = planVillage(village(id, { tier: "town", houses: 6, built: { police: true, bank: true, shop: true, workshop: true } }), 0, 0, 10);
    assert.deepEqual(p, planVillage(village(id, { tier: "town", houses: 6, built: { police: true, bank: true, shop: true, workshop: true } }), 0, 0, 10));
    const hall = p.parts.find((x) => x.key === "hall");
    assert.deepEqual([hall.rect.w, hall.rect.h], [4, 3]);
    assert.equal(p.parts.find((x) => x.key === "homes").slots.length, 6);
    // No two buildings share a tile, and none sits on the fence.
    const seen = new Set();
    for (const part of p.parts) for (const t of part.tiles) {
      const k = `${t.x},${t.y}`;
      assert.ok(!seen.has(k), `${id}: ${part.key} overlaps`);
      seen.add(k);
      assert.ok(t.x > p.plot.x && t.x < p.plot.x + p.plot.w - 1 && t.y > p.plot.y && t.y < p.plot.y + p.plot.h - 1);
    }
    // The road starts at the bottom gate, runs on outside the fence and ends on the signpost at the plot's edge.
    assert.ok(p.sign);
    assert.deepEqual(p.road.at(-1), p.sign);
    assert.equal(p.road[0].y, p.plot.y + p.plot.h);
    assert.ok(p.sign.x === p.plot.x - 1 || p.sign.x === p.plot.x + p.plot.w);
    for (let i = 1; i < p.road.length; i++) assert.equal(Math.abs(p.road[i].x - p.road[i - 1].x) + Math.abs(p.road[i].y - p.road[i - 1].y), 1); // connected
  }
  const small = planVillage(village("x", { deadline: false }), 0, 0, 0);
  assert.deepEqual([small.road, small.sign], [[], null]);
  assert.deepEqual(small.parts.find((x) => x.key === "hall").rect.h, 2);
  for (const key of ["police", "bank", "shop", "workshop"]) {
    const part = small.parts.find((x) => x.key === key);
    assert.equal(part.built, false);
    assert.deepEqual(part.tiles.map((t) => t.t), ["tt12", "tt14", "tt36", "tt38"]); // an empty lot, not a ruin
  }
  assert.equal(small.parts.find((x) => x.key === "homes").built, false);
  assert.notDeepEqual(planVillage(village("a"), 0, 0, 0).ground, planVillage(village("b"), 0, 0, 0).ground); // seeded per id
});

test("stones spread along the road, both ends included", () => {
  const road = [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }];
  const pts = alongRoad(road, 4);
  assert.equal(pts.length, 6);
  assert.deepEqual(pts[0], road[0]);
  assert.deepEqual(pts.at(-1), road.at(-1));
  assert.deepEqual(alongRoad([{ x: 3, y: 3 }], 2), [{ x: 3, y: 3 }]);
});

test("forest and water pieces follow their neighbours", () => {
  assert.equal(forestTile(true, true, true, true), "tt19");
  assert.equal(forestTile(false, true, false, true), "tt6");
  assert.equal(forestTile(true, false, true, false), "tt32");
  assert.equal(forestTile(false, false, true, true), "tt28");
  assert.equal(waterTile(true, true, true, true), "tb37");
  assert.equal(waterTile(false, true, false, true), "tb18");
  assert.equal(waterTile(true, false, true, false), "tb56");
  assert.equal(hash("app"), hash("app"));
});
