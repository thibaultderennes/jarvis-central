// Build mode "Jarvis (Lugh)": the same build run as Goibniu, plus engineering skills from addyosmani/agent-skills
// (MIT), fetched at a pinned commit and loaded for that one run as the `jarvis-lugh` plugin (agent/skillpacks.mjs).
// The worker uses it for build runs (item builds, "Build it (PR)", sent-back PRs) of projects set to Lugh.
// Website runs keep their own pack (agent/website.mjs).
//
//   node lugh.mjs skills     fetch the pinned pack and print where it is
//   node lugh.mjs brief      print the prompt section a Lugh build run gets
import fs from "node:fs";
import path from "node:path";
import { preparePack } from "./skillpacks.mjs";

// Pinned so every install builds with the same skills; bump the commit in a tool release after reading the diff.
export const REPO = "addyosmani/agent-skills";
export const REF = "1401c8b8030e023baeebb31781a6653fe8e93026";
// The skills that fit a headless build run. Left out on purpose: the ones that interview the owner (interview-me,
// idea-refine, spec-driven-development, constraint-driven-development), need a browser MCP server
// (browser-testing-with-devtools), push or release (git-workflow-and-versioning, shipping-and-launch, ci-cd-and-automation),
// or plan rather than build (planning-and-task-breakdown, context-engineering, doubt-driven-development).
export const SKILLS = ["incremental-implementation", "test-driven-development", "debugging-and-error-recovery", "code-review-and-quality",
  "code-simplification", "documentation-and-adrs", "security-and-hardening", "frontend-ui-engineering"];
export const SOURCES = [{ repo: REPO, ref: REF, licence: "MIT", skills: Object.fromEntries(SKILLS.map((s) => [s, `skills/${s}`])), extra: { references: "references" } }];
export const PLUGIN_NAME = "jarvis-lugh";

/** The pack a Lugh build loads: { pluginDir, skills: {name: SKILL.md path} }. Throws when nothing could be fetched. */
export function prepareLughSkills() {
  const { pluginDir, skills, extra } = preparePack(PLUGIN_NAME, SOURCES, "Engineering skills for Jarvis (Lugh) build runs (pinned; see agent/lugh.mjs).");
  // Some skills link to the repo's shared checklists as ../../references/…: keep that path working inside the plugin.
  if (extra.references && fs.existsSync(extra.references)) {
    const dst = path.join(pluginDir, "references");
    fs.rmSync(dst, { recursive: true, force: true });
    fs.cpSync(extra.references, dst, { recursive: true });
  }
  return { pluginDir, skills };
}

/**
 * The extra instructions for a Lugh build run; worker.mjs appends them to its code-mode prompt.
 * `sentBack`: the owner sent the PR back with a note. `pack.skills` may be partial (a skill missing at the pin).
 */
export function lughBrief({ pack, sentBack = false }) {
  const sk = (n) => !pack ? `\`${n}\`` : pack.skills?.[n] ? `\`${n}\` (${pack.skills[n]})` : `\`${n}\` (not available this run: skip it)`;
  return `## Build mode: Jarvis (Lugh)
This project builds in Lugh mode: the same run and rules as above, plus engineering skills from ${REPO} (pinned), loaded as the \`${PLUGIN_NAME}\` plugin. Read each SKILL.md with Read when its step comes and follow it. Where a skill conflicts with the rules above, the rules win: no push, no PR, no questions to the owner (nobody is watching), no new dependencies (\`npm install\` is not available: name a needed package in your final message instead).

${sentBack ? `0. **The owner sent this back.** Start by reviewing the branch's diff against their note with ${sk("code-review-and-quality")}, then fix it in the steps below.
` : ""}1. **Plan in thin slices.** Follow ${sk("incremental-implementation")}: one small, working, committed step at a time.
2. **Tests first** for logic and bug fixes: ${sk("test-driven-development")}. Use the project's existing test runner and layout; if the project has none, say so in your final message rather than adding a framework.
3. **When a test, typecheck or build fails:** ${sk("debugging-and-error-recovery")}. Find the cause; don't skip or weaken the test.
4. **User interface changes:** ${sk("frontend-ui-engineering")}. The project's own DESIGN.md or UI rules win over the skill.
5. **Input handling, auth, stored data, external calls:** ${sk("security-and-hardening")}.
6. **Before you finish:** review your whole diff with ${sk("code-review-and-quality")}, then tidy what you touched, behaviour unchanged, with ${sk("code-simplification")}. Fix what they find and commit.
7. **Docs:** ${sk("documentation-and-adrs")}. Update the README, docs or changelog the project already keeps for what changed; write an ADR only for a real design decision, in the project's existing ADR folder if it has one.
8. Run the project's tests, typecheck and lint again at the end.

Final message, besides the usual: a line "Skills used:" naming the skills you actually followed, the tests you added, and the checks you ran with their result.`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd] = process.argv.slice(2);
  if (cmd === "skills") console.log(JSON.stringify(prepareLughSkills(), null, 2));
  else if (cmd === "brief") console.log(lughBrief({ pack: null }));
  else console.log("usage: node lugh.mjs skills | brief");
}
