#!/usr/bin/env node
// Screenings: on-demand reviews that check a project folder against a researched check list in `screenings/<kind>.md`
// (Run on the project's Docs and reviews → Screenings view). Claude reads the folder read-only, marks every check
// fail / warn / pass / n/a / needs the live site, with file evidence, and proposes checklist items for what to fix;
// blockers come back critical, choices the owner has to make go to the decide section. Items are validated and
// scheduled exactly like "Plan this project" (agent/planproject.mjs). The report is saved as review type 'screening'.
//
//   node screen.mjs <project-id> <kind> --dry-run    print the prompt it would send, without running Claude
import fs from "node:fs";
import path from "node:path";
import { api, CONFIG, JARVIS_ROOT, parseModelJSON } from "./lib.mjs";
import { runClaude } from "./claude.mjs";
import { gather, normalizeItems, placeItems } from "./planproject.mjs";

export const KINDS = {
  vibecoded: {
    title: "VibeCoded Screening", file: "vibecoded.md",
    goal: "find the tells that make this project look and read like a generic AI-generated site, so the owner can make deliberate, distinctive choices instead",
    verdict: "Call it off-track when about 8 or more high/medium tells show up together (especially in the hero), at-risk from 4, on-track below.",
  },
  prelaunch: {
    title: "Website pre-launch", file: "prelaunch.md",
    goal: "catch what would break, embarrass or leak at launch, and what would cost visitors, search or email deliverability",
    verdict: "off-track when any blocker fails, at-risk when a high check fails, on-track otherwise.",
  },
  rights: {
    title: "Pre-launch rights & compliance", file: "rights.md",
    goal: "find the legal, consent, consumer-protection, accessibility and licensing gaps to close before launch. This is not legal advice: blockers must be confirmed by a lawyer",
    verdict: "off-track when any blocker fails, at-risk when a high check fails, on-track otherwise.",
  },
};
export const SCREEN_DIR = path.join(JARVIS_ROOT, "screenings");
const STATUSES = ["fail", "warn", "pass", "na", "live"];

export function buildScreenPrompt(project, kind, g) {
  const k = KINDS[kind];
  const sections = g.roles.list.map((s) => `${s.id} (${s.name})`).join(", ");
  return `You are running the "${k.title}" screening on the project "${project.name}" (id ${project.id}), folder ${g.dir}. Today is ${g.today}.
Goal: ${k.goal}.

1. Read the check list at ${path.join(SCREEN_DIR, k.file)}: every row is one check, with how to detect it in a repo, its severity and the fix.
2. Look at what the project actually is first (README, CLAUDE.md, PRD.md, package.json, the app/ or src/ tree). Checks that cannot apply to it
   (no website, no email, no payments, no children, no EU users…) are "na" with a one-line reason; never fail a check that doesn't apply.
3. Run every applicable check against the folder with Read, Grep and Glob. Evidence is a file path with a line number, a grep result, or
   "not found after searching X". Checks that can only be judged on the live site or from a screenshot are "live" (say what to look at).
   Never guess a pass: if you could not verify it, it is "live" or "warn".
4. Propose checklist items for what to do about it: one item per fix (group tiny related fixes), the blockers first and critical,
   owner "claude" for code/content changes Claude can make, "founder" for accounts, legal, money and identity, and put real choices the owner
   has to make (e.g. "keep the purple gradient or pick a brand colour") in the decide section as a question with the options.
   Use only these sections: ${sections}. Never repeat an item already on the checklist:
${g.mine.filter((i) => i.status === "todo" || i.status === "doing").map((i) => `   - ${i.id}: ${i.title}`).slice(0, 120).join("\n") || "   (the checklist is empty)"}
Verdict: ${k.verdict}

Output ONLY one JSON object, no code fences:
{"verdict": "on-track|at-risk|off-track", "headline": "<one sentence: the state and the single most important fix>",
 "summary_md": "<markdown: what the project is, what stands out, the 3–5 fixes that matter most and why; cite files>",
 "findings": [{"id": "<check id from the list>", "severity": "blocker|high|med|low", "status": "fail|warn|pass|na|live", "evidence": "<file:line or what you searched>", "fix": "<what to do, short>"}],
 "items": [{"section": "<section id>", "title": "...", "detail": "<steps, the files involved, the check ids it closes>", "owner": "founder|claude|both", "critical": false, "priority": 1, "estimate_minutes": 60}]}
List every check in findings (pass and na included, short evidence). At most 15 items.`;
}

const ORDER = { blocker: 0, high: 1, med: 2, low: 3 };
const ICON = { fail: "✗ fail", warn: "! warn", pass: "✓ pass", na: "– n/a", live: "◎ live" };
/** Clean the model's findings: known statuses only, severity order, counts per status. */
export function tallyFindings(raw) {
  const findings = (Array.isArray(raw) ? raw : []).filter((f) => f && f.id).map((f) => ({
    id: String(f.id).slice(0, 60), severity: ORDER[f.severity] !== undefined ? f.severity : "med",
    status: STATUSES.includes(f.status) ? f.status : "warn", evidence: String(f.evidence || "").slice(0, 300), fix: String(f.fix || "").slice(0, 300),
  })).sort((a, b) => STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status) || ORDER[a.severity] - ORDER[b.severity]);
  const counts = Object.fromEntries(STATUSES.map((s) => [s, findings.filter((f) => f.status === s).length]));
  return { findings, counts };
}
const cell = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");

