// Inbox lanes (lib/inboxLanes.ts): which lane a conversation lands in, its one-line summary, and the project bundles.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bundles, handled, kindLabel, laneOf, laterUntil, summaryOf, tomorrowMorning } from "../lib/inboxLanes.ts";

const M = (o = {}) => ({ status: "answered", mode: "discuss", meta: {}, reply: "", text: "Hello", ...o });

test("lanes follow status, mode, meta.kind and meta.pr_url", () => {
  assert.equal(laneOf(M(), M({ status: "working" })), "claude");
  assert.equal(laneOf(M(), M({ status: "new" })), "claude");
  assert.equal(laneOf(M(), M({ status: "needs_you" })), "needs");
  assert.equal(laneOf(M(), M({ status: "error" })), "needs");
  assert.equal(laneOf(M(), M({ reply: "NEEDS YOU: pick a name" })), "needs");
  assert.equal(laneOf(M({ mode: "build" }), M({ status: "done", meta: { pr_url: "https://github.com/a/b/pull/1" } })), "shipped");
  assert.equal(laneOf(M({ meta: { kind: "merged" } }), M({ meta: { kind: "merged" } })), "shipped");
  for (const mode of ["review", "screen", "plan", "setup"]) assert.equal(laneOf(M({ mode }), M()), "reports");
  assert.equal(laneOf(M({ meta: { kind: "refine" } }), M()), "fyi");
  assert.equal(laneOf(M(), M()), "fyi");
  // A needs-you answer outranks the PR it came with.
  assert.equal(laneOf(M({ mode: "build" }), M({ status: "needs_you", meta: { pr_url: "x" } })), "needs");
  // A follow-up still in flight puts the thread back with Claude.
  assert.equal(laneOf(M({ mode: "review" }), M({ status: "seen" })), "claude");
});

test("summary: first bold sentence, the due line for new items, else the first sentence", () => {
  assert.equal(summaryOf(M({ reply: "Some intro.\n\n**Merged the fix and tagged the release.** More below." })), "Merged the fix and tagged the release.");
  assert.equal(summaryOf(M({ reply: "**Possible duplicate.** Looks like it overlaps `a1`. Merge them or delete one." })), "Possible duplicate. Looks like it overlaps a1.");
  assert.equal(summaryOf(M({ reply: "Done the thing. Then another.\n\n**PR:** https://github.com/x (not merged)" })), "Done the thing.");
  assert.equal(summaryOf(M({ meta: { kind: "refine" }, reply: "due 2026-10-01 → **2026-10-09** · ~45 min · priority high\n\nSteps\n\n_why_" })), "due 2026-10-01 → 2026-10-09 · ~45 min · priority high");
  assert.equal(summaryOf(M({ reply: "NEEDS YOU: the repo has no remote. Add one." })), "the repo has no remote.");
  assert.equal(summaryOf(M({ reply: "", text: "\nPlan my Tuesday\nplease" })), "Plan my Tuesday");
  assert.ok(summaryOf(M({ reply: "x".repeat(400) })).length <= 160);
});

test("labels, later and handled", () => {
  assert.equal(kindLabel(M({ mode: "build" })), "build");
  assert.equal(kindLabel(M({ meta: { kind: "comment" } })), "your comment");
  assert.equal(kindLabel(M({ meta: { kind: "merged" } })), "merged");
  const now = Date.parse("2026-10-14T12:00:00Z");
  assert.equal(laterUntil(M({ meta: { later_until: "2026-10-15T12:00:00Z" } }), now), "2026-10-15T12:00:00Z");
  assert.equal(laterUntil(M({ meta: { later_until: "2026-10-13T12:00:00Z" } }), now), null);
  assert.equal(laterUntil(M({ meta: { later_until: null } }), now), null);
  assert.equal(handled({ treated_at: null, archived: true }), true);
  assert.equal(handled({ treated_at: null, archived: false }), false);
  const t = tomorrowMorning(new Date(2026, 9, 14, 23, 30));
  assert.deepEqual([t.getDate(), t.getHours(), t.getMinutes()], [15, 8, 0]);
});

test("bundles keep thread order and group by project", () => {
  const th = (id, p) => ({ id, root: { project_id: p } });
  const b = bundles([th(1, "a"), th(2, "b"), th(3, "a"), th(4, null)]);
  assert.deepEqual(b.map((x) => [x.project_id, x.threads.map((t) => t.id)]), [["a", [1, 3]], ["b", [2]], [null, [4]]]);
});
