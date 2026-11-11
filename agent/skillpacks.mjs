// Skill packs: third-party Claude Code skills fetched at pinned commits into the cache and bundled as a local plugin,
// loaded for one headless run with `claude --plugin-dir` (runClaude's `pluginDirs`). Nothing is installed user-wide.
// Used by website builds (website.mjs); other runs declare their own SOURCES the same way. The reviews pack (advisor
// reports, synthesis, recap, coaching, Jarvis review in weekly.mjs) is pinned here.
//
//   node skillpacks.mjs reviews      fetch the pinned reviews pack and print where it is
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cacheDir, makeLog } from "./lib.mjs";

const log = makeLog("skillpacks");
const git = (dir, ...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 180_000 }).trim();

/** One repo at its pinned commit under the cache (shallow fetch of that commit only). */
export function fetchPinned({ repo, ref }) {
  const dir = path.join(cacheDir("skillpacks", "repos"), repo.replace("/", "__"));
  let head = null;
  try { head = git(dir, "rev-parse", "HEAD"); } catch {}
  if (head === ref) return dir;
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q");
  git(dir, "remote", "add", "origin", `https://github.com/${repo}.git`);
  git(dir, "fetch", "-q", "--depth", "1", "origin", ref);
  git(dir, "checkout", "-q", "FETCH_HEAD");
  return dir;
}

/**
 * Builds the plugin `name` from `sources`: [{repo, ref, skills?: {skillName: "path/in/repo"}, extra?: {key: "path/in/repo"}}].
 * `skills` are copied into the plugin; `extra` paths (reference libraries the run reads) are returned as absolute paths.
 * Returns { pluginDir, skills: {name: SKILL.md path}, extra: {key: dir} }. Throws when no skill could be fetched.
 */
export function preparePack(name, sources, description = "") {
  const pluginDir = cacheDir("skillpacks", "plugins", name);
  const skillsDir = path.join(pluginDir, "skills");
  fs.rmSync(skillsDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(pluginDir, ".claude-plugin"), { recursive: true });
  fs.writeFileSync(path.join(pluginDir, ".claude-plugin", "plugin.json"), JSON.stringify({ name, version: "1.0.0", description: description || `Skills for Jarvis ${name} runs (pinned; see agent/skillpacks.mjs).` }, null, 2));
  const skills = {}, extra = {};
  for (const s of sources) {
    let dir;
    try { dir = fetchPinned(s); } catch (e) { log("fetch failed", s.repo, e.message.split("\n")[0]); continue; }
    for (const [key, rel] of Object.entries(s.extra || {})) extra[key] = path.join(dir, rel);
    for (const [skill, rel] of Object.entries(s.skills || {})) {
      const src = path.join(dir, rel);
      if (!fs.existsSync(path.join(src, "SKILL.md"))) { log("skill missing at the pinned commit", s.repo, rel); continue; }
      fs.cpSync(src, path.join(skillsDir, skill), { recursive: true, filter: (f) => path.basename(f) !== ".git" }); // a skill may sit at the repo root
      skills[skill] = path.join(skillsDir, skill, "SKILL.md");
    }
  }
  if (!Object.keys(skills).length) throw new Error(`none of the ${name} skills could be fetched`);
  return { pluginDir, skills, extra };
}

/**
 * Which of `required` skills a finished run actually opened: a Read of the skill's SKILL.md (or any file in its folder)
 * or a Skill tool call for it, found in the run's Claude Code transcript (~/.claude/projects/<cwd>/<session>.jsonl).
 * Returns { used, missing, found } — found=false when the transcript couldn't be read (then nothing is reported missing).
 */
export function skillUse(sessionId, pack, required = Object.keys(pack?.skills || {})) {
  const out = { used: [], missing: [], found: false };
  if (!sessionId || !pack) return out;
  const root = path.join(os.homedir(), ".claude", "projects");
  let file = null;
  try { for (const d of fs.readdirSync(root)) { const f = path.join(root, d, `${sessionId}.jsonl`); if (fs.existsSync(f)) { file = f; break; } } } catch {}
  if (!file) return out;
  out.found = true;
  const seen = new Set();
  const dirs = Object.fromEntries(Object.entries(pack.skills).map(([n, p]) => [n, path.dirname(p)]));
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.includes("tool_use")) continue;
    let d; try { d = JSON.parse(line); } catch { continue; }
    for (const c of d.message?.content || []) {
      if (c?.type !== "tool_use") continue;
      const i = c.input || {};
      if (c.name === "Skill") { const s = String(i.skill || i.command || "").split(":").pop(); if (dirs[s]) seen.add(s); }
      const fp = String(i.file_path || i.path || "");
      if (fp) for (const [n, dir] of Object.entries(dirs)) if (fp.startsWith(dir + path.sep)) seen.add(n);
    }
  }
  out.used = required.filter((n) => seen.has(n));
  out.missing = required.filter((n) => pack.skills[n] && !seen.has(n));
  return out;
}