export async function screenProject(message, project, log) {
  const kind = message.meta?.kind;
  if (!project) throw new Error("Pick a project for the screening.");
  if (!KINDS[kind]) throw new Error(`Unknown screening "${kind}". Known: ${Object.keys(KINDS).join(", ")}.`);
  const k = KINDS[kind];
  if (!fs.existsSync(path.join(SCREEN_DIR, k.file))) throw new Error(`Check list missing: screenings/${k.file}`);
  const g = await gather(project);
  await api("PATCH", "/api/agent/messages", { id: message.id, status: "working", meta: { mode: "screen", kind } });
  log("screening run", project.id, kind);
  const res = await runClaude({
    prompt: buildScreenPrompt(project, kind, g), cwd: g.dir, addDirs: [SCREEN_DIR], model: CONFIG.worker?.build_model || undefined, maxTurns: 80, timeoutMs: 25 * 60_000,
    allowedTools: ["Read", "Grep", "Glob", "Bash(git log:*)", "Bash(git status:*)", "Bash(ls:*)"],
    disallowedTools: ["Edit", "Write", "Bash(git push:*)", "Bash(git commit:*)", "Bash(rm:*)", "Bash(curl:*)"], log,
  });
  const out = parseModelJSON(res.result);
  if (!out || !Array.isArray(out.findings)) throw new Error("The screening didn't return findings.");
  const { findings, counts } = tallyFindings(out.findings);

  const { items, skipped } = normalizeItems(out.items, { ...g, setup: [] }, 15);
  const placed = placeItems(items, g);
  const added = [];
  for (const it of placed) {
    const { item } = await api("POST", "/api/agent/items", {
      project_id: project.id, id: it.id, section: it.section, title: it.title, detail: it.detail, owner: it.owner, critical: it.critical,
      priority: it.priority, estimate_minutes: it.estimate_minutes, due: it.due, refine: "done", refine_note: `Added by the ${k.title} screening on ${g.today}.`,
    });
    added.push(item);
  }

  const verdict = ["on-track", "at-risk", "off-track"].includes(out.verdict) ? out.verdict : null;
  const table = findings.filter((f) => f.status !== "pass" && f.status !== "na");
  const body = `${out.summary_md || ""}

## Result
${STATUSES.map((s) => `${ICON[s]} ${counts[s]}`).join(" · ")}

## To fix or check (${table.length})
| Check | Severity | Status | Evidence | Fix |
|---|---|---|---|---|
${table.map((f) => `| \`${cell(f.id)}\` | ${f.severity} | ${ICON[f.status]} | ${cell(f.evidence)} | ${cell(f.fix)} |`).join("\n") || "| — | | | Nothing failed. | |"}

## Added to the checklist (${added.length})
${added.map((i) => `- \`${i.id}\` ${i.title} · ${i.section}${i.critical ? " · critical" : ""} · ${i.due || "no date"}`).join("\n") || "Nothing new."}${
  skipped.length ? `\n\n## Already on the checklist\n${skipped.map((s) => `- ${s.id ? `\`${s.id}\` ` : ""}${s.title}`).join("\n")}` : ""}

<details><summary>Passed or not applicable (${counts.pass + counts.na})</summary>

${findings.filter((f) => f.status === "pass" || f.status === "na").map((f) => `- ${ICON[f.status]} \`${f.id}\`: ${f.evidence}`).join("\n")}
</details>
${kind === "rights" ? "\n_Not legal advice: have a lawyer confirm every blocker before launch._\n" : ""}`;
  const { review } = await api("POST", "/api/agent/reviews", {
    type: "screening", project_id: project.id, title: `${k.title} · ${g.today}`, verdict, headline: out.headline || "", body_md: body,
    meta: { kind, counts, added: added.map((i) => i.id), cost_usd: res.cost_usd, duration_s: res.duration_s },
  });
  const reply = `**${out.headline || `${k.title} done.`}**\n\n${counts.fail} failed, ${counts.warn} to watch, ${counts.live} to check on the live site, ${counts.pass} passed. Added ${added.length} item${added.length === 1 ? "" : "s"} to ${project.name}'s checklist. The full report is under the project's Docs and reviews → Screenings.`;
  await api("PATCH", "/api/agent/messages", { id: message.id, status: "done", reply, meta: { mode: "screen", kind, review_id: review?.id, cost_usd: res.cost_usd, duration_s: res.duration_s } });
  log("screening done", project.id, kind, { counts, added: added.length, cost_usd: res.cost_usd });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [id, kind] = process.argv.slice(2);
  if (!id || !KINDS[kind] || !process.argv.includes("--dry-run")) {
    console.log(`Usage: node screen.mjs <project-id> <${Object.keys(KINDS).join("|")}> --dry-run   (real runs start from the project's Docs and reviews → Screenings)`);
    process.exitCode = id ? 1 : 0;
  } else {
    (async () => {
      const project = (await api("GET", "/api/agent/projects")).find((p) => p.id === id);
      if (!project) throw new Error(`no project ${id}`);
      console.log(buildScreenPrompt(project, kind, await gather(project)));
    })().catch((e) => { console.error(e.message); process.exitCode = 1; });
  }
}
