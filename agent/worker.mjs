#!/usr/bin/env node
// Jarvis inbox worker. The scheduler runs one pass every minute: pick up messages the owner left on the
// website, run `claude -p` in the right project, reply. Code work happens only in a throwaway git
// worktree; this script (not Claude) pushes the branch and opens the PR. Nothing is ever merged.
//
//   node worker.mjs              one pass
//   node worker.mjs --dry-run    print the prompt/flags for a sample message, no API, no claude
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { api, qs, makeLog, makeLogOnce, acquireLock, todayTZ, hostName, JARVIS_ROOT, CLI, CONFIG, TZ, OWNER, PROJECTS_ROOT } from "./lib.mjs";
import { runClaude } from "./claude.mjs";
import { refinePending } from "./refine.mjs";
import { planProject } from "./planproject.mjs";
import { screenProject } from "./screen.mjs";
import { syncAuditsDue } from "./audits.mjs";
import { syncEconomicsDue } from "./economics.mjs";
import { syncMetricsDue } from "./metrics.mjs";
import { rescanIfRequested } from "./rescan.mjs";
import { rolloverDue, describe as describeRollover } from "./rollover.mjs";
import { applyMilestoneMoves } from "./milestones.mjs";
import { prepareWebsiteSkills, websiteBrief, playwrightCommand } from "./website.mjs";
import { prepareLughSkills, lughBrief, PLUGIN_NAME as LUGH_PLUGIN } from "./lugh.mjs";
import { BUILD_MODES, buildModeFor } from "./projectsettings.mjs";
import { queueDueReviews, runProjectReview } from "./reviewrun.mjs";
import { setupProject, queueSetupDue } from "./setup.mjs";

const VERSION = (() => { try { return fs.readFileSync(path.join(JARVIS_ROOT, "VERSION"), "utf8").trim(); } catch { return "dev"; } })();
const W = CONFIG.worker || {};
const log = makeLog("worker");
const logChanged = makeLogOnce("worker", log);

const CLI_CMD = `node ${CLI}`;
const READ_TOOLS = [
  "Read", "Grep", "Glob", "WebSearch", "WebFetch",
  `Bash(${CLI_CMD}:*)`, "Bash(git log:*)", "Bash(git status:*)", "Bash(git diff:*)", "Bash(git show:*)",
  "Bash(gh pr list:*)", "Bash(gh pr view:*)", "Bash(ls:*)",
];
const CODE_TOOLS = [
  ...READ_TOOLS, "Edit", "Write",
  "Bash(git add:*)", "Bash(git commit:*)",
  "Bash(npm test:*)", "Bash(npm run test:*)", "Bash(npm run lint:*)", "Bash(npm run typecheck:*)", "Bash(npm run build:*)",
  "Bash(npx tsc:*)", "Bash(npx vitest:*)",
];
// `git -C <dir> add` doesn't match "git add:*", and headless Claude often writes it that way: allow it for the
// worktree path only, so `git -C <anywhere> push` stays denied.
const codeTools = (wt) => [...CODE_TOOLS, `Bash(git -C ${wt} add:*)`, `Bash(git -C ${wt} commit:*)`];
// A website build also runs the site and looks at it: dev/start scripts and the Playwright CLI.
const WEBSITE_TOOLS = ["Bash(npm run dev:*)", "Bash(npm run start:*)", "Bash(npm run preview:*)", "Bash(npx next dev:*)", "Bash(npx astro dev:*)", "Bash(npx vite:*)",
  "Bash(playwright-cli:*)"];
const DENY = ["Bash(git push:*)", "Bash(gh pr merge:*)", "Bash(gh pr create:*)", "Bash(rm -rf:*)", "Bash(curl:*)", "Bash(vercel:*)", "Bash(railway:*)", "Bash(stripe:*)", "Bash(supabase:*)"];

const git = (dir, ...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120_000 }).trim();
const tryGit = (dir, ...args) => { try { return git(dir, ...args); } catch { return null; } };

