// Inbox auto-treat (agent/inbox.mjs): which opened replies count as FYI, and when they're due.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isFyi, dueForAutoTreat, autoTreatDays } from "../../agent/inbox.mjs";

const NOW = Date.parse("2026-10-14T12:00:00Z");
const ago = (d) => new Date(NOW - d * 864e5).toISOString();
const msg = (o = {}) => ({ id: "m", mode: "discuss", status: "answered", item_id: null, archived: false, opened_at: ago(4), treated_at: null, meta: { mode: "answer" }, ...o });

test("isFyi: refine and comment notes, plain discuss answers", () => {
  assert.equal(isFyi(msg({ meta: { kind: "refine" } })), true);
  assert.equal(isFyi(msg({ meta: { kind: "comment" } })), true);
  assert.equal(isFyi(msg()), true);
  assert.equal(isFyi(msg({ mode: "auto", meta: {} })), true);
});

test("isFyi: never needs_you, error, work in flight, PRs, branches, items or other runs", () => {
  for (const status of ["needs_you", "error", "new", "seen", "working"]) assert.equal(isFyi(msg({ status })), false, status);
  assert.equal(isFyi(msg({ status: "done", meta: { mode: "code", pr_url: "https://github.com/o/r/pull/1", branch: "b" } })), false);
  assert.equal(isFyi(msg({ mode: "auto", meta: { mode: "code", branch: null, pr_url: null } })), false);
  assert.equal(isFyi(msg({ mode: "build", meta: { mode: "answer" } })), false);
  assert.equal(isFyi(msg({ item_id: "x", meta: { kind: "merged" } })), false);
  assert.equal(isFyi(msg({ meta: { kind: "merged" } })), false);
  for (const mode of ["plan", "screen", "review", "setup", "website"]) assert.equal(isFyi(msg({ mode, status: "done", meta: { mode } })), false, mode);
});

test("dueForAutoTreat: opened long enough ago, still pending, not auto-treated before", () => {
  const ms = [
    msg({ id: "due" }),
    msg({ id: "recent", opened_at: ago(2) }),
    msg({ id: "unopened", opened_at: null }),
    msg({ id: "treated", treated_at: ago(1) }),
    msg({ id: "archived", archived: true }),
    msg({ id: "moved-back", meta: { mode: "answer", auto_treated: true } }),
    msg({ id: "needs", status: "needs_you" }),
    msg({ id: "edge", opened_at: ago(3) }),
  ];
  assert.deepEqual(dueForAutoTreat(ms, 3, NOW).map((m) => m.id), ["due", "edge"]);
  assert.deepEqual(dueForAutoTreat(ms, 0, NOW), []);
});

test("autoTreatDays: default 3, 0 or junk = off", () => {
  assert.equal(autoTreatDays({}), 3);
  assert.equal(autoTreatDays({ inbox: { auto_treat_fyi_days: 5 } }), 5);
  assert.equal(autoTreatDays({ inbox: { auto_treat_fyi_days: 0 } }), 0);
  assert.equal(autoTreatDays({ inbox: { auto_treat_fyi_days: "x" } }), 0);
});
