#!/usr/bin/env node
// A project's advisor review run by a Claude Code routine (a cloud session, no awake computer) instead of weekly.mjs.
// The routine's own session is the model: this script builds the bundle and the prompts, checks each answer and posts
// the result. Setup and the trial plan: docs/routines.md.
//
//   node routine.mjs prompt <project> [--days N] [--as review]   the text to paste as the routine's instructions
//   node routine.mjs start <project> [--dir <checkout>] [--days N] [--week YYYY-MM-DD] [--as review]
//                                                       build the bundle and the advisor prompts
//   node routine.mjs next <project>                     the next prompt to answer; posts the review after the last one
//   node routine.mjs compare <project> [--limit N]      routine runs next to this computer's runs: time, cost, failures
//
// --as trial (default) posts a separate report on the project's Docs and reviews ("Routine trial · …"), so a trial never
// replaces the review this computer posts for the same week. --as review posts it as the project's review itself.
import fs from "node:fs";
import path from "node:path";
import { api, qs, cacheDir, parseModelJSON, OWNER } from "./lib.mjs";
import { ROLES, personaFor, oneLiner, advisorPrompt, synthesisPrompt } from "./advisors.mjs";
import { projectBundle, reviewPeriod, reviewTitle, idlePost } from "./weekly.mjs";

const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const [cmd, id] = argv;
const VERDICTS = ["on-track", "at-risk", "off-track"];
const workDir = (pid) => cacheDir("routine", pid);
const stateFile = (pid) => path.join(workDir(pid), "state.json");
const die = (msg) => { console.error(msg); process.exit(1); };

async function project(pid) {
  const p = (await api("GET", "/api/agent/projects")).find((x) => x.id === pid);
  if (!p) die(`No project "${pid}" on the site (node agent/jarvis.mjs projects lists them).`);
  return p;
}

/** Trial runs post a `doc` keyed by meta.file, one per period: the weekly review for that week stays untouched. */
function postFor(post, as) {
  if (as === "review") return post;
  return { ...post, type: "doc", week_start: undefined, verdict: undefined, title: `Routine trial · ${post.title}`,
    meta: { ...post.meta, file: `routine-trial/${post.week_start}${post.meta?.period_days ? `-${post.meta.period_days}d` : ""}`, review_verdict: post.verdict } };
}

function routinePrompt(pid, { days, as }) {
  const flags = `${days ? ` --days ${days}` : ""}${as === "review" ? " --as review" : ""}`;
  return `Run the Jarvis Central advisor review of the project "${pid}" and post it. Work only with the commands below; do not edit, commit or push anything in any repository and do not open pull requests.

1. Find the two clones in this session: the Jarvis Central repository (it has agent/routine.mjs) and the "${pid}" project's own repository (the same folder if the project is Jarvis Central itself).
2. From the Jarvis Central clone run: node agent/routine.mjs start ${pid} --dir <path of the project's clone>${flags}
3. Run: node agent/routine.mjs next ${pid}
   It prints a prompt file and an answer file. Read the prompt file and do exactly what it says, as that advisor: read the bundle and the project's files, use web search when the prompt allows it. Then write ONLY the JSON object it asks for to the answer file (the Write tool; no code fences).
4. Repeat step 3 until it prints "posted". If it says an answer is invalid, fix that answer file and run it again.
5. Finish with one line: the verdict and headline it printed, or the exact error if a command failed.

If JARVIS_URL is unset or the site answers 401/403, stop and say so: the environment needs JARVIS_URL and the agent token (docs/routines.md).`;
}

