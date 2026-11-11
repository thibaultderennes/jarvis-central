// Checks the scheduled jobs run before they spend money or a week's slot: is Claude still signed in, is the website
// up, and did the Monday run get going this week (the worker starts it again if not).
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { api, cacheDir, todayTZ, TZ, JARVIS_ROOT } from "./lib.mjs";
import { runClaude } from "./claude.mjs";
import { isAuthError, firstLine, missedWeeklyRun } from "./weeklyrun.mjs";
import { schedule } from "./schedule.mjs";

const stamp = (name) => path.join(cacheDir(), name);
const readStamp = (name) => { try { return fs.readFileSync(stamp(name), "utf8").trim(); } catch { return ""; } };
const writeStamp = (name, v) => fs.writeFileSync(stamp(name), String(v));

/**
 * One tiny `claude -p` call, no tools. {ok: true} or {ok: false, auth, why}: `auth` means the login is gone
 * (so stop and tell the owner); otherwise it's something else (network, outage) and the caller decides.
 */
export async function checkClaude({ log = () => {} } = {}) {
  try {
    const res = await runClaude({ prompt: "Reply with the single word OK.", cwd: JARVIS_ROOT, tools: "", maxTurns: 1, timeoutMs: 3 * 60_000, model: "haiku", log });
    const text = `${res.result}\n${res.raw?.error || ""}`;
    if (isAuthError(text)) return { ok: false, auth: true, why: firstLine(text) };
    if (res.is_error) return { ok: false, auth: false, why: firstLine(text) || res.subtype || "claude returned an error" };
    return { ok: true };
  } catch (e) {
    return { ok: false, auth: isAuthError(e.message), why: firstLine(e.message) };
  }
}

/** One Needs-you inbox message about the Claude login, at most once every 12 hours. */
export async function tellLoginExpired(why, job, { log = () => {} } = {}) {
  const last = Date.parse(readStamp("claude-login.last-alert") || 0) || 0;
  if (Date.now() - last < 12 * 3600_000) return log("claude login alert already sent", new Date(last).toISOString());
  await api("POST", "/api/agent/messages", {
    text: `The ${job} couldn't start: Claude isn't signed in on your Mac.`,
    status: "needs_you",
    reply: `NEEDS YOU: open Terminal and run \`claude\` once to sign in again. Claude said: "${why}".\n\nNothing ran, so nothing was charged. The worker tries again within the hour after you sign in${job === "Monday run" ? " and runs the missed reviews" : ""}.`,
    meta: { kind: "claude_login", job },
  }).then(() => { writeStamp("claude-login.last-alert", new Date().toISOString()); log("claude login alert posted"); })
    .catch((e) => log("could not post the claude login alert", e.message));
}

/**
 * Wait until the website answers (after a Mac wakes, the network is often not up yet; Neon may be cold). Retries
 * network errors and 5xx, not 4xx. Returns true, or false after the last try.
 */
export async function waitForSite({ log = () => {}, delays = [30, 60, 120, 240, 480] } = {}) {
  for (let i = 0; ; i++) {
    try { await api("GET", "/api/agent/projects"); if (i) log("website reachable again"); return true; }
    catch (e) {
      if (e.status && e.status < 500) throw e; // a bad token or URL won't fix itself
      if (i >= delays.length) { log("website still unreachable, giving up", e.message); return false; }
      log(`website unreachable (${e.message}), retrying in ${delays[i]} s`);
      await new Promise((r) => setTimeout(r, delays[i] * 1000));
    }
  }
}

/** The Monday run passed its checks today: the worker won't start it again this week. */
export const markWeeklyStarted = () => writeStamp("weekly.last-run", todayTZ());

/**
 * Worker pass: if this week's Monday run never got past its checks (the Mac was asleep or offline, the site was down,
 * Claude was signed out), start it now. The run's own checks make a failed retry cheap, so it tries once per pass.
 */
export function catchUpWeekly({ log = () => {} } = {}) {
  const lastRun = readStamp("weekly.last-run");
  if (!lastRun) return markWeeklyStarted(); // first pass after install or upgrade: start counting from now
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour12: false, hour: "2-digit", minute: "2-digit" }).formatToParts(new Date()).map((p) => [p.type, p.value]));
  const slot = missedWeeklyRun({ today: todayTZ(), nowMinutes: (+parts.hour % 24) * 60 + +parts.minute, sched: schedule().weekly, lastRun });
  if (!slot) return;
  log("the Monday run of", slot, "never got going, starting it now");
  const child = spawn(process.execPath, [path.join(JARVIS_ROOT, "agent", "weekly.mjs")], { cwd: JARVIS_ROOT, detached: true, stdio: "ignore" });
  child.on("error", (e) => log("could not start the Monday run", e.message));
  child.unref();
}
