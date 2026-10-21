// Skill packs: was each required skill actually opened? (transcript check) — pure file reads, no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { skillUse, missingSkillsPrompt, REVIEW_SOURCES, REVIEW_SETS, HEADLESS, reviewSet, reviewSkillsBrief, missingReviewSkillsPrompt, wordCount } from "../../agent/skillpacks.mjs";
import { requiredSkills } from "../../agent/worker.mjs";

const pack = { skills: { "taste-skill": "/p/skills/taste-skill/SKILL.md", "redesign-skill": "/p/skills/redesign-skill/SKILL.md", "playwright-cli": "/p/skills/playwright-cli/SKILL.md" } };
const line = (name, input) => JSON.stringify({ message: { role: "assistant", content: [{ type: "tool_use", name, input }] } });

test("skillUse: a Read of the SKILL.md or a Skill call counts; the rest is missing", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "skills-")), prev = process.env.HOME;
  fs.mkdirSync(path.join(home, ".claude", "projects", "-w"), { recursive: true });
  fs.writeFileSync(path.join(home, ".claude", "projects", "-w", "s1.jsonl"), [line("Read", { file_path: "/p/skills/playwright-cli/SKILL.md" }), line("Skill", { skill: "jarvis-website:taste-skill" }), line("Read", { file_path: "/elsewhere/x.md" })].join("\n"));
  process.env.HOME = home;
  try {
    assert.deepEqual(skillUse("s1", pack), { used: ["taste-skill", "playwright-cli"], missing: ["redesign-skill"], found: true });
    assert.equal(skillUse("nope", pack).found, false, "no transcript: nothing reported missing");
  } finally { process.env.HOME = prev; }
});

test("missingSkillsPrompt names each skipped skill with its path", () => {
  const p = missingSkillsPrompt(pack, ["redesign-skill"]);
  assert.match(p, /redesign-skill: `\/p\/skills\/redesign-skill\/SKILL\.md`/);
  assert.match(p, /Skills used/);
});

test("reviews pack: every set's skill is pinned at a full commit; stop-slop is on every report, last", () => {
  const pinned = new Set(REVIEW_SOURCES.flatMap((s) => Object.keys(s.skills)));
  for (const s of REVIEW_SOURCES) { assert.match(s.ref, /^[0-9a-f]{40}$/, s.repo); assert.equal(s.licence, "MIT", s.repo); }
  for (const [kind, set] of Object.entries(REVIEW_SETS)) {
    for (const n of set) assert.ok(pinned.has(n), `${kind}: ${n} is pinned`);
    assert.equal(set.at(-1), "stop-slop", `${kind} ends with stop-slop`);
  }
  assert.deepEqual(REVIEW_SETS.synthesis, ["strategy-red-team", "stop-slop"]);
  assert.ok(REVIEW_SETS.ceo.includes("gstack-openclaw-ceo-review") && REVIEW_SETS.po.includes("north-star-metric"));
});

test("reviewSkillsBrief: only the skills the pack has, with their paths; nothing without a pack", () => {
  const rp = { skills: { "stop-slop": "/r/skills/stop-slop/SKILL.md", "strategy-red-team": "/r/skills/strategy-red-team/SKILL.md" } };
  assert.equal(reviewSkillsBrief("synthesis", null), "");
  assert.deepEqual(reviewSet("po", rp), ["stop-slop"], "north-star-metric missing at the pin: left out");
  const b = reviewSkillsBrief("synthesis", rp);
  assert.match(b, /strategy-red-team.*\/r\/skills\/strategy-red-team\/SKILL\.md.*Fails if.*Kill criterion.*Cheapest test/s);
  assert.match(b, /draft_words/);
  assert.match(missingReviewSkillsPrompt(rp, ["stop-slop"]), /stop-slop: `\/r\/skills\/stop-slop\/SKILL\.md`[\s\S]*JSON object again/);
  assert.match(HEADLESS, /don't ask, decide and note it/);
});

test("wordCount: words in markdown, a link counts as its label, bare symbols don't count", () => {
  assert.equal(wordCount("## Verdict\nShip `b-x` now — see [the PR](https://example.com/pr/1)."), 7);
  assert.equal(wordCount(""), 0);
  assert.equal(wordCount(null), 0);
});

test("requiredSkills: redesign adds the redesign skill; the browser check only with Playwright", () => {
  const full = { skills: Object.fromEntries(["taste-skill", "redesign-skill", "image-to-code-skill", "web-design-guidelines", "playwright-cli"].map((n) => [n, `/p/${n}/SKILL.md`])) };
  assert.deepEqual(requiredSkills({ site: true, kind: "redesign", pack: full, playwright: "playwright-cli" }), ["taste-skill", "redesign-skill", "image-to-code-skill", "web-design-guidelines", "playwright-cli"]);
  assert.deepEqual(requiredSkills({ site: true, kind: "new", pack: full, playwright: null }), ["taste-skill", "image-to-code-skill", "web-design-guidelines"]);
  assert.deepEqual(requiredSkills({ site: false, pack: { skills: { "test-driven-development": "/x" } } }), ["test-driven-development"]);
});
