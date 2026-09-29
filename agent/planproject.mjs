// "Plan this project": Claude reviews a project folder (code, docs, git history, PRD, current checklist), writes a
// situation report (saved as a Strategy document) and returns the missing checklist items. The items are then placed,
// in order, on working days that still have room before the next deadline (same load check as item refinement).
import fs from "node:fs";
import { api, qs, CONFIG, todayTZ, addDays, parseModelJSON } from "./lib.mjs";
import { runClaude } from "./claude.mjs";
import { dailyLoad } from "./refine.mjs";

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const wd = (d) => WD[new Date(d + "T12:00:00Z").getUTCDay()];

export async function planProject(message, project, log) {
  if (!project) throw new Error("Pick a project for the plan.");
  const dir = project.dir && fs.existsSync(project.dir) ? project.dir : null;
  if (!dir) throw new Error(`The project folder isn't on this Mac (${project.dir || "no folder set"}).`);
  await api("PATCH", "/api/agent/messages", { id: message.id, status: "working", meta: { mode: "plan" } });
  const today = todayTZ(), horizon = addDays(today, 56);
  const [mine, open, events] = await Promise.all([
    api("GET", "/api/agent/items" + qs({ project: project.id })),
    api("GET", "/api/agent/items" + qs({ open: 1 })),
    api("GET", "/api/agent/calendar" + qs({ from: today, to: horizon })).catch(() => []),
  ]);
  const sections = project.sections || [];
  const deadline = (project.deadlines || []).filter((d) => d.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
  const line = (i) => `- [${i.id}] ${i.status} | ${i.section} | ${i.title} | due ${i.due || "—"}${i.owner ? ` | ${i.owner}` : ""}`;

  const prompt = `You are planning the next stretch of work on a project for its owner. You run headless: nobody will answer questions.
Today: ${today}. Project: ${project.name} (${project.id}). Folder: ${dir} (your working directory).
${CONFIG.reviews?.stance ? `Owner's preference: ${CONFIG.reviews.stance}\n` : ""}Deadlines on the dashboard: ${(project.deadlines || []).map((d) => `${d.label} ${d.date}`).join("; ") || "none"}.

## Current checklist (all items, done included)
${mine.map(line).join("\n") || "(empty)"}

## Sections you can use
${sections.map((s) => `- ${s.id}: ${s.name}${s.note ? ` (${s.note})` : ""}`).join("\n") || "- decide, build, launch, later"}

## Investigate first
Read CLAUDE.md, PRD.md, README and docs/ if present; look at the code's structure, tests, TODO/FIXME notes and config;
\`git log --oneline -60\` and \`git status\`; \`gh pr list --state all --limit 20\` if it's a GitHub repo. Work out what really
exists (not what the docs promise), what's done, what's half-done or broken, and what the PRD or deadlines still require.

## Then output ONLY one JSON object
{"verdict": "on-track|at-risk|off-track", "headline": "one sentence on where it stands",
 "situation_md": "## Where it stands\\n…\\n## What's done\\n…\\n## What's missing or broken\\n…\\n## Risks\\n…",
 "next_md": "## To continue\\nThe path to the next milestone, in phases, with what to do first and why.",
 "obsolete": ["ids of existing items that no longer make sense, with the reason in situation_md"],
 "items": [{"section": "…", "title": "…", "detail": "one line of purpose, then 3–7 numbered steps", "owner": "founder|claude|both",
            "priority": 1|2|3, "critical": true|false, "estimate_minutes": 15-480}]}
Rules: at most 20 items, in the order they should be done (dependencies first); never duplicate an item already on the
checklist (done or not); every claim in the report must come from what you read (cite files or commits); unknowns become
"Confirm …" items instead of guesses.`;

  log("plan run", project.id, { dir });
  const res = await runClaude({
    prompt, cwd: dir, model: CONFIG.worker?.build_model || undefined, maxTurns: 60, timeoutMs: 20 * 60_000,
    allowedTools: ["Read", "Grep", "Glob", "Bash(git log:*)", "Bash(git status:*)", "Bash(git show:*)", "Bash(gh pr list:*)", "Bash(gh pr view:*)", "Bash(ls:*)"],
    disallowedTools: ["Edit", "Write", "Bash(git push:*)", "Bash(git commit:*)", "Bash(rm:*)", "Bash(curl:*)"], log,
  });
  const out = parseModelJSON(res.result);
  if (!out || !Array.isArray(out.items)) throw new Error("The planning run didn't return a plan.");

  // Place items in order on working days with room, before the next deadline.
  const cap = Number(CONFIG.planner?.max_focus_minutes_per_day) || 360;
  const workDays = CONFIG.planner?.work_days || ["Mon", "Tue", "Wed", "Thu", "Fri"];
  const load = dailyLoad(open, Array.isArray(events) ? events : [], "");
  const limit = deadline && deadline.date > today ? deadline.date : horizon;
  const ids = new Set(sections.map((s) => s.id));
  const pickSection = (s) => (ids.has(s) ? s : sections.find((x) => x.id === "build")?.id || sections[0]?.id || "build");
  const added = [], unplaced = [];
  let cursor = addDays(today, 1);
  for (const it of out.items.slice(0, 20)) {
    if (!it?.title) continue;
    const est = Math.min(480, Math.max(15, Math.round(Number(it.estimate_minutes) || 60)));
    let due = null;
    for (let d = cursor; d <= limit; d = addDays(d, 1)) {
      if (workDays.includes(wd(d)) && (load[d] || 0) + est <= cap) { due = d; load[d] = (load[d] || 0) + est; cursor = d; break; }
    }
    if (!due) unplaced.push(it.title);
    const { item } = await api("POST", "/api/agent/items", {
      project_id: project.id, section: pickSection(it.section), title: String(it.title).slice(0, 300), detail: String(it.detail || "").slice(0, 4000),
      owner: ["founder", "claude", "both"].includes(it.owner) ? it.owner : "founder", critical: !!it.critical,
      priority: [1, 2, 3].includes(Number(it.priority)) ? Number(it.priority) : 2, estimate_minutes: est, due,
      refine: "done", refine_note: `Added by "Plan this project" on ${today}.${due ? "" : ` No day with room before ${limit}: no due date yet.`}`,
    });
    added.push(item);
  }

  const list = added.map((i) => `- \`${i.id}\` ${i.title} · ${i.due || "no date"} · ~${i.estimate_minutes} min`).join("\n");
  const body = `${out.situation_md || ""}\n\n${out.next_md || ""}\n\n## Added to the checklist (${added.length})\n${list || "Nothing new: the checklist already covers it."}${
    (out.obsolete || []).length ? `\n\n## Items that look obsolete\n${out.obsolete.map((x) => `- \`${x}\``).join("\n")} — see above; nothing was removed.` : ""}${
    unplaced.length ? `\n\n_${unplaced.length} item(s) found no day with room before ${limit}; they have no due date yet._` : ""}`;
  const { review } = await api("POST", "/api/agent/reviews", {
    type: "doc", project_id: project.id, title: `Project plan · ${today}`, verdict: out.verdict || null, headline: out.headline || "", body_md: body,
    meta: { kind: "project-plan", cost_usd: res.cost_usd, duration_s: res.duration_s, added: added.map((i) => i.id) },
  });
  const reply = `**${out.headline || "Plan ready."}**\n\nAdded ${added.length} item${added.length === 1 ? "" : "s"} to ${project.name}'s checklist, spread over days that still have room${deadline ? ` before ${deadline.label} (${deadline.date})` : ""}.${(out.obsolete || []).length ? ` ${out.obsolete.length} existing item(s) look obsolete (nothing removed).` : ""}\n\nThe full situation report is on the project's Strategy tab.`;
  await api("PATCH", "/api/agent/messages", { id: message.id, status: "done", reply, meta: { mode: "plan", review_id: review?.id, cost_usd: res.cost_usd, duration_s: res.duration_s } });
  log("plan done", project.id, { added: added.length, unplaced: unplaced.length, cost_usd: res.cost_usd });
}
