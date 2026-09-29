#!/usr/bin/env node
// Renders the three scheduled jobs from jarvis.config.json:
//   worker  every worker.interval_seconds          (inbox → claude -p)
//   plan    planner.run  {weekday, time}           (weekly plan → calendars)
//   weekly  reviews.run  {weekday, time}           (Monday reviews)
//
//   node schedule.mjs launchd --out DIR   write com.jarvis.*.plist into DIR (macOS; install.sh uses this)
//   node schedule.mjs cron                print crontab lines (Linux; paste into `crontab -e`)
//   node schedule.mjs show                print the schedule in plain words
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { CONFIG, HOME, JARVIS_ROOT, TZ, LOG_DIR } from "./lib.mjs";

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]; // index = launchd/cron weekday
const which = (bin) => { try { return execFileSync("/bin/sh", ["-c", `command -v ${bin}`], { encoding: "utf8" }).trim(); } catch { return ""; } };

function when(run, fallback) {
  const r = { ...fallback, ...(run || {}) };
  const day = DAYS.indexOf(String(r.weekday).toLowerCase());
  const m = String(r.time).match(/^(\d{1,2}):(\d{2})$/);
  if (day < 0) throw new Error(`Bad weekday "${r.weekday}" (use sunday…saturday)`);
  if (!m || +m[1] > 23 || +m[2] > 59) throw new Error(`Bad time "${r.time}" (use HH:MM, 24 h)`);
  return { day, hour: +m[1], minute: +m[2], label: `${DAYS[day][0].toUpperCase() + DAYS[day].slice(1)}s at ${r.time}` };
}

export function schedule() {
  const interval = Math.max(30, Number(CONFIG.worker?.interval_seconds) || 60);
  return {
    worker: { interval, label: `every ${interval} s` },
    plan: when(CONFIG.planner?.run, { weekday: "sunday", time: "17:00" }),
    weekly: when(CONFIG.reviews?.run, { weekday: "monday", time: "05:00" }),
  };
}

function renderLaunchd(outDir) {
  const node = which("node") || process.execPath;
  const claude = which("claude");
  if (!claude) console.error("warning: `claude` is not on PATH; the jobs need it (install Claude Code and log in).");
  const dirs = [...new Set([path.dirname(node), claude && path.dirname(claude), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"].filter(Boolean))];
  const s = schedule();
  const block = {
    worker: `  <key>StartInterval</key>\n  <integer>${s.worker.interval}</integer>\n  <key>RunAtLoad</key>\n  <true/>`,
    plan: cal(s.plan), weekly: cal(s.weekly),
  };
  fs.mkdirSync(outDir, { recursive: true });
  for (const name of ["worker", "plan", "weekly"]) {
    const tpl = fs.readFileSync(path.join(JARVIS_ROOT, "agent", "launchd", `com.jarvis.${name}.plist.template`), "utf8");
    const out = tpl.replaceAll("{{NODE}}", node).replaceAll("{{REPO}}", JARVIS_ROOT).replaceAll("{{HOME}}", HOME)
      .replaceAll("{{LOGS}}", LOG_DIR).replaceAll("{{PATH}}", dirs.join(":")).replaceAll("{{TZ}}", TZ).replace("{{SCHEDULE}}", block[name]);
    fs.writeFileSync(path.join(outDir, `com.jarvis.${name}.plist`), out);
  }
  return s;
}
const cal = (w) => `  <key>StartCalendarInterval</key>\n  <dict>\n    <key>Weekday</key><integer>${w.day}</integer>\n    <key>Hour</key><integer>${w.hour}</integer>\n    <key>Minute</key><integer>${w.minute}</integer>\n  </dict>`;

function cron() {
  const s = schedule(), node = which("node") || "node";
  const env = `cd ${JARVIS_ROOT} && JARVIS_TZ=${TZ} PATH=${[path.dirname(node), path.dirname(which("claude") || "/usr/local/bin/claude"), "/usr/bin", "/bin"].join(":")}`;
  const log = (n) => `>> ${LOG_DIR}/${n}.cron.log 2>&1`;
  const every = s.worker.interval >= 60 ? `*/${Math.max(1, Math.round(s.worker.interval / 60))} * * * *` : "* * * * *";
  return [
    `# Jarvis Central Dashboard — times are the machine's local time; set CRON_TZ=${TZ} above these lines if your cron supports it`,
    `${every} ${env} ${node} agent/worker.mjs ${log("worker")}`,
    `${s.plan.minute} ${s.plan.hour} * * ${s.plan.day} ${env} ${node} agent/plan.mjs ${log("plan")}`,
    `${s.weekly.minute} ${s.weekly.hour} * * ${s.weekly.day} ${env} ${node} agent/weekly.mjs ${log("weekly")}`,
  ].join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, ...rest] = process.argv.slice(2);
  try {
    if (cmd === "launchd") {
      const i = rest.indexOf("--out");
      const out = i >= 0 ? rest[i + 1] : path.join(HOME, "Library", "LaunchAgents");
      const s = renderLaunchd(out);
      console.log(`rendered into ${out}: worker ${s.worker.label}, plan ${s.plan.label}, weekly ${s.weekly.label}`);
    } else if (cmd === "cron") console.log(cron());
    else if (cmd === "show") { const s = schedule(); console.log(`worker: ${s.worker.label}\nplan:   ${s.plan.label}\nweekly: ${s.weekly.label}\n(timezone ${TZ})`); }
    else { console.log("Usage: node schedule.mjs launchd --out DIR | cron | show"); process.exitCode = cmd ? 1 : 0; }
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