export function repoInfo(dir) {
  if (!dir || !fs.existsSync(dir)) return null;
  const top = tryGit(dir, "rev-parse", "--show-toplevel");
  // ~/Projects itself is an unrelated repo: only accept a repo rooted at the project dir
  if (!top || path.resolve(top) !== path.resolve(dir)) return null;
  const origin = tryGit(dir, "remote", "get-url", "origin");
  if (!origin) return null;
  let base = tryGit(dir, "symbolic-ref", "--short", "refs/remotes/origin/HEAD")?.replace(/^origin\//, "");
  if (!base) base = ["main", "master"].find((b) => tryGit(dir, "rev-parse", "--verify", `origin/${b}`)) || null;
  return base ? { top, origin, base } : null;
}

function linkNodeModules(src, dst) {
  const walk = (rel, depth) => {
    const here = path.join(src, rel);
    let entries = [];
    try { entries = fs.readdirSync(here, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory() || e.name === ".git" || e.name.startsWith(".jarvis")) continue;
      const r = path.join(rel, e.name);
      if (e.name === "node_modules") {
        const target = path.join(dst, r);
        if (!fs.existsSync(target) && fs.existsSync(path.dirname(target))) fs.symlinkSync(path.join(src, r), target, "dir");
      } else if (depth < 2) walk(r, depth + 1);
    }
  };
  walk("", 0);
}

/** A throwaway worktree on `branch`: new from the base, or continuing a branch already on origin (a PR sent back). */
export function makeWorktree(project, repo, shortId, wanted = null) {
  const wtRoot = path.join(path.dirname(repo.top), ".jarvis-worktrees");
  fs.mkdirSync(wtRoot, { recursive: true });
  const wt = path.join(wtRoot, `${project.id}-${shortId}`);
  const branch = wanted || `jarvis/${shortId}`;
  git(repo.top, "fetch", "origin", repo.base);
  const remote = wanted && tryGit(repo.top, "fetch", "origin", `${branch}:refs/remotes/origin/${branch}`) !== null;
  tryGit(repo.top, "worktree", "remove", "--force", wt);
  if (remote) { tryGit(repo.top, "branch", "-D", branch); git(repo.top, "worktree", "add", wt, "-b", branch, `origin/${branch}`); }
  else git(repo.top, "worktree", "add", wt, "-b", branch, `origin/${repo.base}`);
  linkNodeModules(repo.top, wt);
  return { wt, branch, continued: !!remote };
}

/** The PR already open for a branch, if any. */
function prFor(repo, branch) {
  try { return JSON.parse(execFileSync("gh", ["pr", "view", branch, "--json", "url,state"], { cwd: repo.top, encoding: "utf8", timeout: 60_000 })); } catch { return null; }
}

/** Edits the run left uncommitted (a denied commit, a stop at the turn limit): commit them so the work reaches the PR. */
function commitLeftovers(wt, title) {
  const dirty = tryGit(wt, "status", "--porcelain");
  if (!dirty) return false;
  // node_modules are symlinks into the main checkout (linkNodeModules): a "node_modules/" ignore rule doesn't match a symlink
  git(wt, "add", "-A", "--", ".", ":(exclude)node_modules", ":(exclude)**/node_modules");
  if (!tryGit(wt, "diff", "--cached", "--name-only")) return false;
  git(wt, "commit", "-m", `${title}\n\nChanges the build run left uncommitted, committed by the Jarvis worker. Review before merging.`);
  return true;
}

export function finishWorktree(repo, wt, branch, reply, modeLine = "") {
  let pr_url = null;
  const ahead = Number(tryGit(wt, "rev-list", "--count", `origin/${repo.base}..HEAD`) || 0);
  const pushed = Number(tryGit(wt, "rev-list", "--count", `origin/${branch}..HEAD`) ?? ahead) > 0;
  if (ahead > 0) {
    if (pushed) git(wt, "push", "-u", "origin", branch);
    const existing = prFor(repo, branch);
    if (existing?.url && existing.state === "OPEN") pr_url = existing.url;
    else {
      const title = tryGit(wt, "log", "--reverse", "--format=%s", `origin/${repo.base}..HEAD`)?.split("\n")[0] || branch;
      const body = `${reply}\n\n---\n${modeLine ? `${modeLine}\n` : ""}Opened by the Jarvis worker from a message on the dashboard. Not merged.`;
      pr_url = execFileSync("gh", ["pr", "create", "--head", branch, "--base", repo.base, "--title", title, "--body", body], { cwd: wt, encoding: "utf8", timeout: 120_000 }).trim().split("\n").pop();
    }
  }
  tryGit(repo.top, "worktree", "remove", "--force", wt);
  if (!ahead) tryGit(repo.top, "branch", "-D", branch);
  return { pr_url, commits: ahead };
}

/** How many times worker.timeout_minutes a code run may take: a website twice, a Lugh build 1.5 times. */
const runMultiplier = ({ site = false, lugh = false }) => (site ? 2 : lugh ? 1.5 : 1);

export function buildPrompt({ message, project, projects, mode, today, cwd, review = null, history = [], wantedBuild = false, item = null }) {
  const where = project ? `${project.name} (${project.id})` : "no specific project";
  const others = projects.map((p) => `- ${p.id}: ${p.name} [${p.kind}${p.state ? ", " + p.state : ""}]${p.dir ? " " + p.dir : ""}`).join("\n");
  return `You are the Jarvis worker: Claude Code running headless on ${OWNER === "the owner" ? "the owner's" : OWNER + "'s"} computer. ${OWNER === "the owner" ? "The owner" : OWNER} ("the founder" in checklist owner fields) left the message below on Jarvis Central, their all-projects dashboard. They are not watching this session. Your final message is shown to them as the reply in the dashboard inbox.

Today: ${today} (${TZ}). Project: ${where}. Working directory: ${cwd}.
The Jarvis inbox check at session start is already handled by this worker: ignore any instruction (for example in ~/.claude/CLAUDE.md) to check the Jarvis inbox or run the jarvis skill's inbox step.

## Rules (set by the owner)
- You may answer questions, research, plan days, and read or edit checklist items and todos with the Jarvis CLI.
${mode === "code"
    ? `- CODE MODE: this directory is a fresh git worktree on its own branch. Work only here. Make focused changes, commit them with clear messages, and run the project's tests, typecheck or lint if they exist. Run git from this directory as plain \`git add …\` / \`git commit …\` (not \`git -C\`, no \`cd\` elsewhere): other forms are denied in this headless session. Do not push and do not open a PR: the worker does that after you finish. Never touch .env files, secrets, credentials, billing, or production data.`
    : wantedBuild
      ? `- The owner pressed "Build it" but this project has no git repository with a remote, so you can't change files. Plan the change concretely (files, steps, risks), add the work to the checklist with the CLI if it isn't there, and say that setting up the repo unlocks building from the dashboard.`
      : `- DISCUSSION MODE: you cannot edit files. Think it through with the owner: challenge weak ideas with evidence, build on good ones, be concrete. If you agree on next steps, propose them as checklist items with codes; add them with the CLI only if the founder asked you to. If they want it built, tell them to press "Build it (PR)".`}
- Never merge, deploy, spend money, email, text or post anything, or change dashboards and third-party settings.
- If the request needs anything outside these rules, or a decision only the owner can make, stop and start your final message with "NEEDS YOU:" followed by exactly what you need from them.

## Jarvis CLI (Bash)
${CLI_CMD} projects
${CLI_CMD} items <project> [--open] [--section S]
${CLI_CMD} item <project> <id>
${CLI_CMD} set <project> <id> status=todo|doing|done due=YYYY-MM-DD note="..." title="..." section=S owner=founder|claude|both critical=true|false
${CLI_CMD} add <project> <section> "title" [--due D] [--owner O] [--detail T] [--critical]
${CLI_CMD} todo add "title" [--date D|today|tomorrow] [--time HH:MM] [--project P] [--item ID] [--life]
${CLI_CMD} todos [--from D] [--to D]
${CLI_CMD} reviews [--type project|recap|coaching|jarvis|doc|security] [--project P] [--limit N] [--full]
${CLI_CMD} audits <project>                 security audit reports synced from the project folder (date, verdict, headline)
${CLI_CMD} metrics <project> [--days N]     product numbers (users, active users, visits, revenue…) per snapshot
Do not use the CLI's inbox or reply commands: the worker posts your final message as the reply.

## Projects
${others}

## Your final message
Short and plain: what you did (item codes, files, commits), what you found, and what needs the owner, if anything. No preamble. Markdown bold, \`code\` and bullet lists render.

${review ? `## The review this discussion is about
${review.title}${review.week_start ? ` (week of ${review.week_start})` : ""}${review.verdict ? ` · verdict ${review.verdict}` : ""}
${review.headline || ""}
${reviewText(review, message.meta?.review_tab)}
` : ""}${history.length ? `## Earlier in this discussion (oldest first)
${history.map((h) => `Owner: ${h.text}\nYou: ${(h.reply || "(no reply)").slice(0, 1500)}`).join("\n\n")}
` : ""}${item ? `## The checklist item to build: [${item.id}] ${item.title}
${item.detail || "(no detail)"}${item.note ? `\nOwner's note: ${item.note}` : ""}
The owner set this item to in progress: that is the go. Build exactly this item, nothing more. Do not change the item's status with the CLI; the worker records the PR on it.${item.build_note ? `

## The owner sent the pull request back with this note
${item.build_note}
The branch already holds your earlier commits: continue from them, address the note, commit.` : ""}
` : ""}
## The owner's message
${message.text}`;
}

function reviewText(r, tab) {
  const tabs = r.meta?.tabs || [];
  const cur = tabs.find((t) => t.key === tab);
  const parts = cur ? [`### ${cur.label} (the tab the owner is reading)\n${cur.body_md}`, `### Summary\n${r.body_md}`]
    : [`### Summary\n${r.body_md}`, ...tabs.map((t) => `### ${t.label}\n${t.body_md}`)];
  const text = parts.join("\n\n");
  return text.length > 40000 ? text.slice(0, 40000) + "\n\n[…truncated; read the rest with the CLI: reviews --full]" : text;
}

