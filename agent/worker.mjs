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
import { api, qs, makeLog, acquireLock, todayTZ, hostName, JARVIS_ROOT, CLI, CONFIG, TZ, OWNER, PROJECTS_ROOT } from "./lib.mjs";
import { runClaude } from "./claude.mjs";

const VERSION = (() => { try { return fs.readFileSync(path.join(JARVIS_ROOT, "VERSION"), "utf8").trim(); } catch { return "dev"; } })();
const W = CONFIG.worker || {};
const log = makeLog("worker");

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
const DENY = ["Bash(git push:*)", "Bash(gh pr merge:*)", "Bash(gh pr create:*)", "Bash(rm -rf:*)", "Bash(curl:*)", "Bash(vercel:*)", "Bash(railway:*)", "Bash(stripe:*)", "Bash(supabase:*)"];

const git = (dir, ...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120_000 }).trim();
const tryGit = (dir, ...args) => { try { return git(dir, ...args); } catch { return null; } };

function repoInfo(dir) {
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

function makeWorktree(project, repo, shortId) {
  const wtRoot = path.join(path.dirname(repo.top), ".jarvis-worktrees");
  fs.mkdirSync(wtRoot, { recursive: true });
  const wt = path.join(wtRoot, `${project.id}-${shortId}`);
  const branch = `jarvis/${shortId}`;
  git(repo.top, "fetch", "origin", repo.base);
  git(repo.top, "worktree", "add", wt, "-b", branch, `origin/${repo.base}`);
  linkNodeModules(repo.top, wt);
  return { wt, branch };
}

function finishWorktree(repo, wt, branch, reply) {
  let pr_url = null;
  const ahead = Number(tryGit(wt, "rev-list", "--count", `origin/${repo.base}..HEAD`) || 0);
  if (ahead > 0) {
    git(wt, "push", "-u", "origin", branch);
    const title = tryGit(wt, "log", "--reverse", "--format=%s", `origin/${repo.base}..HEAD`)?.split("\n")[0] || branch;
    const body = `${reply}\n\n---\nOpened by the Jarvis worker from a message on the dashboard. Not merged.`;
    pr_url = execFileSync("gh", ["pr", "create", "--head", branch, "--base", repo.base, "--title", title, "--body", body], { cwd: wt, encoding: "utf8", timeout: 120_000 }).trim().split("\n").pop();
  }
  tryGit(repo.top, "worktree", "remove", "--force", wt);
  if (!ahead) tryGit(repo.top, "branch", "-D", branch);
  return { pr_url, commits: ahead };
}

export function buildPrompt({ message, project, projects, mode, today, cwd, review = null, history = [], wantedBuild = false }) {
  const where = project ? `${project.name} (${project.id})` : "no specific project";
  const others = projects.map((p) => `- ${p.id}: ${p.name} [${p.kind}${p.state ? ", " + p.state : ""}]${p.dir ? " " + p.dir : ""}`).join("\n");
  return `You are the Jarvis worker: Claude Code running headless on ${OWNER === "the owner" ? "the owner's" : OWNER + "'s"} computer. ${OWNER === "the owner" ? "The owner" : OWNER} ("the founder" in checklist owner fields) left the message below on Jarvis Central, their all-projects dashboard. They are not watching this session. Your final message is shown to them as the reply in the dashboard inbox.

Today: ${today} (${TZ}). Project: ${where}. Working directory: ${cwd}.
The Jarvis inbox check at session start is already handled by this worker: ignore any instruction (for example in ~/.claude/CLAUDE.md) to check the Jarvis inbox or run the jarvis skill's inbox step.

## Rules (set by the owner)
- You may answer questions, research, plan days, and read or edit checklist items and todos with the Jarvis CLI.
${mode === "code"
    ? `- CODE MODE: this directory is a fresh git worktree on its own branch. Work only here. Make focused changes, commit them with clear messages (git add / git commit), and run the project's tests, typecheck or lint if they exist. Do not push and do not open a PR: the worker does that after you finish. Never touch .env files, secrets, credentials, billing, or production data.`
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
${CLI_CMD} reviews [--type project|recap|coaching|jarvis|doc] [--project P] [--limit N] [--full]
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
  const dir = project?.dir && fs.existsSync(project.dir) ? project.dir : JARVIS_ROOT;
  const repo = project ? repoInfo(dir) : null;
  // The owner picks: "discuss" (read-only, lighter model) or "build" (branch + PR). Old messages: "auto".
  const wantedBuild = W.allow_build !== false && (message.mode === "build" || (message.mode === "auto" && !!repo));
  let mode = wantedBuild && repo ? "code" : "answer", cwd = dir, wt = null, branch = null;
  if (mode === "code") {
    try { ({ wt, branch } = makeWorktree(project, repo, shortId)); cwd = wt; }
    catch (e) { log("worktree failed, answer mode", message.id, e.message); mode = "answer"; }
  }
  await api("PATCH", "/api/agent/messages", { id: message.id, status: "working", meta: { mode, branch } });
  let review = null, history = [];
  if (message.review_id) {
    review = (await api("GET", "/api/agent/reviews" + qs({ id: message.review_id })))[0] || null;
    history = (await api("GET", "/api/agent/messages" + qs({ review: message.review_id, limit: 100 })))
      .filter((m) => m.id !== message.id && m.created_at < message.created_at).slice(-8);
  }
  const prompt = buildPrompt({ message, project, projects, mode, today: todayTZ(), cwd, review, history, wantedBuild: wantedBuild && mode !== "code" });
  log("run", message.id, { project: project?.id, mode, cwd });
  let res;
  try {
    // Discussions default to a lighter model to spare plan usage; code work uses worker.build_model (null = CLI default).
    res = await runClaude({ prompt, cwd, allowedTools: mode === "code" ? CODE_TOOLS : READ_TOOLS, disallowedTools: DENY,
      model: (mode === "code" ? W.build_model : W.discuss_model) || undefined, maxTurns: mode === "code" ? 60 : 30,
      timeoutMs: (W.timeout_minutes || 25) * 60_000, log });
  } catch (e) {
    if (wt) tryGit(repo.top, "worktree", "remove", "--force", wt), tryGit(repo.top, "branch", "-D", branch);
    throw e;
  }
  let reply = (res.result || "").trim() || "(Claude finished without a reply.)";
  if (res.is_error && res.subtype === "error_max_turns") reply += "\n\n_Stopped at the turn limit; the work may be incomplete._";
  let pr_url = null, commits = 0;
  if (wt) {
    try { ({ pr_url, commits } = finishWorktree(repo, wt, branch, reply)); }
    catch (e) { log("push/PR failed", message.id, e.message); reply += `\n\n**The branch \`${branch}\` has commits but the PR could not be opened:** ${e.message.split("\n")[0]}`; }
  }
  if (pr_url) reply += `\n\n**PR:** ${pr_url} (not merged)`;
  const needsYou = /^\s*NEEDS YOU:/i.test(reply);
  const status = needsYou ? "needs_you" : pr_url ? "done" : "answered";
  await api("PATCH", "/api/agent/messages", { id: message.id, status, reply, meta: { mode, branch: commits ? branch : null, pr_url, cost_usd: res.cost_usd, duration_s: res.duration_s } });
  log("done", message.id, { status, pr_url, cost_usd: res.cost_usd, duration_s: res.duration_s });
}

async function pass() {
  const release = acquireLock("worker");
  if (!release) return log("previous pass still running, skipping");
  try {
    await api("POST", "/api/agent/heartbeat", { worker: "worker", info: { version: VERSION, host: hostName() } }).catch((e) => log("heartbeat failed", e.message));
    const messages = await api("GET", "/api/agent/messages" + qs({ status: "new", limit: 3 }));
    if (!messages.length) return;
    const projects = await api("GET", "/api/agent/projects");
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
    console.log("\n--- code tools ---\n" + CODE_TOOLS.join("\n") + "\n--- deny ---\n" + DENY.join("\n"));
  } else {
    pass().catch((e) => { log("pass failed", e.message); process.exitCode = 1; });
  }
}
