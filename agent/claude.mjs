// Headless `claude -p` runner shared by the worker and the weekly reviews.
import { spawn } from "node:child_process";

export const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";

/**
 * Run `claude -p` and return {result, cost_usd, duration_s, raw, is_error}.
 * Permission mode `dontAsk`: anything not in --allowedTools is denied without a prompt
 * (headless runs have nobody to answer one).
 */
export function runClaude({ prompt, cwd, allowedTools = [], disallowedTools = [], addDirs = [], tools, maxTurns = 60, timeoutMs = 25 * 60_000, model, log = () => {} }) {
  const args = ["-p", prompt, "--output-format", "json", "--permission-mode", "dontAsk", "--max-turns", String(maxTurns)];
  if (tools !== undefined) args.push("--tools", tools); // "" = no tools at all (pure text/JSON calls)
  if (allowedTools.length) args.push("--allowedTools", ...allowedTools);
  if (disallowedTools.length) args.push("--disallowedTools", ...disallowedTools);
  for (const d of addDirs) args.push("--add-dir", d);
  if (model) args.push("--model", model);
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
      resolve({ result: j.result ?? "", cost_usd: j.total_cost_usd ?? null, duration_s, is_error: !!j.is_error || j.subtype !== "success", subtype: j.subtype, raw: j });
    });
  });
}
