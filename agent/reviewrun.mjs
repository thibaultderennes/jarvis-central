// Advisor reviews outside the Monday run: a project's own schedule (Settings → "every N days", other than 7) and
// "Run now". Both are inbox messages with mode 'review'; the worker runs `weekly.mjs --only <id> --days <N>` for each.
//
//   node reviewrun.mjs due     which projects the worker would queue now (no API writes)
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { api, qs, cacheDir, dateTZ, todayTZ, AGENT_DIR } from "./lib.mjs";
import { reviewEvery, reviewsDue } from "./projectsettings.mjs";

const OPEN = ["new", "seen", "working"];
const CHECK_EVERY_MS = 60 * 60_000; // the due check runs at most once an hour
const triedFile = () => path.join(cacheDir(), "reviews.tried.json");
const readTried = () => { try { return JSON.parse(fs.readFileSync(triedFile(), "utf8")) || {}; } catch { return {}; } };

/** {project id: YYYY-MM-DD of its newest project review}, from one request. */
async function lastReviews() {
  const rows = await api("GET", "/api/agent/reviews" + qs({ type: "project", limit: 500 }));
  const last = {};
  for (const r of rows) {
    if (!r.project_id) continue;
    const d = dateTZ(new Date(r.created_at));
    if (!last[r.project_id] || d > last[r.project_id]) last[r.project_id] = d;
  }
  return last;
}

/** What is due now, and which projects already have a review queued or running. */
export async function dueNow(projects) {
  const [last, open] = await Promise.all([lastReviews(), api("GET", "/api/agent/messages" + qs({ limit: 100 }))]);
  const busy = new Set(open.filter((m) => m.mode === "review" && OPEN.includes(m.status)).map((m) => m.project_id));
  return reviewsDue(projects, { last, tried: readTried(), today: todayTZ(), busy });
}

/** Hourly: queue a review message for each project whose own schedule says it is due. */
export async function queueDueReviews(projects, log) {
  const stamp = path.join(cacheDir(), "reviews.last-check");
  try { if (Date.now() - fs.statSync(stamp).mtimeMs < CHECK_EVERY_MS) return []; } catch {}
  try { fs.writeFileSync(stamp, new Date().toISOString()); } catch {}
  const due = await dueNow(projects);
  const tried = readTried();
  for (const p of due) {
    const days = reviewEvery(p);
    await api("POST", "/api/agent/messages", { text: `Scheduled review of ${p.name} (every ${days} days).`, project_id: p.id, status: "new", mode: "review", meta: { kind: "scheduled", days } });
    tried[p.id] = todayTZ();
    log("review queued", p.id, { days });
  }
  if (due.length) try { fs.writeFileSync(triedFile(), JSON.stringify(tried)); } catch {}
  return due.map((p) => p.id);
}

const runWeekly = (args, timeoutMs) => new Promise((resolve) => {
  execFile(process.execPath, [path.join(AGENT_DIR, "weekly.mjs"), ...args], { timeout: timeoutMs, maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) =>
    resolve({ ok: !err, error: err ? (String(stderr || "").trim().split("\n").pop() || err.message) : null }));
});

/** A mode 'review' message: the advisor review of one project over its last N days, then the reply in the inbox. */
export async function runProjectReview(message, project, log) {
  if (!project) throw new Error("Pick a project for the review.");
  const days = Math.max(1, Math.min(90, Math.round(Number(message.meta?.days)) || reviewEvery(project)));
  await api("PATCH", "/api/agent/messages", { id: message.id, status: "working", meta: { mode: "review", days } });
  const t0 = Date.now();
  log("review run", project.id, { days, kind: message.meta?.kind });
  // Three advisors and a synthesis, each with its own time limit in weekly.mjs: allow them all.
  const res = await runWeekly(["--only", project.id, "--days", String(days)], 80 * 60_000);
  const duration_s = Math.round((Date.now() - t0) / 1000);
  const latest = res.ok ? (await api("GET", "/api/agent/reviews" + qs({ type: "project", project: project.id, limit: 5 })).catch(() => []))
    .filter((r) => +new Date(r.created_at) >= t0 - 60_000).sort((a, b) => b.created_at.localeCompare(a.created_at))[0] : null;
  if (!res.ok || !latest) {
    const why = res.error || "the run finished without posting a review";
    await api("PATCH", "/api/agent/messages", { id: message.id, status: "error", reply: `The review of ${project.name} didn't finish: ${why.slice(0, 400)}. The worker log has the details; press Run now to try again.`, meta: { mode: "review", days, duration_s } });
    return log("review failed", project.id, why);
  }
  const reply = `**${latest.title}**${latest.verdict ? ` · ${latest.verdict.replace("-", " ")}` : ""}\n\n${latest.headline || "Review posted."}\n\nIt is on ${project.name}'s Reviews page.`;
  await api("PATCH", "/api/agent/messages", { id: message.id, status: "answered", reply, meta: { mode: "review", days, review: latest.id, duration_s, cost_usd: latest.meta?.cost_usd ?? null } });
  log("review done", project.id, { verdict: latest.verdict, duration_s });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd] = process.argv.slice(2);
  if (cmd === "due") {
    const projects = (await api("GET", "/api/agent/projects")).filter((p) => !p.archived);
    const due = await dueNow(projects);
    for (const p of projects.filter((x) => x.reviews_enabled !== false)) console.log(p.id.padEnd(22), `every ${reviewEvery(p)} days`, due.some((d) => d.id === p.id) ? "· due now" : reviewEvery(p) === 7 ? "· weekly run" : "");
  } else console.log("usage: node reviewrun.mjs due");
}