async function handle(message, projects) {
  const shortId = message.id.replace(/-/g, "").slice(0, 8);
  const project = projects.find((p) => p.id === message.project_id) || null;
  await api("PATCH", "/api/agent/messages", { id: message.id, status: "seen" });
  if (message.mode === "plan") return planProject(message, project, log); // "Plan this project" button
  if (message.mode === "screen") return screenProject(message, project, log); // Reviews → Screenings → Run
  if (message.mode === "review") return runProjectReview(message, project, log); // Settings → Run now, or the project's own schedule
  if (message.mode === "setup") return setupProject(message, project, log); // Start new project / a project loaded or updated (setup.mjs)
  const dir = project?.dir && fs.existsSync(project.dir) ? project.dir : JARVIS_ROOT;
  const repo = project ? repoInfo(dir) : null;
  // The build run of an in-progress item (queued by queueBuilds): one branch per item, so a PR sent back continues there.
  const item = message.item_id && project ? (await api("GET", "/api/agent/items" + qs({ project: project.id }))).find((i) => i.id === message.item_id) || null : null;
  // The owner picks: "discuss" (read-only, lighter model) or "build" (branch + PR). Old messages: "auto".
  // Reviews → "Build website" / "Try a new visual": a code run with the design skills pack (agent/website.mjs).
  const website = message.mode === "website";
  if (website && (!repo || W.allow_build === false)) {
    const reply = `NEEDS YOU: ${!repo ? `${project?.name || "This project"} has no git repository with a remote, so the website can't be built on a branch. Push the folder to GitHub (or add a remote), then press the button again.` : "Builds are off on this computer (worker.allow_build is false)."}`;
    await api("PATCH", "/api/agent/messages", { id: message.id, status: "needs_you", reply });
    return log("website: can't build", message.id, project?.id);
  }
  let pack = null;
  if (website) {
    try { pack = prepareWebsiteSkills(); }
    catch (e) { log("website skills failed", e.message); }
  }
  const wantedBuild = W.allow_build !== false && (website || message.mode === "build" || (message.mode === "auto" && !!repo));
  let mode = wantedBuild && repo ? "code" : "answer", cwd = dir, wt = null, branch = null;
  if (mode === "code") {
    try { ({ wt, branch } = makeWorktree(project, repo, shortId, item ? `jarvis/item-${item.id}` : website ? `jarvis/website-${shortId}` : null)); cwd = wt; }
    catch (e) { log("worktree failed, answer mode", message.id, e.message); mode = "answer"; }
  }
  // Build mode (project Settings, else worker.build_mode): Lugh loads the agent-skills pack for this run. Website runs have their own pack.
  let buildMode = mode === "code" && !website ? buildModeFor(project, W.build_mode) : null, lugh = null, lughNote = "";
  if (buildMode === "lugh") {
    try { lugh = prepareLughSkills(); }
    catch (e) { log("lugh skills failed, building as goibniu", e.message); buildMode = "goibniu"; lughNote = `\n\n_The Lugh skills couldn't be fetched (${e.message.split("\n")[0]}), so this ran as ${BUILD_MODES.goibniu.label}._`; }
  }
  await api("PATCH", "/api/agent/messages", { id: message.id, status: "working", meta: { mode, branch, ...(buildMode ? { build_mode: buildMode } : {}) } });
  let review = null, history = [];
  if (message.review_id) {
    review = (await api("GET", "/api/agent/reviews" + qs({ id: message.review_id })))[0] || null;
    history = (await api("GET", "/api/agent/messages" + qs({ review: message.review_id, limit: 100 })))
      .filter((m) => m.id !== message.id && m.created_at < message.created_at).slice(-8);
  }
  if (message.thread_id) {
    // A reply in the inbox: give Claude the conversation so far.
    const convo = await api("GET", "/api/agent/messages" + qs({ thread: message.thread_id, limit: 100 }));
    history = [...history, ...convo.filter((m) => m.id !== message.id && m.created_at < message.created_at).slice(-10)];
  }
  let prompt = buildPrompt({ message, project, projects, mode, today: todayTZ(), cwd, review, history, wantedBuild: wantedBuild && mode !== "code", item });
  const playwright = website ? playwrightCommand() : null;
  if (website && mode === "code") prompt += "\n\n" + websiteBrief({ project, kind: message.meta?.kind, site: project.site, siteUrl: project.site_url, playwright,
    pack: pack || { skills: {}, designsDir: null } });
  if (lugh) prompt += "\n\n" + lughBrief({ pack: lugh, sentBack: !!item?.build_note });
  log("run", message.id, { project: project?.id, mode, cwd });
  let res;
  try {
    // Discussions default to a lighter model to spare plan usage; code work uses worker.build_model (null = CLI default).
    const site = website && mode === "code";
    const plugins = site && pack ? [pack.pluginDir] : lugh ? [lugh.pluginDir] : [];
    res = await runClaude({ prompt, cwd, allowedTools: mode === "code" ? [...codeTools(cwd), ...(site ? WEBSITE_TOOLS : [])] : READ_TOOLS, disallowedTools: DENY,
      addDirs: site && pack ? [pack.pluginDir, ...(pack.designsDir ? [pack.designsDir] : [])] : plugins, pluginDirs: plugins,
      model: (mode === "code" ? W.build_model : W.discuss_model) || undefined, maxTurns: site ? 120 : lugh ? 90 : mode === "code" ? 60 : 30,
      // A website takes longer than an item: twice the usual limit; a Lugh build (tests, review, docs) half as long again.
      timeoutMs: (W.timeout_minutes || 25) * runMultiplier({ site, lugh: !!lugh }) * 60_000, log });
  } catch (e) {
    if (wt) tryGit(repo.top, "worktree", "remove", "--force", wt), tryGit(repo.top, "branch", "-D", branch);
    throw e;
  }
  let reply = (res.result || "").trim() || "(Claude finished without a reply.)";
  // What the permission mode refused, so a stuck build can be diagnosed from the log rather than guessed.
  const denied = (res.raw?.permission_denials || []).map((d) => d.tool_input?.command || d.tool_name).filter(Boolean);
  if (denied.length) log("permission denied", message.id, [...new Set(denied)].slice(0, 10));
  let leftovers = false;
  if (wt) {
    try { leftovers = commitLeftovers(wt, item ? item.title : message.text.split("\n")[0].slice(0, 72)); }
    catch (e) { log("leftover commit failed", message.id, e.message); }
  }
  if (res.is_error && res.subtype === "error_max_turns") reply += "\n\n_Stopped at the turn limit; the work may be incomplete._";
  // The PR body and the inbox reply say which build mode ran.
  const modeLine = buildMode ? `Built by ${BUILD_MODES[buildMode].label}${lugh ? ` with ${Object.keys(lugh.skills).length} skills from addyosmani/agent-skills (${LUGH_PLUGIN})` : ""}.` : "";
  reply += lughNote;
  let pr_url = null, commits = 0;
  if (wt) {
    try { ({ pr_url, commits } = finishWorktree(repo, wt, branch, reply, modeLine)); }
    catch (e) { log("push/PR failed", message.id, e.message); reply += `\n\n**The branch \`${branch}\` has commits but the PR could not be opened:** ${e.message.split("\n")[0]}`; }
  }
  if (pr_url) reply += `\n\n**PR:** ${pr_url} (not merged)`;
  if (modeLine) reply += `\n\n_${modeLine}_`;
  if (pr_url && leftovers) reply += "\n\n_The run left edits uncommitted; the worker committed them as the last commit on the PR. Review it before merging._";
  const needsYou = /^\s*NEEDS YOU:/i.test(reply);
  const status = needsYou ? "needs_you" : pr_url ? "done" : "answered";
  await api("PATCH", "/api/agent/messages", { id: message.id, status, reply, meta: { mode, branch: commits ? branch : null, pr_url, cost_usd: res.cost_usd, duration_s: res.duration_s, ...(buildMode ? { build_mode: buildMode } : {}) } });
  if (item) {
    // The item shows the outcome: a PR awaiting the owner, or why the run stopped. It never stays "working".
    const ok = !!pr_url && !needsYou;
    const why = needsYou ? reply.replace(/^\s*NEEDS YOU:\s*/i, "").split("\n")[0].slice(0, 300) : !repo ? "This project has no git repository with a remote, so nothing could be built." : !commits ? `Claude finished without changing any file.${denied.length ? ` Denied: ${[...new Set(denied)].slice(0, 3).join("; ").slice(0, 300)}` : ""}` : !pr_url ? "The branch has commits but the pull request could not be opened." : "";
    await api("PATCH", "/api/agent/items", { project_id: project.id, id: item.id, build_status: ok ? "pr_open" : "failed", pr_url: pr_url || item.pr_url || null, build_note: ok ? "" : why.slice(0, 500) }).catch((e) => log("item build update failed", item.id, e.message));
  }
  log("done", message.id, { status, pr_url, cost_usd: res.cost_usd, duration_s: res.duration_s });
}

