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
const MS_ROW = /^\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*([^|]+?)\s*\|/;
const msLabel = (raw) => raw.replace(/\*\*/g, "").slice(0, 80);
export function parseMilestones(prd) {
  if (!prd) return [];
  const out = [];
  for (const line of prd.split("\n")) {
    const m = line.match(MS_ROW);
    if (m && !/\{\{/.test(m[2])) out.push({ date: m[1], label: msLabel(m[2]) });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Milestones moved on the dashboard carry `prd`: the date PRD.md still has. Rewrites the date cell of each matching
 * row (same old date + label) in place, leaving the rest of the file alone. Returns the new text and what didn't match.
 */
export function moveMilestoneRows(prd, deadlines) {
  const moves = (deadlines || []).filter((d) => d?.prd && d.prd !== d.date);
  const left = [...moves];
  const text = prd.split("\n").map((line) => {
    const m = line.match(MS_ROW);
    const i = m ? left.findIndex((d) => d.prd === m[1] && d.label === msLabel(m[2])) : -1;
    if (i < 0) return line;
    const [d] = left.splice(i, 1);
    return line.replace(m[1], d.date);
  }).join("\n");
  return { text, moved: moves.length - left.length, unmatched: left };
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

/** Lower-case words only, accents and punctuation dropped: "Write PRD.md" → "write prd md". */
export const normTitle = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

// What an item the owner wrote by hand looks like when it already covers a setup item (matched on the normalised title).
// Anchored at the start so an item that only mentions the file ("Plan: don't add the PRD item when …") doesn't count.
const PRD = /^(write|draft|create|add|start|finish)( \w+){0,2} prd\b|^prd\b/;
const SETUP_MATCH = {
  prd: PRD,
  "prd-milestones": new RegExp(`${PRD.source}|^(date|add|write|set|fill)\\b.*\\bmilestones?\\b.*\\bprd\\b`),
  "how-we-work": /^(add|write|create|draft|fill)?\b.*\bhow we work\b/,
  "audit-prompts": /^(add|write|create|draft|set up|copy)\b.*\baudits?\b.*\bprompts?\b|^audits? prompts?\b/,
};

/** Does an existing item (open or done; cancelled ones don't count) already cover this setup item by its title? */
export const coveredByTitle = (id, items = []) =>
  !!SETUP_MATCH[id] && items.some((i) => i && i.status !== "cancelled" && SETUP_MATCH[id].test(normTitle(i.title)));

/**
 * Checklist items that create the missing pieces instead of planning without them. Fixed ids, so a second plan run
 * never adds them twice (an item with the same id, done or not, counts as already there). An item the owner added by
 * hand with a matching title (e.g. "Write PRD.md") counts too, so the plan doesn't add a second one next to it.
 */
export function setupItems(st, { project, roles, jarvisRoot, existingIds, existingItems = [] }) {
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
  return out.filter((i) => !existingIds.has(i.id) && !coveredByTitle(i.id, existingItems));
}
