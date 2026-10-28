import { test } from "node:test";
import assert from "node:assert/strict";
import { everyLabel, workerAlive, workerEvery } from "../lib/workerBeat.ts";

test("an agent that doesn't report its interval ran every minute", () => {
  assert.equal(workerEvery(null), 60);
  assert.equal(workerEvery({ at: "x", info: {} }), 60);
  assert.equal(workerEvery({ at: "x", info: { interval_s: 3600 } }), 3600);
  assert.equal(workerEvery({ info: { interval_s: 5 } }), 30);
});

test("online for two intervals plus five minutes", () => {
  const now = Date.parse("2026-10-28T12:00:00Z"), ago = (min) => new Date(now - min * 60_000).toISOString();
  assert.equal(workerAlive(null, 3600, now), false);
  assert.equal(workerAlive(ago(4), 60, now), true);
  assert.equal(workerAlive(ago(8), 60, now), false);
  assert.equal(workerAlive(ago(90), 3600, now), true);
  assert.equal(workerAlive(ago(126), 3600, now), false);
});

test("the interval reads as words", () => {
  assert.equal(everyLabel(60), "every minute");
  assert.equal(everyLabel(900), "every 15 minutes");
  assert.equal(everyLabel(3600), "every hour");
  assert.equal(everyLabel(21600), "every 6 hours");
});
