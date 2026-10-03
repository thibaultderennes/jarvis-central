// Monday advisor runs: CEO / CMO / PO personas applied to each project, plus a synthesis.
// Persona lookup, most specific first:
//   1. <project>/personas/<role>.md
//   2. <project>/.claude/commands/*-<role>.md  or  <project>/.claude/skills/*-<role>/SKILL.md  (`$file:` includes resolved)
//   3. ~/.claude/commands/<project-id>-<role>.md  (user-level command named after the project)
//   4. the tool's generic personas/<role>.md
import fs from "node:fs";
import path from "node:path";
import { HOME, JARVIS_ROOT, CONFIG, OWNER } from "./lib.mjs";

export const ALL_ROLES = [
  { key: "ceo", label: "CEO · strategy" },
  { key: "cmo", label: "CMO · growth" },
  { key: "po", label: "PO · product & tech" },
];
const wanted = (CONFIG.reviews?.advisors || ["ceo", "cmo", "po"]).map((r) => String(r).toLowerCase());
export const ROLES = ALL_ROLES.filter((r) => wanted.includes(r.key));
export const STANCE = CONFIG.reviews?.stance || "Be sceptical by default. Challenge optimistic plans with evidence; validate only what the evidence supports.";

export const ADVISOR_TOOLS = ["Read", "Grep", "Glob", "WebSearch", "WebFetch", "Bash(git log:*)", "Bash(git show:*)", "Bash(gh pr list:*)", "Bash(gh pr view:*)", "Bash(gh run list:*)"];

function readPersona(file) {
  let text = fs.readFileSync(file, "utf8");
  // skill/command wrappers may use `$file:<path>` includes: try relative to the file, then to its project root
  text = text.replace(/^\$file:(.+)$/gm, (_, rel) => {
    for (const base of [path.dirname(file), path.resolve(path.dirname(file), ".."), path.resolve(path.dirname(file), "../..", ".."), path.resolve(path.dirname(file), "../..")]) {
      try { return fs.readFileSync(path.resolve(base, rel.trim()), "utf8"); } catch {}
    }
    return "";
  });
  return text.replace(/^---\n[\s\S]*?\n---\n/, ""); // drop skill frontmatter
}
function globRole(dir, role, kind) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    if (kind === "commands") return entries.filter((e) => e.isFile() && e.name.toLowerCase().endsWith(`-${role}.md`)).map((e) => path.join(dir, e.name));
    return entries.filter((e) => e.isDirectory() && e.name.toLowerCase().endsWith(`-${role}`)).map((e) => path.join(dir, e.name, "SKILL.md"));
  } catch { return []; }
}

/** Persona text for a project + role. `native` = written for this project (no adaptation preamble needed). */
export function personaFor(project, role) {
  const tries = [];
  if (project.dir) {
    tries.push([path.join(project.dir, "personas", `${role}.md`), true]);
    for (const f of globRole(path.join(project.dir, ".claude", "commands"), role, "commands")) tries.push([f, true]);
    for (const f of globRole(path.join(project.dir, ".claude", "skills"), role, "skills")) tries.push([f, true]);
  }
  tries.push([path.join(HOME, ".claude", "commands", `${project.id}-${role}.md`), true]);
  tries.push([path.join(JARVIS_ROOT, "personas", `${role}.md`), false]);
  for (const [file, native] of tries) {
    try { const text = readPersona(file); if (text.trim()) return { text, source: file, native }; } catch {}
  }
  throw new Error(`no ${role} persona found for ${project.id} (expected ${path.join(JARVIS_ROOT, "personas", role + ".md")})`);
}