/**
 * In-progress items owned by Claude: each becomes one build message (the item's own branch and PR). One new run per
 * pass, and none while another item's run is in flight, so a long build never doubles up. A PR the owner sent back
 * is re-queued with their note.
 */
async function queueBuilds(projects, log) {
  if (W.allow_build === false) return;
  // Trust the filter only as far as the rows say: an older API that ignores ?build= returns every item.
  const inflight = (await api("GET", "/api/agent/items" + qs({ build: "working" }))).filter((i) => i.build_status === "working");
  if (inflight.length) {
    // A run that vanished (worker killed mid-build) must not stay "working" forever.
    const limit = (i) => ((W.timeout_minutes || 25) * runMultiplier({ lugh: buildModeFor(projects.find((p) => p.id === i.project_id), W.build_mode) === "lugh" }) + 10) * 60_000;
    const stale = inflight.filter((i) => i.build_updated_at && Date.now() - +new Date(i.build_updated_at) > limit(i));
    for (const i of stale) await api("PATCH", "/api/agent/items", { project_id: i.project_id, id: i.id, build_status: "failed", build_note: "The build run stopped without finishing (the worker was interrupted). Retry to start it again." }).catch(() => {});
    if (stale.length < inflight.length) return;
  }
  const [queued, back] = await Promise.all([
    api("GET", "/api/agent/items" + qs({ build: "queue" })).then((r) => r.filter((i) => i.status === "doing" && ["claude", "both"].includes(i.owner) && !i.build_status)),
    api("GET", "/api/agent/items" + qs({ build: "sent_back" })).then((r) => r.filter((i) => i.build_status === "sent_back")),
  ]);
  const next = [...back, ...queued].sort((a, b) => Number(b.critical) - Number(a.critical) || (a.due || "9").localeCompare(b.due || "9"))[0];
  if (!next) return;
  const project = projects.find((p) => p.id === next.project_id);
  const repo = project?.dir && fs.existsSync(project.dir) ? repoInfo(project.dir) : null;
  if (!repo) {
    await api("PATCH", "/api/agent/items", { project_id: next.project_id, id: next.id, build_status: "failed", build_note: "This project has no git repository with a remote on this Mac, so Claude can't build it from the dashboard." });
    return log("build skipped, no repo", next.project_id, next.id);
  }
  const text = `Build checklist item [${next.id}]: ${next.title}${next.build_status === "sent_back" ? " (sent back)" : ""}`;
  const { message } = await api("POST", "/api/agent/messages", { text, project_id: next.project_id, status: "new", mode: "build", item_id: next.id, meta: { kind: "build-item" } });
  await api("PATCH", "/api/agent/items", { project_id: next.project_id, id: next.id, build_status: "working" });
  log("build queued", next.project_id, next.id, message?.id);
}

