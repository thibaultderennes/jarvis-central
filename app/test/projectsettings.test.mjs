// Project Settings: the review schedule and build mode, on the site (lib/projectSettings.ts) and on the Mac agent
// (agent/projectsettings.mjs, which has no imports so it loads here too). The two must agree.
import { test } from "node:test";
import assert from "node:assert/strict";
import { effectiveBuildMode, isBuildMode, nextReview, normEvery, reviewEvery as siteEvery, BUILD_MODES as SITE_MODES } from "../lib/projectSettings.ts";
import { buildModeFor, reviewEvery, reviewsDue, reviewWindow, daysFrom, BUILD_MODES } from "../../agent/projectsettings.mjs";

test("normEvery: whole days 1–90 only", () => {
  assert.equal(normEvery("3"), 3);
  assert.equal(normEvery(90), 90);
  assert.equal(normEvery(" 14 "), 14);
  for (const bad of ["", "0", "91", "2.5", "abc", null, undefined, -1]) assert.equal(normEvery(bad), null, String(bad));
  assert.equal(siteEvery(undefined), 7, "a row from before the column existed reads as weekly");
});

test("build mode: own setting, else the worker default, else Goibniu (site and agent agree)", () => {
  for (const [own, def, want] of [["lugh", "goibniu", "lugh"], [null, "lugh", "lugh"], [null, undefined, "goibniu"], ["nope", "also-nope", "goibniu"], ["goibniu", "lugh", "goibniu"]]) {
    assert.equal(effectiveBuildMode(own, def), want);
    assert.equal(buildModeFor({ build_mode: own }, def), want);
  }
  assert.equal(buildModeFor(null, "lugh"), "lugh");
  assert.ok(isBuildMode("lugh") && !isBuildMode("LUGH"));
  assert.deepEqual(SITE_MODES.map((m) => m.id).sort(), Object.keys(BUILD_MODES).sort());
  assert.deepEqual(SITE_MODES.map((m) => m.name), Object.values(BUILD_MODES).map((m) => m.label));
});

test("reviewEvery (agent): 1–90, default 7", () => {
  assert.equal(reviewEvery({ review_every_days: 3 }), 3);
  assert.equal(reviewEvery({}), 7);
  assert.equal(reviewEvery({ review_every_days: 0 }), 7);
  assert.equal(reviewEvery({ review_every_days: 400 }), 7);
});

test("reviewsDue: only own-schedule projects, due after N days from the last review or attempt", () => {
  const today = "2026-10-06";
  const ps = [
    { id: "weekly", review_every_days: 7 },
    { id: "three", review_every_days: 3 },
    { id: "fresh", review_every_days: 3 },
    { id: "never", review_every_days: 14 },
    { id: "off", review_every_days: 2, reviews_enabled: false },
    { id: "gone", review_every_days: 2, archived: true },
    { id: "queued", review_every_days: 2 },
    { id: "failing", review_every_days: 2 },
  ];
  const last = { weekly: "2026-09-01", three: "2026-10-03", fresh: "2026-10-04", queued: "2026-09-01", failing: "2026-09-20" };
  const tried = { failing: "2026-10-05" };
  const due = reviewsDue(ps, { last, tried, today, busy: new Set(["queued"]) }).map((p) => p.id);
  assert.deepEqual(due, ["three", "never"]);
  assert.deepEqual(reviewsDue(ps, { last, tried: { failing: "2026-10-04" }, today, busy: new Set(["queued"]) }).map((p) => p.id), ["three", "never", "failing"]);
});

test("reviewWindow: N days ending today", () => {
  assert.deepEqual(reviewWindow("2026-10-06", 3), { startDate: "2026-10-04", lastDate: "2026-10-06" });
  assert.deepEqual(reviewWindow("2026-03-01", 7), { startDate: "2026-02-23", lastDate: "2026-03-01" });
  assert.equal(daysFrom("2026-02-23", "2026-03-01"), 6);
});

test("nextReview: weekly is the weekly run's; otherwise N days after the last, never in the past", () => {
  assert.equal(nextReview({ every: 7, last: "2026-10-05", today: "2026-10-06" }), null);
  assert.equal(nextReview({ every: 3, last: "2026-10-05", today: "2026-10-06" }), "2026-10-08");
  assert.equal(nextReview({ every: 3, last: "2026-09-01", today: "2026-10-06" }), "2026-10-06");
  assert.equal(nextReview({ every: 14, last: null, today: "2026-10-06" }), "2026-10-06");
});
