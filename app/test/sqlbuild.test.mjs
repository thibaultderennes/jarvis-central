// Query builders behind data.ts writes. Run with `npm test` (Node ≥ 22.18 or 23.6: it loads the .ts files directly).
import { test } from "node:test";
import assert from "node:assert/strict";
import { itemUpdate, normBlockedBy, projectUpsert, wouldCycle } from "../lib/sqlbuild.ts";

/** Every $n in the text has a param and every param is used: the #8 "text = integer" bug was a drift between the two. */
function placeholdersMatch({ text, params }) {
  const used = [...new Set([...text.matchAll(/\$(\d+)/g)].map((m) => +m[1]))].sort((a, b) => a - b);
  assert.deepEqual(used, params.map((_, i) => i + 1), `placeholders ${used} vs ${params.length} params in: ${text}`);
}

const cur = { project_id: "demo", id: "a1", section: "build", title: "T", detail: "", status: "todo", due: "2026-10-10", owner: "claude", critical: false, sort: 1, note: "", blocked_by: [] };

test("projectUpsert: id is $1, only given fields, JSON columns stringified", () => {
  const q = projectUpsert({ id: "demo", name: "Demo", archived: true, featured_rank: null, sections: [{ id: "build", name: "Build" }], nope: "ignored" });
  placeholdersMatch(q);
  assert.equal(q.params[0], "demo");
  assert.match(q.text, /^insert into projects \(id, name, sections, archived, featured_rank\)/);
  assert.equal(q.params[2], JSON.stringify([{ id: "build", name: "Build" }]));
  assert.equal(q.params[4], null, "null is kept (clears the top-3 slot); only undefined is skipped");
  assert.ok(!q.text.includes("nope"));
});

test("itemUpdate: only whitelisted fields that change", () => {
  const q = itemUpdate(cur, { title: "T", status: "done", project_id: "other", id: "zz", done_at: "x", "x; drop table items": 1 });
  placeholdersMatch(q);
  assert.deepEqual(q.cols, ["status"]);
  assert.deepEqual(q.params, ["demo", "a1", "done"]);
  assert.match(q.text, /done_at = now\(\)/);
  assert.match(q.text, /where project_id = \$1 and id = \$2 returning \*$/);
});

test("itemUpdate: nothing to change returns null", () => {
  assert.equal(itemUpdate(cur, { title: "T", due: "2026-10-10", blocked_by: [] }), null);
  assert.equal(itemUpdate(cur, {}), null);
});

test("itemUpdate: empty due clears it; numbers stay numbers", () => {
  const q = itemUpdate(cur, { due: "", priority: 2, estimate_minutes: 45 });
  placeholdersMatch(q);
  assert.deepEqual(q.values, { due: null, priority: 2, estimate_minutes: 45 });
  assert.equal(typeof q.params[3], "number");
});

test("itemUpdate: build_status stamps build_updated_at; reopening clears done_at", () => {
  const q = itemUpdate({ ...cur, status: "done" }, { status: "todo", build_status: "pr_open" });
  placeholdersMatch(q);
  assert.match(q.text, /done_at = null/);
  assert.match(q.text, /build_updated_at = now\(\)/);
});

test("itemUpdate: blocked_by from the CLI string form, compared by value", () => {
  const q = itemUpdate(cur, { blocked_by: "r-dom, Decide-AI,r-dom" });
  placeholdersMatch(q);
  assert.deepEqual(q.values.blocked_by, ["r-dom", "decide-ai"]);
  assert.equal(itemUpdate({ ...cur, blocked_by: ["r-dom"] }, { blocked_by: ["r-dom"] }), null);
});

test("normBlockedBy: drops junk, dedupes, caps at 20", () => {
  assert.deepEqual(normBlockedBy(["ok", "", "Bad Code", "../x", "ok"]), ["ok"]);
  assert.deepEqual(normBlockedBy(""), []);
  assert.deepEqual(normBlockedBy(null), []);
  assert.equal(normBlockedBy(Array.from({ length: 30 }, (_, i) => `i${i}`)).length, 20);
});

test("wouldCycle: direct and indirect loops", () => {
  const edges = { b: ["c"], c: ["a"], d: [] };
  assert.equal(wouldCycle(edges, "a", ["b"]), true);
  assert.equal(wouldCycle(edges, "a", ["d"]), false);
  assert.equal(wouldCycle({ x: ["x"] }, "a", ["x"]), false, "an existing self-loop elsewhere doesn't hang");
});
