// Skill packs: was each required skill actually opened? (transcript check) — pure file reads, no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { skillUse, missingSkillsPrompt } from "../../agent/skillpacks.mjs";
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

test("requiredSkills: redesign adds the redesign skill; the browser check only with Playwright", () => {
  const full = { skills: Object.fromEntries(["taste-skill", "redesign-skill", "image-to-code-skill", "web-design-guidelines", "playwright-cli"].map((n) => [n, `/p/${n}/SKILL.md`])) };
  assert.deepEqual(requiredSkills({ site: true, kind: "redesign", pack: full, playwright: "playwright-cli" }), ["taste-skill", "redesign-skill", "image-to-code-skill", "web-design-guidelines", "playwright-cli"]);
  assert.deepEqual(requiredSkills({ site: true, kind: "new", pack: full, playwright: null }), ["taste-skill", "image-to-code-skill", "web-design-guidelines"]);
  assert.deepEqual(requiredSkills({ site: false, pack: { skills: { "test-driven-development": "/x" } } }), ["test-driven-development"]);
});