/** The follow-up turn for a run that skipped skills: read them now and let them change the work. */
export const missingSkillsPrompt = (pack, missing) => `You finished without opening these skills, which this run was required to use:
${missing.map((n) => `- ${n}: \`${pack.skills[n]}\``).join("\n")}
Read each SKILL.md in full now and apply it to the work already on this branch: its rules must visibly change the result (code, copy, layout, tests or docs), not just be acknowledged. Commit what changes. Then end with your full final message again, including a "## Skills used" section: each skill, and the concrete change it led to.`;

/* ---------------- the reviews pack ---------------- */
// Pinned so every install writes its reviews with the same skills; bump a commit in a tool release after reading the
// diff. All MIT (LICENSE at each repo root). Skill names are the SKILL.md frontmatter names, so a Skill tool call matches.
export const REVIEW_SOURCES = [
  { repo: "hardikpandya/stop-slop", ref: "8da1f030185bdfe8471220585162991eaeb970e9", licence: "MIT",
    skills: { "stop-slop": "." } },                                                   // AI writing patterns out; the skill is the repo
  { repo: "phuryn/pm-skills", ref: "c68487d721e419ec87af1ae6412a842978eab785", licence: "MIT",
    skills: {
      "strategy-red-team": "pm-execution/skills/strategy-red-team",                    // "fails if", kill criterion, cheapest test
      "north-star-metric": "pm-marketing-growth/skills/north-star-metric",             // the game, one metric, 3-5 inputs
    } },
  { repo: "garrytan/gstack", ref: "47d639abffa882b8cbb641d7d1dedf08ecada9ec", licence: "MIT",
    skills: { "gstack-openclaw-ceo-review": "openclaw/skills/gstack-openclaw-ceo-review" } }, // four scope modes, what to cut
];
export const REVIEW_PLUGIN_NAME = "jarvis-reviews";

/** One set per report; stop-slop on every report, as the last pass. */
export const REVIEW_SETS = {
  ceo: ["gstack-openclaw-ceo-review", "stop-slop"],
  cmo: ["stop-slop"],
  po: ["north-star-metric", "stop-slop"],
  synthesis: ["strategy-red-team", "stop-slop"],
  recap: ["stop-slop"],
  coaching: ["stop-slop"],
  jarvis: ["stop-slop"],
};

/** In every review prompt, pack or not: the run is headless. */
export const HEADLESS = `Headless: don't ask, decide and note it. Wherever a skill or the persona says to ask, confirm, offer options or wait for a choice, make the call yourself and note it in one line ("Decided: …").`;

/** How each skill applies to a headless review that returns one JSON object. */
const REVIEW_HOW = {
  "gstack-openclaw-ceo-review": `Pick one of its four modes (SCOPE EXPANSION, SELECTIVE EXPANSION, HOLD SCOPE, SCOPE REDUCTION) for this project now, and name it with the reason in "## Verdict". Add "## Stop": the one thing to stop (a checklist code, a habit or a feature) and why. Its interactive steps (choosing an approach, one question per issue, opt-in per idea, saving to memory/) don't apply here: decide, note it, write nothing to disk.`,
  "north-star-metric": `Add "## North star": the game (attention, transaction or productivity), the one north star metric, 3-5 input metrics, and whether the bundle's product numbers measure it today (cite the snapshot and its date, or say it isn't measured and what would measure it).`,
  "strategy-red-team": `Add "## Red team" after the Top 3: the 1-3 load-bearing assumptions behind it, each as **Fails if** …, **Kill criterion** … and **Cheapest test** (one that fits in this week). Use only what the reports say; if the plan holds up, say so. Skip its optional second-model step.`,
  "stop-slop": `The last pass, once the draft is done: apply its rules to "headline" and "body_md" (filler, formulaic structures, passive voice, vague claims, em dashes). Keep every fact, number, link, checklist code and required heading. Add "draft_words" to the JSON object: the word count of body_md before this pass.`,
};

/** The reviews pack: { pluginDir, skills }. Throws when nothing could be fetched. */
export function prepareReviewSkills() {
  return preparePack(REVIEW_PLUGIN_NAME, REVIEW_SOURCES, "Writing and strategy skills for Jarvis reviews (pinned; see agent/skillpacks.mjs).");
}

/** The skills of `kind`'s set that the pack actually has. */
export const reviewSet = (kind, pack) => (REVIEW_SETS[kind] || []).filter((n) => pack?.skills?.[n]);

/** The prompt section for one review run ("" without a pack). */
export function reviewSkillsBrief(kind, pack) {
  const names = reviewSet(kind, pack);
  if (!names.length) return "";
  return `## Skills for this report
Read each SKILL.md in full before you write (Read the path, or use the Skill tool), then apply it as said here:
${names.map((n) => `- **${n}** (\`${pack.skills[n]}\`): ${REVIEW_HOW[n]}`).join("\n")}`;
}

/** Follow-up turn for a review that answered without opening its skills: same session, JSON again. */
export const missingReviewSkillsPrompt = (pack, missing) => `You answered without opening these skills, which this report must use:
${missing.map((n) => `- ${n}: \`${pack.skills[n]}\`: ${REVIEW_HOW[n]}`).join("\n")}
Read each SKILL.md in full now and apply it to your report (it must change the report, not just be acknowledged). Then output the full JSON object again, revised, and nothing else.`;

/** Words in a markdown text (a link counts as its label). */
export const wordCount = (md) => String(md || "").replace(/\]\([^)]*\)/g, "]").split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd] = process.argv.slice(2);
  if (cmd === "reviews") {
    const pack = prepareReviewSkills();
    console.log(pack.pluginDir);
    for (const [n, f] of Object.entries(pack.skills)) console.log(n.padEnd(28), f);
    for (const [kind, set] of Object.entries(REVIEW_SETS)) console.log(kind.padEnd(10), set.join(", "));
  } else console.log("usage: node skillpacks.mjs reviews");
}