/** Approved PRs: merge them (squash, branch deleted), mark the item done, leave a note in the inbox. Only the owner's click gets here. */
async function mergeApproved(projects, log) {
  const rows = await api("GET", "/api/agent/items" + qs({ build: "merge_requested" }));
  // Only items the owner really asked to merge, with a PR: anything else is untouched (no failure note either).
  const items = rows.filter((i) => i.build_status === "merge_requested" && i.pr_url);
  if (items.length < rows.length) logChanged("merge-filter", rows.length - items.length, "merge pass ignored", rows.length - items.length, "rows that aren't merge-requested with a PR (API filter not applied?)");
  for (const it of items) {
    const project = projects.find((p) => p.id === it.project_id);
    const repo = project?.dir && fs.existsSync(project.dir) ? repoInfo(project.dir) : null;
    try {
      if (!repo) throw new Error("no git repository with a remote for this project on this Mac");
      execFileSync("gh", ["pr", "merge", it.pr_url, "--squash", "--delete-branch"], { cwd: repo.top, encoding: "utf8", timeout: 120_000 });
      tryGit(repo.top, "fetch", "origin", repo.base);
      await api("PATCH", "/api/agent/items", { project_id: it.project_id, id: it.id, status: "done", build_status: "merged", build_note: "" });
      await api("POST", "/api/agent/messages", { project_id: it.project_id, text: `Merged: ${it.title}`, reply: `${it.pr_url} was merged into ${repo.base} on your approval and the item [${it.id}] is done. Pull ${repo.base} in your working copy to get it.`, meta: { kind: "merged" }, item_id: it.id });
      log("merged", it.project_id, it.id, it.pr_url);
      logChanged(`merge:${it.id}`, "merged", "merge state cleared", it.id);
    } catch (e) {
      const why = e.message.split("\n").find((l) => l.trim()) || e.message;
      await api("PATCH", "/api/agent/items", { project_id: it.project_id, id: it.id, build_status: "pr_open", build_note: `Merge failed: ${why.slice(0, 300)}. Fix it on GitHub or send the PR back.` }).catch(() => {});
      logChanged(`merge:${it.id}`, why, "merge failed", it.project_id, it.id, e.message);
    }
  }
}

