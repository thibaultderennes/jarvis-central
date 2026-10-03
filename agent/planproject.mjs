#!/usr/bin/env node
// "Plan this project": Claude reviews a project folder (CLAUDE.md, PRD.md, docs/audits/, code, git history, current
// checklist), writes a situation report (saved as a Strategy document) and returns the missing checklist items.
// New items go only into the project's existing sections, never reuse an existing item id, and are placed in order on
// working days with room before the PRD milestone they serve (same load check as item refinement). When the project
// lacks PRD.md, the "How we work" section in CLAUDE.md or docs/audits/PROMPTS.md, the plan adds items that create
// them instead of inventing a roadmap.
//
// A project that already has a checklist gets a REFRESH instead ("Refresh this project checklist" on the site): the same
// reading plus the git history and changed files since the checklist last moved and the earlier weekly reviews; the run
// then reconciles rather than rewrites: it ticks items the folder shows are done (evidence kept on the item, one click
// to undo), flags stale ones (nothing removed), and adds what's missing. New items apply directly, as before.
//
//   node planproject.mjs <project-id> --dry-run    print what a plan would read and add, without running Claude
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { api, qs, CONFIG, JARVIS_ROOT, todayTZ, addDays, parseModelJSON } from "./lib.mjs";
import { runClaude } from "./claude.mjs";
import { dailyLoad } from "./refine.mjs";
import { readStructure, sectionRoles, setupItems, slugify } from "./structure.mjs";
import { applyMilestoneMoves } from "./milestones.mjs";

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const wd = (d) => WD[new Date(d + "T12:00:00Z").getUTCDay()];
const norm = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const clip = (s, n) => (s && s.length > n ? s.slice(0, n) + `\n\n[…truncated at ${n} characters; read the file for the rest]` : s);
const OWNERS = ["founder", "claude", "both"];
const git = (dir, ...args) => { try { return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 20_000 }).trim(); } catch { return null; } };

/** What changed in the folder since the checklist last moved (or 30 days), and what the Monday reviews said. Refresh only. */
async function recentContext(project, dir, mine) {
  const last = mine.map((i) => i.updated_at || i.created_at).filter(Boolean).sort().pop();
  const since = last ? String(last).slice(0, 10) : addDays(todayTZ(), -30);
  const log = git(dir, "log", `--since=${since}`, "--format=%h %ad %s", "--date=short", "-n", "80") || "";
  const files = git(dir, "diff", "--stat", `HEAD@{${since}}`, "HEAD") || git(dir, "log", `--since=${since}`, "--name-only", "--format=") || "";
  const status = git(dir, "status", "--short") || "";
  let reviews = [];
  try { reviews = (await api("GET", "/api/agent/reviews" + qs({ type: "project", project: project.id, limit: 3 }))).map((r) => ({ week: r.week_start, verdict: r.verdict, headline: r.headline, body: clip(r.body_md, 3000) })); } catch {}
  return { since, log: clip(log, 6000), files: clip([...new Set(files.split("\n"))].join("\n"), 4000), status: clip(status, 1500), reviews };
}

/** Everything the plan reads before Claude runs: folder structure, milestones, sections, the checklist. */
export async function gather(project) {
  const dir = project?.dir && fs.existsSync(project.dir) ? project.dir : null;
  if (!dir) throw new Error(`The project folder isn't on this Mac (${project?.dir || "no folder set"}).`);
  const today = todayTZ();
  await applyMilestoneMoves([project]); // moved on the Timeline: into PRD.md before it's read
  const [mine, open, events] = await Promise.all([
    api("GET", "/api/agent/items" + qs({ project: project.id })),
    api("GET", "/api/agent/items" + qs({ open: 1 })),
    api("GET", "/api/agent/calendar" + qs({ from: today, to: addDays(today, 90) })).catch(() => []),
  ]);
  const st = readStructure(dir);
  const roles = sectionRoles(project.sections);
  // The PRD's milestones table is the source of deadlines; the dashboard's are the fallback for projects without one.
  const milestones = (st.milestones.length ? st.milestones : project.deadlines || []).slice().sort((a, b) => a.date.localeCompare(b.date));
  const existingIds = new Set(mine.map((i) => i.id));
  const setup = setupItems(st, { project, roles, jarvisRoot: JARVIS_ROOT, existingIds, existingItems: mine });
  const refresh = mine.length > 0;
  const recent = refresh ? await recentContext(project, dir, mine) : null;
  return { dir, today, mine, open, events: Array.isArray(events) ? events : [], st, roles, milestones, existingIds, setup, refresh, recent };
}

