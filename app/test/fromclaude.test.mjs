// From Claude (lib/fromClaude.ts): the since-you-last-looked digest, "Got it", Needs-you replies and the Inbox badge.
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeDigest, gotIt, needsThreads, sinceFor, threadsOf, unreadCount, DIGEST_MAX_DAYS } from "../lib/fromClaude.ts";

const NOW = Date.parse("2026-10-14T12:00:00Z");
const h = (n) => new Date(NOW - n * 36e5).toISOString();
let n = 0;
const M = (o = {}) => {
  const id = o.id || `00000000-0000-0000-0000-${String(++n).padStart(12, "0")}`;
  const at = o.at || h(1);
  return { id, thread_id: null, project_id: "alpha", text: "Do the thing", status: "answered", mode: "discuss", meta: {}, reply: "**Did the thing.** Details.",
    archived: false, opened_at: null, treated_at: null, replied_at: at, updated_at: at, created_at: at, ...o };
};

test("threads group replies under their root", () => {
  const r = M({ at: h(5) }), a = M({ thread_id: r.id, at: h(2) });
  const [t] = threadsOf([a, r]);
  assert.equal(t.root.id, r.id);
  assert.equal(t.last.id, a.id);
});

test("digest: grouped by project, one line per conversation, newest first, needs-you left out", () => {
  const msgs = [
    M({ project_id: "alpha", at: h(3), reply: "**Fixed the login bug.** More." }),
    M({ project_id: "beta", at: h(1), mode: "build", meta: { pr_url: "https://github.com/a/b/pull/1" }, reply: "**Opened a PR for the export.**" }),
    M({ project_id: "alpha", at: h(2), mode: "review", reply: "Weekly review done." }),
    M({ project_id: "alpha", at: h(1), status: "needs_you", reply: "NEEDS YOU: pick a price" }),
    M({ project_id: "alpha", at: h(1), status: "working", reply: "" }),
    M({ project_id: "alpha", at: h(1), treated_at: h(0.5) }),
  ];
  const d = computeDigest(msgs, null, NOW);
  assert.equal(d.count, 3);
  assert.deepEqual(d.groups.map((g) => g.project_id), ["beta", "alpha"]);
  assert.deepEqual(d.groups[1].lines.map((l) => [l.lane, l.line]), [["reports", "Weekly review done."], ["fyi", "Fixed the login bug."]]);
  assert.equal(d.groups[0].lines[0].lane, "shipped");
});

test("digest: a conversation you answered again (back with Claude) is not repeated", () => {
  const r = M({ at: h(4) }), again = M({ thread_id: r.id, status: "new", reply: "", at: h(1) });
  assert.equal(computeDigest([r, again], null, NOW).count, 0);
});

test("digest: only after the mark, and never older than the look-back", () => {
  const old = M({ at: h(24 * (DIGEST_MAX_DAYS + 1)) }), mid = M({ at: h(5) }), fresh = M({ at: h(1) });
  assert.equal(computeDigest([old, mid, fresh], null, NOW).count, 2);
  assert.equal(computeDigest([old, mid, fresh], { at: h(3) }, NOW).count, 1);
  assert.equal(computeDigest([old, mid, fresh], { by: { alpha: h(3) } }, NOW).count, 1);
  assert.equal(computeDigest([M({ project_id: null, at: h(1) })], { by: { _: h(0.5) } }, NOW).count, 0);
});

test("got it: one project keeps the others; all resets", () => {
  const a = gotIt(null, "alpha", h(0));
  assert.deepEqual(a, { at: null, by: { alpha: h(0) } });
  const b = gotIt({ at: h(2), by: { alpha: h(3), beta: h(1) } }, null, h(0));
  assert.deepEqual(b, { at: h(2), by: { beta: h(1), _: h(0) } }); // alpha's mark is older than "all": dropped
  assert.deepEqual(gotIt(b, undefined, h(0)), { at: h(0), by: {} });
  assert.equal(sinceFor({ at: h(5), by: { alpha: h(2) } }, "alpha", NOW), h(2));
  assert.equal(sinceFor({ at: h(5), by: { alpha: h(2) } }, "beta", NOW), h(5));
});

test("needs you: only the Needs-you lane, until treated or put off", () => {
  const ask = M({ status: "needs_you", reply: "NEEDS YOU: **Pick a plan name.** Two options.", opened_at: h(0.5) });
  const fyi = M({});
  const pr = M({ mode: "build", meta: { pr_url: "x" } });
  const later = M({ status: "error", meta: { later_until: h(-5) } });
  const done = M({ status: "needs_you", treated_at: h(0.2) });
  const rows = needsThreads([ask, fyi, pr, later, done], NOW);
  assert.deepEqual(rows.map((r) => r.root.id), [ask.id]);
  assert.equal(rows[0].line, "Pick a plan name.");
});

test("inbox badge: unread replies, FYI left out", () => {
  const msgs = [M({}), M({ status: "needs_you" }), M({ mode: "build", meta: { pr_url: "x" } }), M({ status: "needs_you", opened_at: h(0.1) }), M({ status: "working" })];
  assert.equal(unreadCount(msgs, NOW), 2);
});
