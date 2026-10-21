// The Monday run's survival helpers (agent/weeklyrun.mjs, no imports so it loads here): the shorter bundle for a
// retry after a timeout, the Jarvis-first order, and the arguments a "Run again" on a failed report gets.
import { test } from "node:test";
import assert from "node:assert/strict";
import { shortenBundle, jarvisFirst, rerunArgs, failedBody, REPORTS } from "../../agent/weeklyrun.mjs";

test("shortenBundle: keeps every heading, caps lines per section, says what it cut", () => {
  const md = ["# P", "## Commits", ...Array.from({ length: 40 }, (_, i) => `- c${i}`), "## Sessions", "- s1", "- s2"].join("\n");
  const s = shortenBundle(md, { perSection: 5 });
  assert.match(s, /## Commits/);
  assert.match(s, /## Sessions\n- s1\n- s2/);
  assert.match(s, /- c4\n- … 35 more lines cut/);
  assert.doesNotMatch(s, /- c5\n/);
});

test("shortenBundle: long lines cut, code fences stay balanced, total capped", () => {
  const md = ["## Project", "```json", ...Array.from({ length: 50 }, (_, i) => `"k${i}": 1`), "```", "## Msgs", "x".repeat(1000)].join("\n");
  const s = shortenBundle(md, { perSection: 10, lineChars: 100 });
  assert.equal((s.match(/```/g) || []).length, 2);
  assert.ok(s.split("\n").every((l) => l.length <= 101 || l.startsWith("- …")));
  assert.ok(shortenBundle("y\n".repeat(50_000), { perSection: 1e9, maxChars: 1000 }).length < 1100);
  assert.equal(shortenBundle(""), "");
});

test("jarvisFirst: the Jarvis project moves to the front, the rest keep their order", () => {
  const ps = [{ id: "a" }, { id: "b" }, { id: "j" }, { id: "c" }];
  assert.deepEqual(jarvisFirst(ps, (p) => p.id === "j").map((p) => p.id), ["j", "a", "b", "c"]);
  assert.deepEqual(jarvisFirst(ps, () => false).map((p) => p.id), ["a", "b", "j", "c"]);
});

test("rerunArgs: a project week, a report week, or nothing", () => {
  assert.deepEqual(rerunArgs({ week: "2026-10-05" }, "app"), ["--only", "app", "--week", "2026-10-05"]);
  for (const r of REPORTS) assert.deepEqual(rerunArgs({ week: "2026-10-05", report: r }, null), ["--report", r, "--week", "2026-10-05"]);
  assert.equal(rerunArgs({ week: "2026-10-05" }, null), null, "a project rerun needs the project");
  assert.equal(rerunArgs({ week: "last monday" }, "app"), null);
  assert.equal(rerunArgs({ week: "2026-10-05; rm -rf" }, "app"), null);
  assert.equal(rerunArgs(undefined, "app"), null);
});

test("failedBody: first line of the error and how to retry", () => {
  const b = failedBody("claude hit the time limit (20 min)\nstack…");
  assert.match(b, /time limit \(20 min\)/);
  assert.doesNotMatch(b, /stack/);
  assert.match(b, /Run again/);
});