export function buildPlanPrompt(project, g) {
  const { dir, today, mine, st, roles, milestones, setup, refresh, recent } = g;
  const line = (i) => `- [${i.id}] ${i.status} | ${i.section} | ${i.title} | due ${i.due || "—"}${i.owner ? ` | ${i.owner}` : ""}${i.note ? ` | owner's note: ${i.note.replace(/\n/g, " ").slice(0, 200)}` : ""}`;
  const noPrd = !st.prd;
  return `You are ${refresh ? "refreshing the checklist of" : "planning the next stretch of work on"} a project for its owner. You run headless: nobody will answer questions.
Today: ${today}. Project: ${project.name} (${project.id}). Folder: ${dir} (your working directory).
${CONFIG.reviews?.stance ? `Owner's preference: ${CONFIG.reviews.stance}\n` : ""}
## Milestones (${st.milestones.length ? "from the PRD.md Milestones table" : "from the dashboard; PRD.md has no dated table"})
${milestones.map((m) => `- ${m.date}: ${m.label}`).join("\n") || "(none)"}

## Sections: put items ONLY in these existing ids, never invent one
${roles.list.map((s) => `- ${s.id}: ${s.name}${s.note ? ` (${s.note})` : ""}${s.owner_default ? ` [owner defaults to ${s.owner_default}]` : ""}${s.notes ? " [the owner's decisions]" : ""}`).join("\n")}
An item in "${roles.build}" that the owner sets to in progress is their go for Claude to build it (branch + PR, never merged on its own).
New items always start as todo: never propose one as in progress.

## Current checklist (all items, done included; the [id] is the item's code name)
${mine.map(line).join("\n") || "(empty)"}

## CLAUDE.md
${clip(st.claude, 15000) || "(missing)"}

## PRD.md (repo root)
${clip(st.prd, 20000) || "(missing)"}

## docs/audits/
${st.audits.length ? st.audits.map((f) => `- ${f}`).join("\n") : "(missing)"}${st.audits.length ? "\nRead PROMPTS.md and the latest report: open FAILs there are real work." : ""}

${setup.length ? `## Already being added (setup the project is missing; don't repeat these)
${setup.map((i) => `- [${i.id}] ${i.section} | ${i.title}`).join("\n")}

` : ""}${refresh ? `## What changed since the checklist last moved (${recent.since})
Commits:
${recent.log || "(none)"}

Files touched:
${recent.files || "(none)"}

Uncommitted (git status):
${recent.status || "(clean)"}

## Earlier weekly reviews of this project (newest first)
${recent.reviews.length ? recent.reviews.map((r) => `### Week of ${r.week}${r.verdict ? ` · ${r.verdict}` : ""}\n${r.headline}\n${r.body}`).join("\n\n") : "(none yet)"}

` : ""}## Investigate
Look at README and docs/, the code's structure, tests, TODO/FIXME notes and config; \`git log --oneline -60\` and
\`git status\`; \`gh pr list --state all --limit 20\` if it's a GitHub repo. Work out what really exists (not what the docs
promise), what's done, what's half-done or broken, and ${noPrd ? "what is concretely broken" : "what the PRD and its milestones still require"}.${refresh ? `
This is a RECONCILIATION of the existing checklist, not a rewrite. For every open item, check the folder: if the work is
verifiably there (cite the file or commit), list it under "done" with that evidence; if it no longer makes sense, list it
under "obsolete" with the reason (it is only flagged, never removed); keep the owner's wording and dates otherwise. Then
add only what is missing.` : ""}
${noPrd ? `
This project has NO PRD.md. Do not invent a roadmap, features, milestones or dates: the owner decides those in the PRD
(an item for it is already being added). Only add items for defects or half-done work you verified in the code, citing
files, at most 8. Say in the report that planning waits for the PRD.
` : ""}
## Then output ONLY one JSON object
{"verdict": "on-track|at-risk|off-track", "headline": "one sentence on where it stands",
 "situation_md": "## Where it stands\\n…\\n## What's done\\n…\\n## What's missing or broken\\n…\\n## Risks\\n…",
 "next_md": "## To continue\\nThe path to the next milestone, in phases, with what to do first and why.",
 "done": [{"id": "existing item id verified as done", "evidence": "file or commit that shows it"}],
 "obsolete": [{"id": "existing item id that no longer makes sense", "reason": "why"}],
 "items": [{"id": "short-kebab-code-name", "section": "one of the ids above", "title": "…",
            "detail": "one line of purpose, then 3–7 numbered steps", "owner": "founder|claude|both",
            "milestone": "YYYY-MM-DD from the milestones list this item is needed for, or null",
            "priority": 1|2|3, "critical": true|false, "estimate_minutes": 15-480}]}
Rules: at most ${noPrd ? 8 : 20} items, in the order they should be done (dependencies first); an id is 1–4 lowercase words
joined by hyphens and must not be one already on the checklist; never duplicate an item already on the checklist (done or
not): if one covers it, leave it; every claim in the report must come from what you read (cite files or commits);
unknowns become "Confirm …" items in "${roles.decide}" instead of guesses.`;
}

/** Validate the model's items against the checklist: existing sections only, no reused ids or titles, sane fields. */
export function normalizeItems(raw, g, limit) {
  const { roles, existingIds, mine, setup } = g;
  const taken = new Set([...existingIds, ...setup.map((i) => i.id)]);
  const titles = new Set([...mine, ...setup].map((i) => norm(i.title)));
  const byId = Object.fromEntries(roles.list.map((s) => [s.id, s]));
  const items = [], skipped = [];
  for (const it of (Array.isArray(raw) ? raw : []).slice(0, limit)) {
    if (!it?.title) continue;
    const title = String(it.title).slice(0, 300);
    const wanted = String(it.id || "").trim() ? slugify(String(it.id)).slice(0, 40) : "";
    if ((wanted && existingIds.has(wanted)) || titles.has(norm(title))) { skipped.push({ id: wanted || null, title }); continue; }
    let id = wanted || slugify(title).split("-").slice(0, 4).join("-");
    for (let n = 2, base = id; taken.has(id); n++) id = `${base}-${n}`;
    taken.add(id); titles.add(norm(title));
    const owner0 = OWNERS.includes(it.owner) ? it.owner : null;
    const section = roles.ids.has(it.section) ? it.section : owner0 === "claude" ? roles.build : roles.other;
    items.push({
      id, section, title, detail: String(it.detail || "").slice(0, 4000),
      owner: owner0 || byId[section]?.owner_default || "founder", critical: !!it.critical,
      priority: [1, 2, 3].includes(Number(it.priority)) ? Number(it.priority) : 2,
      estimate_minutes: Math.min(480, Math.max(15, Math.round(Number(it.estimate_minutes) || 60))),
      milestone: /^\d{4}-\d{2}-\d{2}$/.test(it.milestone || "") ? it.milestone : null,
    });
  }
  return { items, skipped };
}

/**
 * Due dates, in order: the first working day with room on or before the milestone the item serves (its own, else the
 * next one). When no day has room, the milestone date itself is the default deadline.
 */
export function placeItems(items, g) {
  const { today, open, events, milestones } = g;
  const cap = Number(CONFIG.planner?.max_focus_minutes_per_day) || 360;
  const workDays = CONFIG.planner?.work_days || ["Mon", "Tue", "Wed", "Thu", "Fri"];
  const load = dailyLoad(open, events, "");
  const upcoming = milestones.filter((m) => m.date > today);
  const horizon = addDays(today, 56);
  let cursor = addDays(today, 1);
  return items.map((it) => {
    const need = Math.min(it.estimate_minutes, cap); // a job bigger than a day still takes a day, not none
    const target = upcoming.find((m) => m.date === it.milestone) || upcoming.find((m) => !it.milestone || m.date >= it.milestone) || null;
    const limit = target?.date || horizon;
    for (let d = cursor; d <= limit; d = addDays(d, 1)) {
      if (workDays.includes(wd(d)) && (load[d] || 0) + need <= cap) {
        load[d] = (load[d] || 0) + need; cursor = d;
        return { ...it, due: d, target };
      }
    }
    return { ...it, due: target?.date || null, target, full: true };
  });
}

export async function planProject(message, project, log) {
  if (!project) throw new Error("Pick a project for the plan.");
  const g = await gather(project);
  await api("PATCH", "/api/agent/messages", { id: message.id, status: "working", meta: { mode: "plan" } });
  const { dir, today, st, milestones, setup } = g;

  // Keep the dashboard's deadlines in step with the PRD (same rule as `projects.mjs sync`: only when it has a table).
  const key = (ms) => JSON.stringify((ms || []).map((m) => [m.date, m.label]));
  if (st.milestones.length && key(st.milestones) !== key(project.deadlines)) {
    await api("PUT", "/api/agent/projects", { id: project.id, deadlines: st.milestones }).catch((e) => log("deadlines update failed", project.id, e.message));
  }

  log("plan run", project.id, { dir, setup: setup.map((i) => i.id) });
  const res = await runClaude({
    prompt: buildPlanPrompt(project, g), cwd: dir, model: CONFIG.worker?.build_model || undefined, maxTurns: 60, timeoutMs: 20 * 60_000,
    allowedTools: ["Read", "Grep", "Glob", "Bash(git log:*)", "Bash(git status:*)", "Bash(git show:*)", "Bash(gh pr list:*)", "Bash(gh pr view:*)", "Bash(ls:*)"],
    disallowedTools: ["Edit", "Write", "Bash(git push:*)", "Bash(git commit:*)", "Bash(rm:*)", "Bash(curl:*)"], log,
  });
  const out = parseModelJSON(res.result);
  if (!out || !Array.isArray(out.items)) throw new Error("The planning run didn't return a plan.");

  const { items, skipped } = normalizeItems(out.items, g, st.prd ? 20 : 8);
  // Refresh: tick what the folder shows is done (evidence on the item; one click undoes it) and flag the stale ones.
  const openIds = new Set(g.mine.filter((i) => i.status === "todo" || i.status === "doing").map((i) => i.id));
  const asList = (v) => (Array.isArray(v) ? v : []).map((x) => (typeof x === "string" ? { id: x } : x)).filter((x) => x && openIds.has(String(x.id)));
  const ticked = [], flagged = [];
  if (g.refresh) {
    for (const d of asList(out.done).slice(0, 30)) {
      const note = `Marked done by "Refresh this project checklist" on ${today}: ${String(d.evidence || "verified in the folder").slice(0, 400)}`;
      await api("PATCH", "/api/agent/items", { project_id: project.id, id: d.id, status: "done", refine: "done", refine_note: note }).then(() => ticked.push(d)).catch((e) => log("tick failed", d.id, e.message));
    }
    for (const o of asList(out.obsolete).slice(0, 30)) {
      if (ticked.some((d) => d.id === o.id)) continue;
      const note = `Flagged by "Refresh this project checklist" on ${today}: looks obsolete. ${String(o.reason || "").slice(0, 400)} Cancel it, or comment to keep it.`;
      await api("PATCH", "/api/agent/items", { project_id: project.id, id: o.id, refine: "flagged", refine_note: note }).then(() => flagged.push(o)).catch((e) => log("flag failed", o.id, e.message));
    }
  }
  const placed = placeItems([...setup.map((i) => ({ ...i, milestone: null })), ...items], g);
  const added = [];
  for (const it of placed) {
    const note = it.full ? ` No day with room before ${it.target ? `${it.target.label} (${it.target.date})` : "the horizon"}: due on ${it.due ? "the milestone itself" : "no date yet"}.` : "";
    const { item } = await api("POST", "/api/agent/items", {
      project_id: project.id, id: it.id, section: it.section, title: it.title, detail: it.detail, owner: it.owner, critical: it.critical,
      priority: it.priority, estimate_minutes: it.estimate_minutes, due: it.due,
      refine: "done", refine_note: `Added by "${g.refresh ? "Refresh this project checklist" : "Plan this project"}" on ${today}${it.target ? ` for ${it.target.label} (${it.target.date})` : ""}.${note}`,
    });
    added.push(item);
  }

  const crowded = placed.filter((i) => i.full).length;
  const next = milestones.find((m) => m.date > today);
  const list = added.map((i) => `- \`${i.id}\` ${i.title} · ${i.section} · ${i.due || "no date"} · ~${i.estimate_minutes} min`).join("\n");
  const body = `${setup.length ? `## Project setup missing\n${setup.map((i) => `- \`${i.id}\` ${i.title}`).join("\n")}\n\n` : ""}${out.situation_md || ""}\n\n${out.next_md || ""}\n\n## Added to the checklist (${added.length})\n${list || "Nothing new: the checklist already covers it."}${
    ticked.length ? `\n\n## Ticked as done (${ticked.length}; untick on the checklist if wrong)\n${ticked.map((d) => `- \`${d.id}\` — ${d.evidence || "verified in the folder"}`).join("\n")}` : ""}${
    flagged.length ? `\n\n## Flagged as obsolete (${flagged.length}; nothing removed: cancel or keep each one)\n${flagged.map((o) => `- \`${o.id}\` — ${o.reason || ""}`).join("\n")}` : ""}${
    skipped.length ? `\n\n## Already on the checklist (not added again)\n${skipped.map((s) => `- ${s.id ? `\`${s.id}\` ` : ""}${s.title}`).join("\n")}` : ""}${
    crowded ? `\n\n_${crowded} item(s) found no day with room before their milestone; they are due on the milestone date (or undated without one)._` : ""}`;
  const { review } = await api("POST", "/api/agent/reviews", {
    type: "doc", project_id: project.id, title: `${g.refresh ? "Checklist refresh" : "Project plan"} · ${today}`, verdict: out.verdict || null, headline: out.headline || "", body_md: body,
    meta: { kind: g.refresh ? "checklist-refresh" : "project-plan", cost_usd: res.cost_usd, duration_s: res.duration_s, added: added.map((i) => i.id), setup: setup.map((i) => i.id), ticked: ticked.map((d) => d.id), flagged: flagged.map((o) => o.id) },
  });
  const reply = `**${out.headline || "Plan ready."}**\n\nAdded ${added.length} item${added.length === 1 ? "" : "s"} to ${project.name}'s checklist, spread over days that still have room${next ? ` before ${next.label} (${next.date})` : ""}.${
    setup.length ? ` ${setup.length} of them set up what the project is missing (${setup.map((i) => `\`${i.id}\``).join(", ")}).` : ""}${
    skipped.length ? ` ${skipped.length} proposal(s) were already on the checklist.` : ""}${
    ticked.length ? ` Ticked ${ticked.length} item(s) the folder shows are done.` : ""}${
    flagged.length ? ` Flagged ${flagged.length} item(s) as obsolete (nothing removed).` : ""}\n\nThe full report is under the project's Project view (strategy documents).`;
  await api("PATCH", "/api/agent/messages", { id: message.id, status: "done", reply, meta: { mode: "plan", review_id: review?.id, cost_usd: res.cost_usd, duration_s: res.duration_s } });
  log(g.refresh ? "refresh done" : "plan done", project.id, { added: added.length, ticked: ticked.length, flagged: flagged.length, setup: setup.length, skipped: skipped.length, crowded, cost_usd: res.cost_usd });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const id = process.argv[2];
  if (!id || !process.argv.includes("--dry-run")) {
    console.log("Usage: node planproject.mjs <project-id> --dry-run   (real plans run from the project page's \"Plan this project\" button)");
    process.exitCode = id ? 1 : 0;
  } else {
    (async () => {
      const project = (await api("GET", "/api/agent/projects")).find((p) => p.id === id);
      if (!project) throw new Error(`no project ${id}`);
      const g = await gather(project);
      const { st, roles, milestones, setup } = g;
      console.log(`${project.id}: PRD.md ${st.prd ? "✓" : "✗"} (${st.milestones.length} milestone(s))  How we work ${st.hasHowWeWork ? "✓" : "✗"}  docs/audits/PROMPTS.md ${st.hasAuditPrompts ? "✓" : "✗"}`);
      console.log(`sections: ${roles.list.map((s) => s.id).join(", ")}  (decide → ${roles.decide}, build → ${roles.build}, other → ${roles.other})`);
      console.log(`milestones: ${milestones.map((m) => `${m.date} ${m.label}`).join("; ") || "none"}`);
      console.log(`dashboard deadlines: ${(project.deadlines || []).map((m) => `${m.date} ${m.label}`).join("; ") || "none"}`);
      const placed = placeItems(setup.map((i) => ({ ...i, milestone: null })), g);
      console.log(`setup items: ${placed.map((i) => `${i.id} → ${i.section} due ${i.due || "—"}`).join("; ") || "none (structure complete)"}`);
      const covered = setupItems(st, { project, roles, jarvisRoot: JARVIS_ROOT, existingIds: g.existingIds }).filter((i) => !setup.some((s) => s.id === i.id));
      if (covered.length) console.log(`already covered by an item you added: ${covered.map((i) => i.id).join(", ")}`);
      if (process.argv.includes("--prompt")) console.log("\n--- prompt ---\n" + buildPlanPrompt(project, g));
    })().catch((e) => { console.error(e.message); process.exitCode = 1; });
  }
}