async function pass() {
  const release = acquireLock("worker");
  if (!release) return log("previous pass still running, skipping");
  try {
    const hb = await api("POST", "/api/agent/heartbeat", { worker: "worker", info: { version: VERSION, host: hostName(), build_mode: buildModeFor(null, W.build_mode) } }).catch((e) => (log("heartbeat failed", e.message), null));
    // Agent and site from different releases disagree on the API: building or merging against it can loop
    // over every item. Pause those two passes (refine and messages stay on) until both are updated.
    const mm = (v) => String(v || "").split(".").slice(0, 2).join(".");
    const skew = hb && mm(hb.version) !== mm(VERSION) && VERSION !== "dev" ? (hb.version || "older than 0.6") : null;
    logChanged("version-skew", skew, skew ? `version skew: agent ${VERSION}, site ${skew}. Build and merge passes paused until both run the same release (git pull, re-run agent/install.sh, redeploy).` : "agent and site versions match again");
    const projects = await api("GET", "/api/agent/projects");
    // Items the owner just added on the site: add steps, priority, estimate and a due date that doesn't clash.
    await refinePending(projects, log).catch((e) => log("refine pass failed", e.message));
    // Security audit reports in each project folder → the project's Security tab; at most once an hour.
    await syncAuditsDue(projects, log).then((r) => r?.synced && log("audits synced", r)).catch((e) => log("audits sync failed", e.message));
    // Unit-economics model files in project folders → evaluated here, results on the project's Finances tab; hourly.
    await syncEconomicsDue(projects, log).then((r) => r?.synced && log("economics synced", r)).catch((e) => log("economics sync failed", e.message));
    // Product metrics (users, visits, revenue…) from each project's source in the config → the project's Stats view; daily.
    await syncMetricsDue(projects, log).then((r) => r?.synced && log("metrics synced", r)).catch((e) => log("metrics sync failed", e.message));
    // Milestones moved on the Timeline: write the new dates into each PRD.md so the next sync keeps them.
    await applyMilestoneMoves(projects, log).then((r) => r.length && log("milestone moves applied", r)).catch((e) => log("milestone write-back failed", e.message));
    // "Refresh project folders" pressed on the Admin page: scan projects_root and register what's new.
    await rescanIfRequested(log).catch((e) => log("rescan failed", e.message));
    // A project loaded for the first time, or updated with a foundation gap: queue its setup session (setup.mjs).
    await queueSetupDue(projects, log).catch((e) => logChanged("setup-queue", e.message, "setup queue failed", e.message));
    // PRs the owner approved on a checklist item, then in-progress items owned by Claude that need a build run.
    if (!skew) {
      // Once a day on a work day: yesterday's undone todos and overdue items back to the top of today (agent/rollover.mjs).
      await rolloverDue(log).then((r) => r && r.workday && log("rollover", { carried: r.carried, parked: r.parks.length, flagged: r.flags.length, waiting: r.waiting.length }, describeRollover(r).join(" | "))).catch((e) => log("rollover failed", e.message));
      // Projects reviewed every N days (Settings) rather than in the weekly run: queue the ones due; hourly. Paused on
      // skew too, since an older site stores a 'review' message as a discussion.
      await queueDueReviews(projects, log).catch((e) => logChanged("review-queue", e.message, "review schedule check failed", e.message));
      await mergeApproved(projects, log).catch((e) => logChanged("merge-pass", e.message, "merge pass failed", e.message));
      await queueBuilds(projects, log).catch((e) => logChanged("build-queue", e.message, "build queue failed", e.message));
    }
    const messages = await api("GET", "/api/agent/messages" + qs({ status: "new", limit: 3 }));
    if (!messages.length) return;
    for (const m of messages) {
      try { await handle(m, projects); }
      catch (e) {
        log("error", m.id, e.message);
        await api("PATCH", "/api/agent/messages", { id: m.id, status: "error", reply: `The worker hit an error: ${e.message.slice(0, 500)}` }).catch((e2) => log("could not report error", e2.message));
      }
    }
  } finally { release(); }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes("--dry-run")) {
    // Sample: the first two folders under projects_root (no API calls).
    let names = [];
    try { names = fs.readdirSync(PROJECTS_ROOT, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name).slice(0, 2); } catch {}
    const projects = (names.length ? names : ["example"]).map((n) => ({ id: n.toLowerCase().replace(/[^a-z0-9]+/g, "-"), name: n, kind: "checklist", dir: path.join(PROJECTS_ROOT, n) }));
    for (const p of projects) console.log(`${p.id}: repo=${JSON.stringify(repoInfo(p.dir))}`);
    const msg = { id: "0f3c9a7e-1111-2222-3333-444455556666", project_id: projects[0].id, text: `Sample: what's overdue on ${projects[0].name}?`, mode: "discuss" };
    console.log("\n--- prompt ---\n" + buildPrompt({ message: msg, project: projects[0], projects, mode: "code", today: todayTZ(), cwd: "/tmp/wt" }));
    console.log(`\n--- build mode ---\ndefault: ${BUILD_MODES[buildModeFor(null, W.build_mode)].label} (worker.build_mode); per project: Settings on the site`);
    console.log("\n--- Lugh brief (appended to a Lugh build's prompt) ---\n" + lughBrief({ pack: null }));
    console.log("\n--- code tools ---\n" + CODE_TOOLS.join("\n") + "\n--- deny ---\n" + DENY.join("\n"));
  } else {
    pass().catch((e) => { log("pass failed", e.message); process.exitCode = 1; });
  }
}