async function start(pid) {
  const p = await project(pid);
  const dir = opt("dir") ? path.resolve(opt("dir")) : p.dir;
  if (dir && !fs.existsSync(dir)) die(`--dir ${dir} does not exist`);
  const days = opt("days") ? Math.max(1, Math.min(90, Math.round(Number(opt("days"))) || 7)) : null;
  const W = reviewPeriod({ days, week: opt("week") });
  const pp = { ...p, dir }; // the session's clone, not the path on the owner's computer
  const out = workDir(pid);
  for (const f of fs.readdirSync(out)) fs.rmSync(path.join(out, f), { force: true });
  // No Claude Code transcripts here: the only ones in a cloud session are this run's own, which would read as the owner's.
  const b = await projectBundle(pp, W, [], new Map(), await api("GET", "/api/agent/events" + qs({ since: W.start.toISOString() })).then((e) => e.filter((x) => x.at < W.end.toISOString())));
  const file = path.join(out, "bundle.md");
  fs.writeFileSync(file, b.text + `\n## Not in this bundle\nThis review ran in a cloud session (a Claude Code routine): ${OWNER}'s Claude Code sessions and typed messages stay on their computer, so the session counts above are 0 by construction, not a sign of no work. Pull requests may be missing too if \`gh\` could not reach GitHub. Don't draw conclusions from their absence.\n`);
  const meta = { ...b.meta, runner: "routine", sessions: null, active_minutes: null, ...(W.rolling ? { period_days: W.days } : {}) };
  const as = opt("as") === "review" ? "review" : "trial";
  if (!b.activity) {
    const r = await api("POST", "/api/agent/reviews", postFor(idlePost(pp, W, { ...meta, duration_s: 0 }), as));
    return console.log(`posted (idle: no activity between ${W.startDate} and ${W.lastDate}) ${r.id || ""}`);
  }
  const prev = (await api("GET", "/api/agent/reviews" + qs({ type: "project", project: pid, limit: 2 }))).find((r) => r.week_start !== W.startDate);
  const line = oneLiner(dir);
  const steps = ROLES.map((role) => {
    const persona = personaFor(pp, role.key);
    fs.writeFileSync(path.join(out, `${role.key}.prompt.md`), advisorPrompt({ p: pp, role: role.key, W, file, persona, line, prevHeadline: prev?.headline }));
    return { key: role.key, label: role.label, persona: persona.native ? "native" : "generic" };
  });
  fs.writeFileSync(stateFile(pid), JSON.stringify({ p: { ...p, dir }, W: { ...W, start: W.start.toISOString(), end: W.end.toISOString() }, meta, steps, as, started_at: new Date().toISOString() }, null, 1));
  console.log(`Bundle ${file} (${b.text.length} chars), ${steps.length} advisors: ${steps.map((s) => `${s.key} (${s.persona} persona)`).join(", ")}.\nNow run: node agent/routine.mjs next ${pid}`);
}

/** The answer in <step>.json, checked; null when not written yet. Throws on an invalid answer. */
function answer(out, key, synthesis = false) {
  const f = path.join(out, `${key}.json`);
  if (!fs.existsSync(f)) return null;
  const j = parseModelJSON(fs.readFileSync(f, "utf8"));
  if (!j.body_md || !j.headline) throw new Error(`${f}: needs "headline" and "body_md"`);
  if (!VERDICTS.includes(j.verdict)) throw new Error(`${f}: "verdict" must be one of ${VERDICTS.join(", ")}`);
  if (synthesis && j.proposals !== undefined && !Array.isArray(j.proposals)) throw new Error(`${f}: "proposals" must be a list`);
  return j;
}

async function next(pid) {
  let s;
  try { s = JSON.parse(fs.readFileSync(stateFile(pid), "utf8")); } catch { die(`No run in progress for ${pid}: run node agent/routine.mjs start ${pid} first.`); }
  if (s.posted) return console.log(`posted already: ${s.posted}`);
  const out = workDir(pid);
  const ask = (key) => console.log(`Answer as ${key}.\nPrompt: ${path.join(out, `${key}.prompt.md`)}\nWrite the JSON object to: ${path.join(out, `${key}.json`)}\nThen run: node agent/routine.mjs next ${pid}`);
  const reports = [];
  for (const st of s.steps) {
    let j;
    try { j = answer(out, st.key); } catch (e) { die(`Invalid answer: ${e.message}. Fix it, then run next again.`); }
    if (!j) return ask(st.key);
    reports.push({ ...st, ...j });
  }
  const W = { ...s.W, start: new Date(s.W.start), end: new Date(s.W.end) };
  const synFile = path.join(out, "synthesis.prompt.md");
  if (!fs.existsSync(synFile)) fs.writeFileSync(synFile, synthesisPrompt({ p: s.p, W, reports, meta: s.meta }));
  let syn;
  try { syn = answer(out, "synthesis", true); } catch (e) { die(`Invalid answer: ${e.message}. Fix it, then run next again.`); }
  if (!syn) return ask("synthesis");
  const duration_s = Math.round((Date.now() - new Date(s.started_at)) / 1000);
  const tabs = reports.map((r) => ({ key: r.key, label: r.label, body_md: r.body_md, verdict: r.verdict, headline: r.headline }));
  // cost_usd stays null: a routine draws on the subscription's usage, not a metered per-run price
  const post = { type: "project", project_id: s.p.id, week_start: W.startDate, title: reviewTitle(s.p, W), verdict: syn.verdict, headline: syn.headline, body_md: syn.body_md,
    meta: { ...s.meta, cost_usd: null, duration_s, tabs, ...(Array.isArray(syn.proposals) && syn.proposals.length ? { proposals: syn.proposals.slice(0, 5) } : {}) } };
  const r = await api("POST", "/api/agent/reviews", postFor(post, s.as));
  s.posted = r.id || new Date().toISOString();
  fs.writeFileSync(stateFile(pid), JSON.stringify(s, null, 1));
  console.log(`posted [${syn.verdict}] ${syn.headline} (${Math.round(duration_s / 60)} min${s.as === "trial" ? ", as a trial report on Docs and reviews" : ""})`);
}

