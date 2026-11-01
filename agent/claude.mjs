// Headless `claude -p` runner shared by the worker and the weekly reviews.
import { spawn } from "node:child_process";
import os from "node:os";

export const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";

/*
 * Secrets no headless run may read, whatever its allow-list says.
 *
 * Several runs read text nobody on this machine wrote — web pages and GitHub READMEs (the Monday repo scout, the
 * advisor reviews), calendar event titles anyone who can invite the owner to a meeting controls, pull-request text.
 * Those same runs hold `Read` by tool name, which is not scoped to the run's own directories, so text that talks a
 * run into reading the agent token is one step from a run that can also send it somewhere. A deny rule beats an
 * allow rule, so denying the paths that hold credentials closes that step for every run at once.
 *
 * Built from the home directory at run time, so no personal path is in the repo. Both the `~` form and the resolved
 * absolute form are sent: a rule that doesn't match the CLI's path syntax simply does nothing, and one of the two
 * always does.
 */
const SECRET_DIRS = ["~/.config/jarvis", "~/.ssh", "~/.gnupg", "~/.config/gh", "~/.aws", "~/.config/gcloud", "~/.kube"];
const SECRET_FILES = ["**/.env", "**/.env.*", "**/*.pem", "**/*.p12", "**/*.pfx", "**/id_rsa*", "**/id_ed25519*", "~/.netrc", "~/.npmrc"];

/** `Read(...)` deny rules for every path that holds a credential. `home` is injectable for the tests. */
export function secretDeny(home = os.homedir()) {
  const abs = (p) => (p.startsWith("~") ? home + p.slice(1) : p);
  const out = [];
  for (const d of SECRET_DIRS) out.push(`Read(${d}/**)`, `Read(${abs(d)}/**)`);
  for (const f of SECRET_FILES) { out.push(`Read(${f})`); if (f.startsWith("~")) out.push(`Read(${abs(f)})`); }
  return [...new Set(out)];
}

/** The argv for one `claude -p` run. Pure, so the tests can check what every run is and isn't allowed to do. */
export function claudeArgs({ prompt, allowedTools = [], disallowedTools = [], addDirs = [], pluginDirs = [], resume = null, tools, maxTurns = 60, model, home }) {
  const args = ["-p", prompt, "--output-format", "json", "--permission-mode", "dontAsk", "--max-turns", String(maxTurns)];
  if (tools !== undefined) args.push("--tools", tools); // "" = no tools at all (pure text/JSON calls)
  if (allowedTools.length) args.push("--allowedTools", ...allowedTools);
  // Always denied, on top of whatever the caller denies: no run reads the owner's credentials.
  args.push("--disallowedTools", ...new Set([...disallowedTools, ...secretDeny(home)]));
  for (const d of addDirs) args.push("--add-dir", d);
  for (const d of pluginDirs) args.push("--plugin-dir", d);
  if (resume) args.push("--resume", resume); // continue that session (same transcript) with this prompt // a local plugin for this run only (skills)
  if (model) args.push("--model", model);
  return args;
}

/**
 * Run `claude -p` and return {result, cost_usd, duration_s, raw, is_error}.
 * Permission mode `dontAsk`: anything not in --allowedTools is denied without a prompt
 * (headless runs have nobody to answer one).
 */
export function runClaude({ prompt, cwd, allowedTools = [], disallowedTools = [], addDirs = [], pluginDirs = [], resume = null, tools, maxTurns = 60, timeoutMs = 25 * 60_000, model, log = () => {} }) {
  const args = claudeArgs({ prompt, allowedTools, disallowedTools, addDirs, pluginDirs, resume, tools, maxTurns, model });
  const started = Date.now();
  return new Promise((resolve, reject) => {
    // detached → own process group, so a timeout kills claude and every tool it spawned
    const child = spawn(CLAUDE_BIN, args, { cwd, detached: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, JARVIS_HEADLESS: "1" } });
    let out = "", err = "";
    child.stdout.on("data", (b) => (out += b));
    child.stderr.on("data", (b) => (err += b));
    const timer = setTimeout(() => {
      log("claude timeout, killing process group", child.pid);
      try { process.kill(-child.pid, "SIGTERM"); } catch {}
      setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch {} }, 10_000);
    }, timeoutMs);
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const duration_s = Math.round((Date.now() - started) / 1000);
      if (signal) return reject(new Error(`claude was stopped (${signal}) after ${duration_s} s${signal === "SIGTERM" ? " — hit the time limit" : ""}`));
      let j;
      try { j = JSON.parse(out); } catch {
        return reject(new Error(`claude exited ${code} without JSON output: ${(err || out).slice(-600)}`));
      }
      resolve({ result: j.result ?? "", session_id: j.session_id ?? null, cost_usd: j.total_cost_usd ?? null, duration_s, is_error: !!j.is_error || j.subtype !== "success", subtype: j.subtype, raw: j });
    });
  });
}
