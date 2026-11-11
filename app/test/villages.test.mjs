// The Villages (lib/villages.ts): cleared ground, hall tiers, what each building stands for, and the world layout.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  areaWeight, bankState, coinsFor, hallTier, hash, homesState,
  housesFor, LAND_DAYS, newSince, onTimeCount, policeState, sample, shopState, weatherFor, workshopState,
} from "../lib/villages.ts";

const T = "2026-10-07";
const done = (done_on, due = null) => ({ status: "done", due, done_on });

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

test("eventsFor: finished items, builds and reviews of the last days, newest first", async () => {
  const { eventsFor, agoWords } = await import("../lib/villages.ts");
  const now = "2026-10-10T12:00:00.000Z";
  const items = [
    { id: "a", title: "On time", status: "done", due: "2026-10-10", done_at: "2026-10-10T09:00:00.000Z", done_on: "2026-10-10" },
    { id: "b", title: "Late", status: "done", due: "2026-10-01", done_at: "2026-10-09T09:00:00.000Z", done_on: "2026-10-09" },
    { id: "c", title: "Old", status: "done", due: null, done_at: "2026-09-01T09:00:00.000Z", done_on: "2026-09-01" },
    { id: "d", title: "PR", status: "doing", due: null, done_at: null, done_on: null, build_status: "pr_open", build_updated_at: "2026-10-10T11:00:00.000Z" },
  ];
  const reviews = [{ id: "r1", type: "project", title: "Review", headline: "Headline", created_at: "2026-10-08T05:00:00.000Z" }, { id: "r2", type: "security", title: "Audit", created_at: "2026-10-07T05:00:00.000Z" }];
  const ev = eventsFor(items, reviews, now);
  assert.deepEqual(ev.map((e) => [e.id, e.kind, e.part]), [["b:d", "pr", "workshop"], ["d:a", "done", "hall"], ["d:b", "late", "hall"], ["r:r1", "review", "hall"], ["r:r2", "audit", "police"]]);
  assert.equal(ev[3].text, "Headline");
  assert.equal(agoWords("2026-10-10T11:48:00.000Z", now), "12 min ago");
  assert.equal(agoWords("2026-10-10T09:00:00.000Z", now), "3 h ago");
  assert.equal(agoWords("2026-10-09T09:00:00.000Z", now), "yesterday");
  assert.equal(agoWords("2026-10-06T09:00:00.000Z", now), "4 days ago");
});

test("itemsAsOf, weekSeries, seasonOf, landmarkFor", async () => {
  const { itemsAsOf, weekSeries, seasonOf, landmarkFor, LANDMARKS } = await import("../lib/villages.ts");
  const items = [
    { id: "a", status: "done", created_on: "2026-09-01", done_on: "2026-09-20" },
    { id: "b", status: "done", created_on: "2026-09-01", done_on: "2026-10-08" },
    { id: "c", status: "cancelled", created_on: "2026-09-01", done_on: null, closed_on: "2026-10-05" },
    { id: "d", status: "todo", created_on: "2026-10-06", done_on: null },
  ];
  assert.deepEqual(itemsAsOf(items, "2026-10-01").map((i) => [i.id, i.status]), [["a", "done"], ["b", "todo"], ["c", "todo"]]);
  assert.deepEqual(itemsAsOf(items, "2026-10-10").map((i) => [i.id, i.status]), [["a", "done"], ["b", "done"], ["c", "cancelled"], ["d", "todo"]]);
  const w = weekSeries(items, "2026-10-10", 3);
  assert.deepEqual(w.map((x) => x.date), ["2026-09-26", "2026-10-03", "2026-10-10"]);
  assert.deepEqual(w.map((x) => x.open), [2, 2, 1]);
  assert.deepEqual(w.map((x) => x.done), [1, 0, 1]);
  assert.equal(seasonOf("2026-11-11"), "autumn");
  assert.equal(seasonOf("2026-01-11"), "winter");
  assert.equal(seasonOf("2026-11-11", true), "spring");
  assert.ok(LANDMARKS.includes(landmarkFor("some-project")));
  assert.equal(landmarkFor("x"), landmarkFor("x"));
});