const median = (a) => { const v = a.filter((x) => typeof x === "number").sort((x, y) => x - y); return v.length ? v[Math.floor(v.length / 2)] : null; };
const mins = (s) => (typeof s === "number" ? `${Math.round(s / 60)} min` : "—");

async function compare(pid) {
  const limit = Number(opt("limit")) || 20;
  const [reviews, docs, msgs] = await Promise.all([
    api("GET", "/api/agent/reviews" + qs({ type: "project", project: pid, limit })),
    api("GET", "/api/agent/reviews" + qs({ type: "doc", project: pid, limit: 100 })),
    api("GET", "/api/agent/messages" + qs({ limit: 100 })),
  ]);
  const rows = [...reviews, ...docs.filter((d) => String(d.meta?.file || "").startsWith("routine-trial/"))]
    .map((r) => ({ at: r.created_at.slice(0, 16).replace("T", " "), period: r.week_start || String(r.meta.file).slice(14), runner: r.meta?.runner || "local", verdict: r.verdict || r.meta?.review_verdict || "—",
      duration_s: r.meta?.duration_s ?? null, cost: r.meta?.cost_usd ?? null, failed: (r.meta?.tabs || []).filter((t) => /run failed/.test(t.body_md || "")).length }))
    .sort((a, b) => b.at.localeCompare(a.at));
  console.log(`Advisor reviews of ${pid}, newest first (runner "local" = this computer; older reviews have no runner or time recorded):`);
  for (const r of rows) console.log(`  ${r.at}  ${r.period.padEnd(13)} ${r.runner.padEnd(8)} ${r.verdict.padEnd(10)} ${mins(r.duration_s).padStart(7)}  ${r.cost == null ? "     —" : `$${r.cost.toFixed(2)}`.padStart(6)}${r.failed ? `  ${r.failed} advisor(s) failed` : ""}`);
  const failedRuns = msgs.filter((m) => m.project_id === pid && m.mode === "review" && m.status === "error");
  for (const runner of ["local", "routine"]) {
    const rs = rows.filter((r) => r.runner === runner);
    if (!rs.length) continue;
    const cost = rs.map((r) => r.cost).filter((c) => typeof c === "number");
    console.log(`${runner}: ${rs.length} posted, median ${mins(median(rs.map((r) => r.duration_s)))}, ${cost.length ? `median $${median(cost).toFixed(2)} per review` : "cost not metered (subscription usage)"}, ${rs.filter((r) => r.failed).length} with a failed advisor`);
  }
  console.log(`Runs on this computer that never posted (inbox, last 100 messages): ${failedRuns.length}${failedRuns.length ? ` — ${failedRuns.map((m) => String(m.created_at || "").slice(0, 10)).join(", ")}` : ""}.`);
  console.log("Routine runs that never posted show only on the routine's page (claude.ai/code/routines): count them there.");
}

if (cmd === "prompt" && id) console.log(routinePrompt(id, { days: opt("days"), as: opt("as") }));
else if (cmd === "start" && id) await start(id);
else if (cmd === "next" && id) await next(id);
else if (cmd === "compare" && id) await compare(id);
else console.log("usage: node routine.mjs prompt|start|next|compare <project> (see the header of agent/routine.mjs)");
