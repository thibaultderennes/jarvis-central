#!/usr/bin/env node
// Checks everything Jarvis Central Dashboard needs on this machine, and says how to fix what's missing.
//   node agent/doctor.mjs
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { scanProjects } from "./projects.mjs";
import { CONFIG, CONFIG_EXISTS, CONFIG_ERROR, CONFIG_FILE, PROJECTS_ROOT, ENV_FILE, JARVIS_ROOT, TZ, loadConfig, api } from "./lib.mjs";

let fails = 0, warns = 0;
const ok = (msg) => console.log(`✓ ${msg}`);
const bad = (msg, fix) => { fails++; console.log(`✗ ${msg}\n    fix: ${fix}`); };
const warn = (msg, fix) => { warns++; console.log(`! ${msg}${fix ? `\n    tip: ${fix}` : ""}`); };
const run = (cmd, args, timeout = 15_000) => { try { return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout }).trim(); } catch (e) { return e.stdout ? String(e.stdout).trim() : null; } };
const has = (bin) => !!run("/bin/sh", ["-c", `command -v ${bin}`]);

console.log("Jarvis Central Dashboard — doctor\n");

// runtime
const major = Number(process.versions.node.split(".")[0]);
major >= 20 ? ok(`node ${process.versions.node}`) : bad(`node ${process.versions.node} is too old`, "install Node.js 20 or newer (https://nodejs.org or `brew install node`)");
has("git") ? ok("git") : bad("git not found", "install git (`xcode-select --install` on macOS)");

// claude CLI
if (!has("claude")) bad("claude CLI not found", "install Claude Code (https://docs.claude.com/en/docs/claude-code) and run `claude` once to log in");
else {
  const s = run("claude", ["auth", "status"]);
  let j = null; try { j = JSON.parse(s); } catch {}
  if (j?.loggedIn) ok(`claude CLI logged in (${j.authMethod === "claude.ai" ? "claude.ai subscription: usage counts against your plan" : j.authMethod || "api"})`);
  else bad("claude CLI is not logged in", "run `claude` and log in (or `claude auth login`)");
}

// gh (optional: needed for Build it PRs and PR data in reviews)
if (!has("gh")) warn("gh (GitHub CLI) not found: \"Build it (PR)\" can't open pull requests and reviews won't see PRs", "`brew install gh && gh auth login`");
else /Logged in/i.test(run("/bin/sh", ["-c", "gh auth status 2>&1"]) || "") ? ok("gh logged in") : warn("gh is installed but not logged in", "`gh auth login`");

// vercel (needed to deploy the website)
if (!has("vercel")) bad("vercel CLI not found (needed to deploy the website)", "`npm i -g vercel` then `vercel login`");
else { const who = run("vercel", ["whoami"], 20_000); who ? ok(`vercel logged in as ${who.split("\n").pop()}`) : bad("vercel CLI is not logged in", "`vercel login`"); }

// scheduler
if (process.platform === "darwin") ok("macOS: jobs run with launchd (agent/install.sh)");
else warn(`${process.platform}: launchd isn't available`, "use cron: `node agent/schedule.mjs cron`, then paste the lines into `crontab -e`");

// config
if (!CONFIG_EXISTS) bad(`no ${path.relative(JARVIS_ROOT, CONFIG_FILE)}`, "`cp jarvis.config.example.json jarvis.config.json` and edit it (SETUP.md, phase 1)");
else if (CONFIG_ERROR) bad(`jarvis.config.json is not valid JSON: ${CONFIG_ERROR}`, "fix the syntax (a trailing comma is the usual cause)");
else {
  ok("jarvis.config.json found");
  try { Intl.DateTimeFormat(undefined, { timeZone: TZ }); ok(`timezone ${TZ}`); } catch { bad(`timezone "${TZ}" isn't valid`, "use an IANA name like Europe/Paris or America/New_York"); }
  if (!CONFIG.owner_name) warn("owner_name is empty", "set it in jarvis.config.json: prompts and reports use it");
}
if (fs.existsSync(PROJECTS_ROOT)) {
  const ps = scanProjects(), missing = ps.filter((p) => !p.hasClaude || !p.hasPrd);
  ok(`projects_root ${PROJECTS_ROOT} (${ps.length} projects)`);
  if (missing.length) warn(`${missing.length} project(s) without CLAUDE.md or PRD.md: ${missing.map((p) => p.id).join(", ")}`, "`node agent/projects.mjs scaffold`");
} else bad(`projects_root ${PROJECTS_ROOT} doesn't exist`, "set projects_root in jarvis.config.json to the folder that holds one folder per project");

// secrets + API
if (!fs.existsSync(ENV_FILE)) bad(`${ENV_FILE} missing`, "`node app/scripts/setup.mjs secrets` (SETUP.md, website phase)");
else {
  const mode = fs.statSync(ENV_FILE).mode & 0o777;
  mode & 0o077 ? bad(`${ENV_FILE} is readable by other users (${mode.toString(8)})`, `chmod 600 ${ENV_FILE}`) : ok(`${ENV_FILE} (600)`);
  const env = loadConfig();
  if (!env.JARVIS_URL || !env.JARVIS_AGENT_TOKEN) bad("JARVIS_URL or JARVIS_AGENT_TOKEN missing in the env file", "`node app/scripts/setup.mjs secrets`");
  else {
    try { const ps = await api("GET", "/api/agent/projects"); ok(`API reachable at ${env.JARVIS_URL} (${ps.length} projects registered)`); if (!ps.length) warn("no projects registered yet", "`node agent/projects.mjs sync`"); }
    catch (e) { bad(`API not reachable: ${e.message}`, e.status === 401 ? "the token doesn't match the website's JARVIS_AGENT_TOKEN: re-run `node app/scripts/setup.mjs secrets` then redeploy" : "deploy the website (SETUP.md) and check JARVIS_URL"); }
  }
}

// scheduled jobs (macOS)
if (process.platform === "darwin") {
  const loaded = ["worker", "plan", "weekly"].filter((n) => run("launchctl", ["print", `gui/${process.getuid()}/com.jarvis.${n}`]) !== null);
  loaded.length === 3 ? ok("launchd jobs loaded: worker, plan, weekly") : warn(`launchd jobs loaded: ${loaded.join(", ") || "none"}`, "`agent/install.sh` once the website works");
}

console.log(`\n${fails ? `${fails} problem(s) to fix` : "All required checks pass"}${warns ? `, ${warns} note(s)` : ""}.`);
process.exitCode = fails ? 1 : 0;
