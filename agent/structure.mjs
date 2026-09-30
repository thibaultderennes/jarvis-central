// The structure every project folder is expected to have (docs/conventions.md), and the checklist items that create
// whatever is missing. Pure: no API calls, no side effects on import. Used by projects.mjs and planproject.mjs.
import fs from "node:fs";
import path from "node:path";

export const DEFAULT_SECTIONS = [
  { id: "decide", name: "Decide", note: "Only you can make these calls; write your answer in the note box", notes: true },
  { id: "build", name: "Build", note: "Set to in progress = go for Claude. Nothing merges without you", owner_default: "claude" },
  { id: "launch", name: "Launch", note: "Everything the next milestone needs besides code" },
  { id: "later", name: "Later", note: "Parked on purpose" },
];

export const slugify = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project";
const read = (f) => { try { return fs.readFileSync(f, "utf8"); } catch { return null; } };

/** `| 2026-11-02 | Public launch |` rows under a Milestones heading (or anywhere) → deadlines. */
export function parseMilestones(prd) {
  if (!prd) return [];
  const out = [];
  for (const line of prd.split("\n")) {
    const m = line.match(/^\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*([^|]+?)\s*\|/);
    if (m && !/\{\{/.test(m[2])) out.push({ date: m[1], label: m[2].replace(/\*\*/g, "").slice(0, 80) });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** What a project folder has of the expected structure: PRD.md at the root, "How we work" in CLAUDE.md, audit prompts. */
export function readStructure(dir) {
  const claude = read(path.join(dir, "CLAUDE.md"));
  const prd = read(path.join(dir, "PRD.md"));
  const auditDir = path.join(dir, "docs", "audits");
  let audits = [];
  try { audits = fs.readdirSync(auditDir).filter((f) => !f.startsWith(".")).sort(); } catch {}
  return {
    claude, prd, milestones: parseMilestones(prd), audits,
    hasHowWeWork: !!claude && /^#{1,3}\s+How we work\b/im.test(claude),
    hasAuditPrompts: audits.includes("PROMPTS.md"),
  };
}

/**
 * Which existing section plays which part. `decide`: the owner's calls (id "decide", else the first with a note box).
 * `build`: Claude's work (id "build", else the first whose owner defaults to claude). `other`: the owner's non-decision
 * work. Always ids of sections the project already has; never a new one.
 */
export function sectionRoles(sections) {
  const list = sections?.length ? sections : DEFAULT_SECTIONS;
  const byId = (id) => list.find((s) => s.id === id);
  const decide = byId("decide") || list.find((s) => s.notes) || list[0];
  const build = byId("build") || list.find((s) => s.owner_default === "claude") || list[0];
  const other = list.find((s) => s !== decide && s !== build && !s.notes && s.owner_default !== "claude") || list[0];
  return { ids: new Set(list.map((s) => s.id)), list, decide: decide.id, build: build.id, other: other.id };
}

/**
 * Checklist items that create the missing pieces instead of planning without them. Fixed ids, so a second plan run
 * never adds them twice (an item with the same id, done or not, counts as already there).
 */
export function setupItems(st, { project, roles, jarvisRoot, existingIds }) {
  const tpl = (f) => path.join(jarvisRoot, "templates", f);
  const scaffold = `node ${path.join(jarvisRoot, "agent", "projects.mjs")} scaffold --only ${project.id}`;
  const out = [];
  if (!st.prd) out.push({
    id: "prd", section: roles.decide, owner: "founder", priority: 1, critical: true, estimate_minutes: 90,
    title: "Write PRD.md: who it's for, scope, and dated milestones",
    detail: `No PRD.md at the repo root, so there is no roadmap to plan against and no deadlines from the file.
1. Draft it from the folder: \`${scaffold}\` (never overwrites; unknowns become TODO(owner)).
2. Answer every TODO(owner): audience, the problem, what's in and out of scope, non-negotiables.
3. Fill the Milestones table (\`| YYYY-MM-DD | milestone |\`): it becomes the project's deadlines on the dashboard.
4. Commit it on a branch, then press "Plan this project" again.`,
  });
  else if (!st.milestones.length) out.push({
    id: "prd-milestones", section: roles.decide, owner: "founder", priority: 1, critical: true, estimate_minutes: 30,
    title: "Date the milestones in PRD.md",
    detail: `PRD.md has no dated Milestones table, so the checklist has no deadlines to aim at.
1. Add a "## Milestones" table with one row per milestone: \`| YYYY-MM-DD | what is true by then |\` (see ${tpl("PRD.md")}).
2. Run \`node ${path.join(jarvisRoot, "agent", "projects.mjs")} sync\` so the dashboard picks the dates up.`,
  });
  if (!st.hasHowWeWork) out.push({
    id: "how-we-work", section: roles.build, owner: "claude", priority: 2, critical: false, estimate_minutes: 30,
    title: `Add a "How we work" section to CLAUDE.md`,
    detail: `${st.claude ? "CLAUDE.md has no \"How we work\" section" : "There is no CLAUDE.md"}, so sessions here don't know the working rules.
1. ${st.claude ? "Add" : `Draft CLAUDE.md first (\`${scaffold}\`), then add`} the "How we work" section from ${tpl("CLAUDE.md")}.
2. Fill it for this project: the checklist on Jarvis Central (project id \`${project.id}\`), the loop rule (an item in "${roles.build}" set to in progress is the go; branch + PR; nothing merges on its own), the 3-day audit, and PRD.md as the source of the milestones.
3. Open a PR; the owner merges.`,
  });
  if (!st.hasAuditPrompts) out.push({
    id: "audit-prompts", section: roles.build, owner: "claude", priority: 2, critical: false, estimate_minutes: 45,
    title: "Create docs/audits/PROMPTS.md (the 3-day audit)",
    detail: `No docs/audits/PROMPTS.md, so nothing checks this project for legal and security regressions.
1. Copy ${tpl("audits-PROMPTS.md")} to docs/audits/PROMPTS.md.
2. List what is known and intentional here (so the audit doesn't flag it), citing files.
3. Open a PR; the owner merges, then schedules the audit every 3 days (a Claude Code routine) or runs it by hand.`,
  });
  return out.filter((i) => !existingIds.has(i.id));
}
