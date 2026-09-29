#!/usr/bin/env node
// Installs the `jarvis` Claude Code skill (~/.claude/skills/jarvis/SKILL.md) from skills/jarvis/SKILL.md.template,
// and shows the block to add to ~/.claude/CLAUDE.md so every session knows about the dashboard.
//   node agent/install-skill.mjs            install the skill, print the CLAUDE.md block
//   node agent/install-skill.mjs --write    also insert/replace that block in ~/.claude/CLAUDE.md (between markers)
import fs from "node:fs";
import path from "node:path";
import { HOME, JARVIS_ROOT, CONFIG, PROJECTS_ROOT, loadConfig } from "./lib.mjs";

const site = (loadConfig().JARVIS_URL || CONFIG.site_url || "(your site URL)").replace(/\/+$/, "");
const fill = (t) => t.replaceAll("{{REPO}}", JARVIS_ROOT).replaceAll("{{SITE_URL}}", site).replaceAll("{{PROJECTS_ROOT}}", PROJECTS_ROOT);

const tpl = fs.readFileSync(path.join(JARVIS_ROOT, "skills", "jarvis", "SKILL.md.template"), "utf8");
const dest = path.join(HOME, ".claude", "skills", "jarvis", "SKILL.md");
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, fill(tpl));
console.log(`✓ skill installed: ${dest}`);

const START = "<!-- jarvis:start -->", END = "<!-- jarvis:end -->";
const block = `${START}
# Jarvis Central Dashboard
Project checklists live on Jarvis Central (${site}), not in files. Every folder under ${PROJECTS_ROOT} is a project.
Read and update checklists with \`node ${JARVIS_ROOT}/agent/jarvis.mjs\` (see the \`jarvis\` skill). At the start of a
session in a project folder, check \`jarvis inbox --project <id>\`; when you finish checklist work, mark it done there.
Headless runs started by the Jarvis worker or the weekly jobs already handle the inbox: skip the check there.
${END}`;

if (!process.argv.includes("--write")) {
  console.log(`\nAdd this to ~/.claude/CLAUDE.md (or re-run with --write to do it for you):\n\n${block}\n`);
} else {
  const f = path.join(HOME, ".claude", "CLAUDE.md");
  let cur = ""; try { cur = fs.readFileSync(f, "utf8"); } catch {}
  const re = new RegExp(`${START}[\\s\\S]*?${END}`);
  const next = re.test(cur) ? cur.replace(re, block) : (cur.trimEnd() ? cur.trimEnd() + "\n\n" : "") + block + "\n";
  fs.writeFileSync(f, next);
  console.log(`✓ ${re.test(cur) ? "updated" : "added"} the Jarvis block in ${f}`);
}
