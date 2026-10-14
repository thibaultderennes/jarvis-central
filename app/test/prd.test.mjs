import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findPrd, parseMilestones, readStructure } from "../../agent/structure.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "prd-"));

test("findPrd: the root PRD.md wins over docs/PRD.md", () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, "docs"));
  fs.writeFileSync(path.join(dir, "docs", "PRD.md"), "# docs");
  assert.equal(findPrd(dir), path.join(dir, "docs", "PRD.md"));
  fs.writeFileSync(path.join(dir, "PRD.md"), "# root");
  assert.equal(findPrd(dir), path.join(dir, "PRD.md"));
});

test("findPrd: null when the project has no PRD", () => {
  assert.equal(findPrd(tmp()), null);
});

test("readStructure reads milestones from docs/PRD.md", () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, "docs"));
  fs.writeFileSync(path.join(dir, "docs", "PRD.md"), "## Milestones\n| Date | Milestone |\n|---|---|\n| 2026-10-30 | MVP |\n");
  const st = readStructure(dir);
  assert.deepEqual(st.milestones, [{ date: "2026-10-30", label: "MVP" }]);
});

test("parseMilestones: inline dates are not a table (sync then warns instead of updating)", () => {
  assert.deepEqual(parseMilestones("## Milestones\n`m1` 2026-10-30 MVP · `m2` 2026-11-20 20 users\n"), []);
});
