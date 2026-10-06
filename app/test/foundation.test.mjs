import { test } from "node:test";
import assert from "node:assert/strict";
import { slugify as siteSlug, validateProjectName as siteValidate } from "../lib/newProject.ts";
import { detectFoundation, shouldRunSetup, validateProjectName, safeRelPath, appendSection, FOUNDATION_KEYS } from "../../agent/foundation.mjs";
import { slugify as agentSlug } from "../../agent/structure.mjs";

const NAMES = ["My App", "  Café Crème  ", "acme", "Project X", "a/b", ".hidden", "", "!!!", "x".repeat(61), "Über-Tool 2", "project"];

test("validateProjectName: site and worker agree on every name", () => {
  const taken = ["acme", "Existing-Folder"];
  for (const n of NAMES) assert.deepEqual(siteValidate(n, taken), validateProjectName(n, taken), n);
  for (const n of NAMES) assert.equal(siteSlug(n), agentSlug(n), n);
});

test("validateProjectName: slugified folder, refuses taken names, paths and empty names", () => {
  assert.deepEqual(validateProjectName("My App"), { id: "my-app", name: "My App" });
  assert.deepEqual(validateProjectName("  Café Crème "), { id: "cafe-creme", name: "Café Crème" });
  assert.equal(validateProjectName("project").id, "project");
  assert.match(validateProjectName("Acme", ["acme"]).error, /already exists/);
  assert.match(validateProjectName("existing folder", ["Existing-Folder"]).error, /already exists/);
  assert.match(validateProjectName("a/b").error, /path/);
  assert.match(validateProjectName(".git").error, /path/);
  assert.match(validateProjectName("").error, /Type a name/);
  assert.match(validateProjectName("!!!").error, /letter or digit/);
  assert.match(validateProjectName("x".repeat(61)).error, /60/);
});

test("detectFoundation: an empty folder misses everything; a complete one nothing", () => {
  assert.deepEqual(detectFoundation({}).missing, FOUNDATION_KEYS);
  const full = detectFoundation({
    files: ["PRD.md", "CLAUDE.md", "README.md", ".gitignore", ".env.example", "DESIGN.md", "docs/brand.md", "docs/architecture.md"],
    text: {
      "PRD.md": "# X\n## Problem\nPain.\n## Users\nOps leads.\n## Non-goals\n- none\n",
      "docs/architecture.md": "## Stack\nNext.js\n## Data and auth\nPostgres\n## Environments\nstaging, production\n",
    },
    deps: ["@sentry/nextjs"], remote: "git@github.com:someone/x.git",
  });
  assert.deepEqual(full.missing, []);
});

test("detectFoundation: a PRD without users or non-goals still misses value and non-goals", () => {
  const r = detectFoundation({ files: ["PRD.md"], text: { "PRD.md": "# X\n## Problem\nSomething\n## Scope\n" } });
  assert.ok(r.present.includes("prd"));
  assert.ok(r.missing.includes("value") && r.missing.includes("non-goals"));
});

const DAY = 86400_000, now = Date.parse("2026-10-06T12:00:00Z");
const ago = (d) => new Date(now - d * DAY).toISOString();
const fp = (o = {}) => ({ missing: ["readme"], docs: "d1", head: "h1", ...o });

test("shouldRunSetup: a project never set up runs once on load (unless switched off)", () => {
  assert.equal(shouldRunSetup(null, fp(), { now }).trigger, "load");
  assert.equal(shouldRunSetup(null, fp(), { now, autoOnLoad: false }).run, false);
});

test("shouldRunSetup: an update needs a gap no earlier run handled, a change in the folder and the cooldown", () => {
  const rec = { status: "done", at: ago(10), handled: ["readme"], missing: ["readme"], docs: "d1", head: "h1" };
  assert.equal(shouldRunSetup(rec, fp({ head: "h2" }), { now }).run, false, "gap already handled: a new commit alone doesn't re-run");
  assert.equal(shouldRunSetup(rec, fp({ missing: ["readme", "prd"] }), { now }).run, false, "new gap but folder unchanged");
  const d = shouldRunSetup(rec, fp({ missing: ["readme", "prd"], docs: "d2" }), { now });
  assert.equal(d.run, true); assert.equal(d.trigger, "update"); assert.deepEqual(d.gaps, ["prd"]);
  assert.equal(shouldRunSetup({ ...rec, at: ago(2) }, fp({ missing: ["prd"], head: "h2" }), { now }).run, false, "cooldown");
  assert.equal(shouldRunSetup(rec, fp({ missing: [], head: "h2" }), { now }).reason, "foundation complete");
  assert.equal(shouldRunSetup(rec, fp({ missing: ["prd"], head: "h2" }), { now, autoOnUpdate: false }).run, false);
});

test("shouldRunSetup: a queued or running run blocks, until it is stale", () => {
  assert.equal(shouldRunSetup({ status: "running", at: ago(0.01) }, fp(), { now }).run, false);
  assert.equal(shouldRunSetup({ status: "running", at: ago(8), handled: [] }, fp(), { now }).run, true);
});

test("safeRelPath: only plain paths inside the project, no secrets or git internals", () => {
  assert.equal(safeRelPath("docs/BRAND.md"), "docs/BRAND.md");
  assert.equal(safeRelPath("./README.md"), "README.md");
  assert.equal(safeRelPath(".env.example"), ".env.example");
  for (const bad of ["../x.md", "/etc/passwd", ".env", ".env.local", ".git/config", "a//b", "node_modules/x/README.md", "keys/server.pem", ""]) assert.equal(safeRelPath(bad), null, bad);
});

test("appendSection: adds at the end, never twice, never changes what is there", () => {
  const prd = "# X\n## Problem\nP\n";
  const next = appendSection(prd, "## Non-goals\n- a");
  assert.ok(next.startsWith(prd));
  assert.match(next, /## Non-goals\n- a\n$/);
  assert.equal(appendSection(next, "## Non-goals\n- b"), null);
  assert.equal(appendSection(prd, "  "), null);
});