/** One-liner from the project's CLAUDE.md ("## One-liner" section, else first prose line). */
export function oneLiner(dir) {
  if (!dir) return "";
  let md = "";
  try { md = fs.readFileSync(path.join(dir, "CLAUDE.md"), "utf8"); } catch { return ""; }
  const lines = md.split("\n");
  const i = lines.findIndex((l) => /^#+\s*one[- ]liner/i.test(l));
  const pick = (from) => lines.slice(from).find((l) => l.trim() && !l.startsWith("#") && !l.startsWith(">") && !l.startsWith("```"));
  return ((i >= 0 ? pick(i + 1) : pick(0)) || "").trim().slice(0, 300);
}

/** Memory dirs Claude may read: the home folder's and the project's own (~/.claude/projects/<escaped path>/memory). */
export function memoryDirs(dir) {
  const esc = (p) => p.replace(/[/.]/g, "-");
  const out = [path.join(HOME, ".claude/projects", esc(HOME), "memory")];
  if (dir) out.push(path.join(HOME, ".claude/projects", esc(dir), "memory"));
  return [...new Set(out)].filter((d) => fs.existsSync(d));
}

const FOCUS = {
  ceo: `Your report covers strategy, competition, unit economics and costs, and speed against the deadlines. You also own the **## Audit** section: security, quality, cost and process findings from the pull requests, CI (\`gh run list\`), npm audit counts and code you read, each tagged **CRIT** / **HIGH** / **MED** / **LOW**, only when backed by evidence.`,
  cmo: `Your report covers growth: audience, channels, messaging, launch readiness and content cadence. Say what marketing actually happened this week (evidence from the bundle), what should have, and realistic benchmarks for this project's channels (cite sources with dates).`,
  po: `Your report covers product and tech: what shipped against the checklist, scope creep, quality and tech debt, tests, and the next build steps. Include checklist hygiene: overdue items, stale in-progress items, items to cut, split or re-date (use item codes).`,
};

export function advisorPrompt({ p, role, W, file, persona, line, prevHeadline }) {
  const where = `${p.name} (${p.id}${p.dir ? `, ${p.dir}` : ""})${line ? ` — ${line}` : ""}`;
  const adapt = persona.native
    ? `The persona above was written for this project.`
    : `The persona above is Jarvis's generic advisor: apply its method to THIS project, using this project's own market, competitors, costs and channels (read its PRD.md and CLAUDE.md).`;
  return `${persona.text}

---
# Headless Monday review — ${role.toUpperCase()}
Headless Monday review for project ${where}, week ${W.startDate}..${W.lastDate}. ${adapt}
You can't ask ${OWNER} anything: turn every "stop and ask" or open decision into an entry in "## Questions for you". Tools the persona may mention that aren't available here (memory graphs, spreadsheets, dashboards): skip them and use the bundle, the project's PRD.md, CLAUDE.md and docs/, memory files under ~/.claude/projects/*/memory/ and the previous review instead. Web research: allowed (WebSearch/WebFetch), cite sources with dates. Never invent numbers.
Stance: ${STANCE}

Read the bundle first: ${file} (checklist state and changes, product metrics snapshots (users, active users, visits, revenue: cite them with their date when they bear on your advice) and recurring costs, git commits, pull requests with CI, npm audit counts, Claude Code session stats, the owner's messages this week, last week's review${prevHeadline ? ` — last headline: "${prevHeadline}"` : ""}).

${FOCUS[role]}

Write your review in your persona's voice and format, adapted to a weekly review, under ~900 words. Use "## " headings. It must start with "## Verdict" (two sentences) and end with "## Top 3 for this week" (each tied to a checklist code in backticks or marked "new item:") and "## Questions for you".

Output ONLY one JSON object, no prose before or after, no code fences:
{"verdict": "on-track" | "at-risk" | "off-track", "headline": "<one sentence, max 120 chars>", "body_md": "<markdown>"}`;
}

export function synthesisPrompt({ p, W, reports, meta }) {
  const parts = reports.map((r) => `### ${r.label}${r.error ? " — FAILED" : ` — [${r.verdict}] ${r.headline}`}\n\n${r.error ? `(This advisor's run failed: ${r.error})` : r.body_md}`).join("\n\n---\n\n");
  return `${reports.length} advisors (${reports.map((r) => r.label.split(" ")[0]).join(", ")}) reviewed the project "${p.name}" for the week ${W.startDate}..${W.lastDate}. Numbers for the week: ${JSON.stringify(meta)}.
Synthesise their reports for ${OWNER}. Stance: ${STANCE} Use only what the reports say; don't add new facts or numbers.

body_md sections, as "## " headings:
## Where they agree
## Where they disagree — name who says what, and say which side the evidence favours.
## Top 3 for this week — each with a checklist code in backticks or "new item:".
## Questions for you — merged and de-duplicated from all three.

Output ONLY one JSON object, no prose before or after, no code fences:
{"verdict": "on-track" | "at-risk" | "off-track", "headline": "<overall, one sentence, max 120 chars>", "body_md": "<markdown>"}

# The reports

${parts}`;
}
