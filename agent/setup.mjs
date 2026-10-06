#!/usr/bin/env node
// Project setup: a guided session that analyses a project folder and writes or proposes its foundation (PRD, value /
// pain / ideal customer, CLAUDE.md, README, .gitignore, brand, stack, design system, database and auth, env vars,
// staging and production, error tracking, non-goals; see foundation.mjs). It runs through the worker as message mode
// `setup`, from three places, all the same session:
//   - "Start new project" on the Admin page (meta.kind "new"): the worker creates the folder under projects_root,
//     registers it, then runs the session on the empty folder;
//   - a project loaded for the first time (approved after "Refresh project folders", or registered by
//     `projects.mjs sync`): queueSetupDue() queues it on the next pass;
//   - a project folder updated since the last run, by the rule in foundation.mjs shouldRunSetup().
// The session is headless: it can't ask, so questions only the owner can answer become `decide` items owned by the
// founder (with a recommended answer). It uses pinned skills from github.com/mattpocock/skills (MIT) for asking the
// right questions and writing the docs. Claude only reads; this script writes the files: on a `jarvis/setup-<id>`
// branch + PR in a git repo with a remote (the worker's worktree flow), straight into the folder otherwise, and
// in both cases only files that don't exist yet (in a repo, a missing section may be appended to an existing doc).
// Nothing the owner wrote is ever rewritten. Pieces it can't write become checklist items marked critical.
//
//   node setup.mjs check [id]           what the automatic runs would do now, per project (read-only)
//   node setup.mjs <id> --dry-run       the folder analysis and the prompt, without running Claude (read-only)
//   node setup.mjs queue <id>           queue a setup run for the worker now (ignores the automatic rules)
//   node setup.mjs new "<name>"         queue "Start new project" (same as the Admin button)
//   node setup.mjs skills               fetch the pinned skills and print where the pack is
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { api, qs, CONFIG, PROJECTS_ROOT, JARVIS_ROOT, OWNER, TZ, todayTZ, parseModelJSON, makeLog, cacheDir } from "./lib.mjs";
import { runClaude } from "./claude.mjs";
import { preparePack } from "./skillpacks.mjs";
import { FOUNDATION, detectFoundation, shouldRunSetup, validateProjectName, safeRelPath, appendSection } from "./foundation.mjs";
import { DEFAULT_SECTIONS, sectionRoles } from "./structure.mjs";
import { gather, normalizeItems, placeItems } from "./planproject.mjs";
import { repoInfo, makeWorktree, finishWorktree } from "./worker.mjs";

export const S = { auto_on_load: true, auto_on_update: true, cooldown_days: 7, check_minutes: 60, model: null, ...(CONFIG.project_setup || {}) };
const W = CONFIG.worker || {};
const KEY = "projects.setup";
const TEMPLATES = path.join(JARVIS_ROOT, "templates");
const COLORS = ["p1", "p2", "p3", "p4", "p5", "p6", "p7"];
const read = (f, max = 200_000) => { try { const t = fs.readFileSync(f, "utf8"); return t.length > max ? t.slice(0, max) : t; } catch { return null; } };
const git = (dir, ...args) => { try { return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 20_000 }).trim(); } catch { return null; } };

/* ---------------- the skills pack ---------------- */
// Pinned so every install runs the same skills; bump the commit in a tool release. MIT licence (LICENSE in the repo).
export const SOURCES = [
  { repo: "mattpocock/skills", ref: "6fd947921b935b7e1e69293a200400f0fdd5c15f", licence: "MIT",
    skills: {
      grilling: "skills/productivity/grilling",               // the design tree of decisions; questions with a recommended answer
      "to-questionnaire": "skills/productivity/to-questionnaire", // questions someone else answers async: one idea each, most important first
      "to-spec": "skills/engineering/to-spec",                 // problem, solution, user stories, out of scope
      "domain-modeling": "skills/engineering/domain-modeling", // the project's terms (GLOSSARY.md), only when the code has them
      "writing-for-agents": "skills/productivity/writing-for-agents", // how to write CLAUDE.md so agents follow it
    } },
];
export const PLUGIN_NAME = "jarvis-setup";
export function prepareSetupSkills() {
  return preparePack(PLUGIN_NAME, SOURCES, "Planning and writing skills for Jarvis project setup runs (pinned; see agent/setup.mjs).");
}

/* ---------------- reading the folder ---------------- */
/** The top level and docs/ (two levels, audit reports left out): file names, the markdown and dot files, package names. */
export function readFolder(dir) {
  const files = [];
  const list = (rel) => { try { return fs.readdirSync(path.join(dir, rel), { withFileTypes: true }); } catch { return []; } };
  for (const e of list("")) if (e.isFile()) files.push(e.name);
  for (const e of list("docs")) {
    if (e.isFile()) files.push(`docs/${e.name}`);
    else if (e.isDirectory() && !e.name.startsWith(".") && e.name !== "audits") for (const f of list(`docs/${e.name}`)) if (f.isFile()) files.push(`docs/${e.name}/${f.name}`);
  }
  files.sort();
  const text = {};
  for (const f of files.filter((x) => /\.md$/i.test(x) || /^\.(gitignore|env\.(example|sample|template))$/.test(x)).slice(0, 80)) text[f] = read(path.join(dir, f)) || "";
  const deps = new Set();
  for (const sub of ["", "app", "web", "server", "api", "frontend", "backend"]) {
    try { const pkg = JSON.parse(fs.readFileSync(path.join(dir, sub, "package.json"), "utf8")); for (const d of Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) })) deps.add(d); } catch {}
  }
  return { files, text, deps: [...deps] };
}

/** The folder's own git remote (not a parent repo's). */
function ownRemote(dir) {
  const top = git(dir, "rev-parse", "--show-toplevel");
  return top && path.resolve(top) === path.resolve(dir) ? git(dir, "remote", "get-url", "origin") : null;
}

/** What shouldRunSetup compares: the missing pieces, a hash of the foundation docs, and git HEAD. */
export function fingerprint(dir) {
  const ctx = readFolder(dir);
  const remote = ownRemote(dir);
  const found = detectFoundation({ ...ctx, remote });
  const h = crypto.createHash("sha1");
  for (const f of Object.keys(ctx.text).sort()) h.update(f + "\0" + ctx.text[f] + "\0");
  const top = git(dir, "rev-parse", "--show-toplevel");
  const head = top && path.resolve(top) === path.resolve(dir) ? git(dir, "rev-parse", "HEAD") : null;
  return { ...found, docs: h.digest("hex"), head, ctx, remote };
}

/* ---------------- state: kv projects.setup = {<project id>: record} ---------------- */
// record = { status: queued|running|done|failed, at, trigger, missing, handled, docs, head, message_id?, pr_url?, review_id?, error? }
async function getState() {
  try { const v = (await api("GET", `/api/agent/kv?key=${KEY}`)).value; return v && typeof v === "object" ? v : null; }
  catch (e) { if (e.status === 404) return null; throw e; }
}
async function putRecord(id, rec) {
  const cur = (await getState()) || {};
  cur[id] = { ...(cur[id] || {}), ...rec };
  await api("PUT", "/api/agent/kv", { key: KEY, value: cur });
}
const opts = () => ({ autoOnLoad: S.auto_on_load !== false, autoOnUpdate: S.auto_on_update !== false, cooldownDays: Number(S.cooldown_days ?? 7) });

/* ---------------- the automatic runs ---------------- */
const stampFile = () => path.join(cacheDir(), "setup-check.json");
/**
 * Every worker pass: queue one setup run when a project needs it (shouldRunSetup). Projects never set up are checked
 * every pass; the others every `project_setup.check_minutes`. After an upgrade every existing project gets one run, one
 * at a time; `setup.mjs queue <id>` runs one by hand.
 */
export async function queueSetupDue(projects, log) {
  if (S.auto_on_load === false && S.auto_on_update === false) return null;
  const live = projects.filter((p) => !p.archived && p.dir && fs.existsSync(p.dir));
  // No kv yet (first pass after the upgrade): every existing project counts as never set up, so each gets one run,
  // one at a time (the check below waits while a run is queued or running).
  const state = (await getState()) || {};
  const now = new Date().toISOString();
  if (Object.values(state).some((r) => ["queued", "running"].includes(r?.status) && Date.now() - +new Date(r.at || 0) < 2 * 3600_000)) return null;
  let last = 0;
  try { last = JSON.parse(fs.readFileSync(stampFile(), "utf8")).at || 0; } catch {}
  const full = Date.now() - last >= Number(S.check_minutes ?? 60) * 60_000;
  for (const p of live) {
    const rec = state[p.id] || null;
    if (rec && !full) continue;
    const fp = fingerprint(p.dir);
    const d = shouldRunSetup(rec, fp, opts());
    if (!d.run) continue;
    const text = d.trigger === "load" ? `Set up ${p.name}: analyse the folder and write or propose its foundation docs.` : `Fill the gaps in ${p.name}'s foundation: ${d.reason}.`;
    const { message } = await api("POST", "/api/agent/messages", { text, project_id: p.id, status: "new", mode: "setup", meta: { kind: "setup", trigger: d.trigger, reason: d.reason } });
    await putRecord(p.id, { status: "queued", at: now, trigger: d.trigger, message_id: message?.id || null });
    log("setup queued", p.id, d);
    return { queued: p.id, ...d };
  }
  if (full) try { fs.writeFileSync(stampFile(), JSON.stringify({ at: Date.now() })); } catch {}
  return null;
}

/* ---------------- "Start new project" ---------------- */
/** Names already in use: every registered id (archived too), every folder under projects_root. */
async function takenNames() {
  const ps = await api("GET", "/api/agent/projects?all=1");
  let folders = [];
  try { folders = fs.readdirSync(PROJECTS_ROOT); } catch {}
  return { ps, taken: [...ps.map((p) => p.id), ...folders, ...folders.map((f) => f.toLowerCase())] };
}

/** Creates the folder and registers the project. Returns { project } or { error } (a sentence for the owner). */
export async function createProject(name, { root = PROJECTS_ROOT } = {}) {
  const { ps, taken } = await takenNames();
  const v = validateProjectName(name, taken);
  if (v.error) return { error: v.error };
  const include = (CONFIG.projects?.include || []).map(String), exclude = (CONFIG.projects?.exclude || []).map(String);
  if (exclude.includes(v.id)) return { error: `"${v.id}" is in projects.exclude in jarvis.config.json, so Jarvis would never see it. Pick another name.` };
  if (include.length && !include.includes(v.id)) return { error: `jarvis.config.json lists projects.include, so a folder called "${v.id}" would be archived on the next sync. Add "${v.id}" to projects.include, then start it again.` };
  const dir = path.join(root, v.id);
  if (fs.existsSync(dir)) return { error: `A folder called "${v.id}" already exists in your projects folder. Use "Refresh project folders" to load it instead.` };
  fs.mkdirSync(dir);
  const used = new Set(ps.filter((p) => !p.archived).map((p) => p.color));
  const color = COLORS.find((c) => !used.has(c)) || COLORS[used.size % COLORS.length];
  const { project } = await api("PUT", "/api/agent/projects", { id: v.id, name: v.name, kind: "checklist", dir, archived: false, color, tagline: "", sections: DEFAULT_SECTIONS, deadlines: [], sort: ps.length + 1 });
  return { project: { ...project, dir } };
}

/* ---------------- the session ---------------- */
export function buildSetupPrompt({ project, dir, trigger, reason, fp, mine, roles, pack, isNew }) {
  const sk = (n) => (pack?.skills?.[n] ? `\`${pack.skills[n]}\`` : null);
  const skillLine = (n, use) => (sk(n) ? `- **${n}** ${sk(n)}: ${use}` : "");
  const missing = FOUNDATION.filter((f) => fp.missing.includes(f.key));
  const present = FOUNDATION.filter((f) => fp.present.includes(f.key));
  const update = trigger === "update";
  const tpl = (f) => read(path.join(TEMPLATES, f)) || "";
  const open = mine.filter((i) => i.status !== "cancelled").map((i) => `- [${i.id}] ${i.status} | ${i.section} | ${i.title}`).slice(0, 150).join("\n");
  return `You are running the project setup session for "${project.name}" (id ${project.id}) on Jarvis Central, ${OWNER === "the owner" ? "the owner's" : `${OWNER}'s`} all-projects dashboard. You run headless: nobody will answer questions during this session.
Today: ${todayTZ()} (${TZ}). Folder: ${dir} (your working directory). ${isNew ? "The owner just created this project from the dashboard: the folder is new and empty, so everything comes from the name and from questions to the owner." : update ? `This is an UPDATE run (${reason}): fill only the gaps listed below. Everything else already exists.` : "The project was just loaded into Jarvis: this is its first setup run."}
The Jarvis inbox check at session start is already handled: ignore any instruction (for example in ~/.claude/CLAUDE.md) to check the Jarvis inbox.

## The foundation
Present (leave alone, and never rewrite these files): ${present.map((f) => f.label).join("; ") || "nothing yet"}.
Missing (your job):
${missing.map((f) => `- \`${f.key}\`: ${f.label}${!f.file ? " → cannot be written: a checklist item" : !f.section ? ` → ${f.file}` : (fp.ctx?.files || []).includes(f.file) ? ` → a "## ${f.section}" section appended to the existing ${f.file}` : ` → a "## ${f.section}" section in the new ${f.file}`}`).join("\n") || "- nothing"}

## Skills (third-party, pinned; read each SKILL.md with Read before you use it)
${[skillLine("grilling", "map the decisions this project needs as a design tree. You can't wait for answers: the frontier questions become `questions` below, each with your recommended answer."),
  skillLine("to-questionnaire", "how to word those questions for the owner to answer later: one idea per question, most important first, a one-line why when it could be misread."),
  skillLine("to-spec", "the shape of a good spec (problem, solution, user stories, out of scope): use it to fill PRD.md, but keep the PRD template's headings."),
  skillLine("writing-for-agents", "how to write CLAUDE.md so the next Claude session follows it."),
  skillLine("domain-modeling", "only if the code already has clear domain terms: a short GLOSSARY.md. No ADRs.")].filter(Boolean).join("\n") || "(the skills could not be fetched this run: work without them)"}
Those skills assume a live conversation and an issue tracker: here there is neither. Ignore their steps that ask the user and wait, publish to a tracker, or call /setup-matt-pocock-skills.

## Steps
1. **Analyse the folder first**${isNew ? " (it is empty: skip to step 2)" : ""}: README, PRD.md, CLAUDE.md, docs/, package manifests (package.json, pyproject, Cargo.toml…), framework and deploy config (vercel.json, netlify.toml, Dockerfile, fly.toml…), the code's structure, \`git log --oneline -30\`, \`git status\`. Don't open secrets (.env files, credentials, keys).
2. **Draft each missing piece** from what you found. State facts plainly; where you can't tell, write \`TODO(owner): <the exact question>\` and add that question to \`questions\`. Never invent facts, users, numbers, prices, dates, metrics or quotes: a short honest doc with TODOs beats a confident made-up one. Values you know: project id \`${project.id}\`, owner ${OWNER}, Jarvis repo ${JARVIS_ROOT}, today ${todayTZ()}.
   - PRD.md follows the template below. Value, pain and the ideal customer go in Problem and Users; non-goals in Non-goals. In the milestones table only put dates you found; otherwise one row \`| TODO(owner): YYYY-MM-DD | TODO(owner): first milestone |\`.
   - CLAUDE.md follows the template below, "How we work" included.
   - docs/architecture.md holds Stack, Data and auth, Environments (staging and production), Error tracking: what exists, with files cited, and TODO(owner) for the choices not made yet.
   - .env.example lists variable names the code reads (grep for process.env, import.meta.env, os.environ…), each with a comment; never a real value.
   - docs/BRAND.md: name, one-liner, audience, voice and tone, look; mostly TODO(owner) unless the folder says.
   - DESIGN.md: only from what the code already uses (CSS variables, Tailwind config, fonts); otherwise a short skeleton with TODO(owner).
   - README.md: what it is, how to run it (commands you verified in the manifests), links to PRD.md and CLAUDE.md.
   - .gitignore: fits the stack you found (always .env*, keep !.env.example; node_modules, build output, OS files).
3. ${update ? "Only the missing pieces. A file that exists is the owner's: never rewrite it." : "A file that exists is the owner's: never rewrite it."} When a missing piece is a section of an existing file (e.g. Non-goals in an existing PRD.md), put it in \`append\`: it is added at the end of that file under its own heading, nothing else changes.
4. **Checklist items** for what you can't write: the GitHub repository, choosing and wiring a database, auth, error tracking, staging and production, and anything the docs say is needed and isn't there. Owner "founder" for accounts, money, identity and decisions, "claude" for code. Set \`foundation\` to the piece's key. Never repeat an item already on the checklist (below), done or not.
5. **Questions** only the owner can answer (audience, pricing, scope, the name, the brand, hosting budget…): each becomes a "decide" item. Ask the frontier: questions you can ask now without guessing earlier answers. At most 12, most important first.

## Current checklist
${open || "(empty)"}

## Template: PRD.md
${tpl("PRD.md")}

## Template: CLAUDE.md
${tpl("CLAUDE.md")}

## Output ONLY one JSON object, no code fences
{"headline": "one sentence: where the project's foundation stands",
 "summary_md": "## What's here\\n…\\n## What this run wrote or proposes\\n…\\n## What's still missing\\n…",
 "files": [{"path": "relative/path.md", "content": "the whole file", "foundation": ["keys it covers"]}],
 "append": [{"path": "an existing file", "content": "## Heading\\n…", "foundation": ["keys"]}],
 "questions": [{"id": "short-kebab-id", "title": "the question, ending with ?", "detail": "why it matters and the options", "recommended": "your recommended answer", "critical": true, "foundation": "key or null"}],
 "items": [{"id": "short-kebab-id", "section": "${roles.list.map((s) => s.id).join("|")}", "title": "…", "detail": "one line of purpose, then 3–6 numbered steps", "owner": "founder|claude|both", "critical": true, "priority": 1, "estimate_minutes": 60, "foundation": "key or null"}]}
At most 12 files, 12 questions and 12 items. Paths are relative to the folder.`;
}

/** Turns the model's files/append into writes or proposals. Never overwrites: a path that exists anywhere is skipped. */
export function planWrites(out, { dir, target, canCreate, canAppend }) {
  const exists = (rel) => fs.existsSync(path.join(dir, rel)) || (target && fs.existsSync(path.join(target, rel)));
  const writes = [], proposals = [], skipped = [];
  for (const f of (Array.isArray(out.files) ? out.files : []).slice(0, 12)) {
    const rel = safeRelPath(f?.path);
    const content = typeof f?.content === "string" ? f.content.slice(0, 100_000) : "";
    if (!rel || !content.trim()) { skipped.push({ path: f?.path, why: "not a path it may write" }); continue; }
    if (exists(rel)) { skipped.push({ path: rel, why: "already exists: left as it is", foundation: [].concat(f.foundation || []) }); continue; }
    (canCreate ? writes : proposals).push({ path: rel, kind: "create", content: content.trimEnd() + "\n", foundation: [].concat(f.foundation || []) });
  }
  for (const a of (Array.isArray(out.append) ? out.append : []).slice(0, 12)) {
    const rel = safeRelPath(a?.path);
    if (!rel || typeof a?.content !== "string" || !a.content.trim()) continue;
    const base = canAppend ? read(path.join(target, rel), 2_000_000) : read(path.join(dir, rel), 2_000_000);
    if (base == null) { skipped.push({ path: rel, why: "an append needs an existing file" }); continue; }
    const next = appendSection(base, a.content.slice(0, 50_000));
    if (next == null) { skipped.push({ path: rel, why: "that section is already there", foundation: [].concat(a.foundation || []) }); continue; }
    (canAppend ? writes : proposals).push({ path: rel, kind: "append", content: canAppend ? next : a.content.trim() + "\n", foundation: [].concat(a.foundation || []) });
  }
  return { writes, proposals, skipped };
}

/** Writes the planned files; a file that appeared since the plan is left alone. Returns the writes that happened. */
function applyWrites(target, writes) {
  const done = [];
  for (const w of writes) {
    const abs = path.join(target, w.path);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    try { fs.writeFileSync(abs, w.content, { flag: w.kind === "create" ? "wx" : "w" }); done.push(w); }
    catch (e) { if (e.code !== "EEXIST") throw e; }
  }
  return done;
}

/** The worker's handler for message mode "setup". */
export async function setupProject(message, project, log) {
  const meta = message.meta || {};
  const reply = (status, text, extra = {}) => api("PATCH", "/api/agent/messages", { id: message.id, status, reply: text, meta: { mode: "setup", ...extra } });
  let isNew = false;
  if (meta.kind === "new") {
    const made = await createProject(meta.name || message.text);
    if (made.error) { await reply("needs_you", `NEEDS YOU: ${made.error}`); return log("setup: new project refused", made.error); }
    project = made.project; isNew = true;
    log("setup: project created", project.id, project.dir);
  }
  if (!project) throw new Error("Pick a project for the setup run.");
  const dir = project.dir && fs.existsSync(project.dir) ? project.dir : null;
  if (!dir) throw new Error(`The project folder isn't on this Mac (${project.dir || "no folder set"}).`);
  const trigger = isNew ? "new" : meta.trigger || "manual";
  await putRecord(project.id, { status: "running", at: new Date().toISOString(), trigger, message_id: message.id });
  await api("PATCH", "/api/agent/messages", { id: message.id, status: "working", meta: { mode: "setup", project_id: project.id } });
  try {
    return await runSetup({ message, project, dir, trigger, reason: meta.reason || "", isNew, log, reply });
  } catch (e) {
    await putRecord(project.id, { status: "failed", at: new Date().toISOString(), error: String(e.message || e).slice(0, 300) }).catch(() => {});
    throw e;
  }
}

async function runSetup({ message, project, dir, trigger, reason, isNew, log, reply }) {
  const fp = fingerprint(dir);
  const g = await gather(project);
  const gg = { ...g, setup: [] }; // this run covers the plan's setup items itself
  let pack = null;
  try { pack = prepareSetupSkills(); } catch (e) { log("setup skills failed", e.message); }
  const prompt = buildSetupPrompt({ project, dir, trigger, reason, fp, mine: g.mine, roles: g.roles, pack, isNew });
  log("setup run", project.id, { trigger, missing: fp.missing });
  const res = await runClaude({
    prompt, cwd: dir, model: S.model || W.build_model || undefined, maxTurns: 60, timeoutMs: (W.timeout_minutes || 25) * 60_000, log,
    allowedTools: ["Read", "Grep", "Glob", "Bash(git log:*)", "Bash(git status:*)", "Bash(git show:*)", "Bash(ls:*)", "Bash(gh repo view:*)"],
    disallowedTools: ["Edit", "Write", "Bash(git push:*)", "Bash(git commit:*)", "Bash(rm:*)", "Bash(curl:*)"],
    addDirs: [TEMPLATES, ...(pack ? [pack.pluginDir] : [])], pluginDirs: pack ? [pack.pluginDir] : [],
  });
  const out = parseModelJSON(res.result);

  // Where the files go: a branch + PR in a repo with a remote; the folder itself otherwise (new files only).
  const builds = W.allow_build !== false;
  const repo = repoInfo(dir);
  const shortId = message.id.replace(/-/g, "").slice(0, 8);
  let wt = null, branch = null, pr_url = null, commits = 0, writeNote = "";
  if (repo && builds) {
    try { ({ wt, branch } = makeWorktree(project, repo, shortId, `jarvis/setup-${project.id}`)); }
    catch (e) { log("setup worktree failed", e.message); writeNote = `The branch could not be made (${e.message.split("\n")[0]}), so the drafts are only proposed below.`; }
  }
  const canCreate = builds && (!!wt || !repo);
  const plan = planWrites(out, { dir, target: wt || dir, canCreate, canAppend: !!wt });
  const { proposals, skipped } = plan;
  let writes = [];
  if (!builds) writeNote = "Builds are off on this computer (worker.allow_build is false), so nothing was written: the drafts are below.";
  try {
    writes = applyWrites(wt || dir, plan.writes);
    if (wt && writes.length) {
      execFileSync("git", ["-C", wt, "add", "--", ...writes.map((w) => w.path)], { stdio: "ignore" });
      execFileSync("git", ["-C", wt, "commit", "-m", `Project setup: foundation docs\n\nDrafted by the Jarvis project setup session. New files only; existing docs untouched${writes.some((w) => w.kind === "append") ? " (missing sections appended at the end)" : ""}. Every TODO(owner) is a question on the checklist.`], { stdio: "ignore" });
    }
  } catch (e) {
    if (wt) { try { execFileSync("git", ["-C", repo.top, "worktree", "remove", "--force", wt], { stdio: "ignore" }); } catch {} }
    throw e;
  }
  if (wt) {
    const body = `${out.headline || "Project setup"}\n\n${(out.summary_md || "").slice(0, 6000)}\n\nNew files only; nothing the owner wrote was changed.`;
    try { ({ pr_url, commits } = finishWorktree(repo, wt, branch, body)); }
    catch (e) { log("setup push/PR failed", e.message); writeNote = `The branch \`${branch}\` has the drafts but the PR could not be opened: ${e.message.split("\n")[0]}`; }
  }

  // Checklist: questions → decide items for the founder; work → items; anything still unhandled → a critical item.
  const written = writes.concat(proposals);
  const handled = new Set([...written, ...skipped].flatMap((w) => w.foundation || []));
  const raw = [];
  for (const q of (Array.isArray(out.questions) ? out.questions : []).slice(0, 12)) {
    if (!q?.title) continue;
    if (q.foundation) handled.add(String(q.foundation));
    raw.push({ id: q.id, section: g.roles.decide, owner: "founder", title: q.title, priority: 1, estimate_minutes: 20, critical: !!q.critical || !!q.foundation,
      detail: `${q.detail || ""}${q.recommended ? `\n\nRecommended: ${q.recommended}` : ""}\n\nAsked by the project setup session: write your answer in the note box.`.trim() });
  }
  for (const it of (Array.isArray(out.items) ? out.items : []).slice(0, 12)) {
    if (!it?.title) continue;
    if (it.foundation) handled.add(String(it.foundation));
    raw.push({ ...it, critical: !!it.critical || !!it.foundation });
  }
  for (const f of FOUNDATION.filter((x) => fp.missing.includes(x.key) && !handled.has(x.key))) {
    raw.push({ id: `foundation-${f.key}`, section: g.roles[f.role] || g.roles.other, owner: f.owner, critical: true, priority: 1, estimate_minutes: 45,
      title: f.key === "github" ? "Put the project on GitHub (git init, private repo, push)" : `Add the missing foundation piece: ${f.label}`,
      detail: `The project setup session found no ${f.label} in the folder.${f.file ? `\n1. Add it${f.section ? ` as a "## ${f.section}" section in ${f.file}` : ` as ${f.file}`}.` : "\n1. Create the repository on GitHub (private unless you want it public) and push the folder; the worker can then build on branches and open PRs."}\n2. Commit it; the next setup run then leaves it alone.` });
    handled.add(f.key);
  }
  const { items, skipped: dup } = normalizeItems(raw, gg, 40);
  const placed = placeItems(items, gg);
  const added = [];
  const today = todayTZ();
  for (const it of placed) {
    const { item } = await api("POST", "/api/agent/items", {
      project_id: project.id, id: it.id, section: it.section, title: it.title, detail: it.detail, owner: it.owner, critical: it.critical,
      priority: it.priority, estimate_minutes: it.estimate_minutes, due: it.due, refine: "done", refine_note: `Added by the project setup session on ${today}.`,
    });
    added.push(item);
  }

  const fpAfter = fingerprint(dir);
  const list = (ws) => ws.map((w) => `- \`${w.path}\`${w.kind === "append" ? " (section appended)" : ""}`).join("\n");
  const body = `${out.summary_md || ""}

## ${wt ? `Written on the branch \`${branch}\`` : canCreate ? "Written in the folder" : "Written"} (${writes.length})
${list(writes) || "Nothing."}${pr_url ? `\n\nPR: ${pr_url} (not merged)` : ""}${writeNote ? `\n\n_${writeNote}_` : ""}
${proposals.length ? `\n## Proposed, not written (${proposals.length})\n${proposals.map((p) => `### \`${p.path}\`${p.kind === "append" ? " (add at the end)" : ""}\n\`\`\`\n${p.content.slice(0, 6000)}\n\`\`\``).join("\n\n")}\n` : ""}${skipped.length ? `\n## Left alone\n${skipped.map((s) => `- \`${s.path}\`: ${s.why}`).join("\n")}\n` : ""}
## Added to the checklist (${added.length})
${added.map((i) => `- \`${i.id}\` ${i.title}${i.critical ? " · critical" : ""} · ${i.section}`).join("\n") || "Nothing new: the checklist already covers it."}${dup.length ? `\n\nAlready on the checklist: ${dup.map((d) => d.id || d.title).join(", ")}.` : ""}`;
  const { review } = await api("POST", "/api/agent/reviews", {
    type: "doc", project_id: project.id, title: `Project setup · ${today}`, verdict: null, headline: out.headline || "", body_md: body,
    meta: { kind: "project-setup", trigger, cost_usd: res.cost_usd, duration_s: res.duration_s, written: writes.map((w) => w.path), proposed: proposals.map((p) => p.path), added: added.map((i) => i.id), pr_url },
  });
  await putRecord(project.id, { status: "done", at: new Date().toISOString(), trigger, missing: fpAfter.missing, handled: [...new Set([...fp.missing.filter((k) => handled.has(k)), ...fpAfter.missing.filter((k) => handled.has(k))])],
    docs: fpAfter.docs, head: fpAfter.head, pr_url, review_id: review?.id || null, error: null });
  const qs_ = added.filter((i) => i.section === g.roles.decide).length;
  const text = `**${out.headline || "Setup done."}**\n\n${isNew ? `Created \`${dir}\` and added ${project.name} to the dashboard. ` : ""}${writes.length ? `${wt ? "Drafted" : "Wrote"} ${writes.length} file${writes.length === 1 ? "" : "s"} (${writes.map((w) => `\`${w.path}\``).join(", ")})${pr_url ? ` on a PR: ${pr_url} (not merged)` : ""}. ` : ""}${proposals.length ? `${proposals.length} draft${proposals.length === 1 ? " is" : "s are"} in the report, not written. ` : ""}Added ${added.length} checklist item${added.length === 1 ? "" : "s"}${qs_ ? `, ${qs_} of them questions for you in ${g.roles.decide}` : ""}.${writeNote ? `\n\n${writeNote}` : ""}\n\nThe full report is under the project's strategy documents.`;
  await reply("done", text, { project_id: project.id, review_id: review?.id, pr_url, branch: commits ? branch : null, cost_usd: res.cost_usd, duration_s: res.duration_s });
  log("setup done", project.id, { written: writes.length, proposed: proposals.length, added: added.length, pr_url, cost_usd: res.cost_usd });
}

/* ---------------- CLI ---------------- */
if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, arg] = process.argv.slice(2);
  const dry = process.argv.includes("--dry-run");
  (async () => {
    if (cmd === "skills") return console.log(JSON.stringify(prepareSetupSkills(), null, 2));
    if (cmd === "check") {
      const [projects, state] = await Promise.all([api("GET", "/api/agent/projects"), getState()]);
      console.log(state ? "" : "No setup state yet: every project gets one run, one at a time, starting with the next worker pass.\n");
      for (const p of projects.filter((x) => (!arg || x.id === arg) && x.dir && fs.existsSync(x.dir))) {
        const fp = fingerprint(p.dir);
        const d = shouldRunSetup(state?.[p.id] || null, fp, opts());
        console.log(`${p.id.padEnd(22)} ${d.run ? `RUN (${d.trigger})` : "skip"}  ${d.reason}\n${" ".repeat(23)}missing: ${fp.missing.join(", ") || "nothing"}`);
      }
      return;
    }
    if (cmd === "queue" && arg) {
      const { message } = await api("POST", "/api/agent/messages", { text: `Set up this project: analyse the folder and fill the gaps in its foundation.`, project_id: arg, status: "new", mode: "setup", meta: { kind: "setup", trigger: "manual" } });
      return console.log(`Queued (message ${message?.id}): the worker runs it on its next pass.`);
    }
    if (cmd === "new" && arg) {
      const { taken } = await takenNames();
      const v = validateProjectName(arg, taken);
      if (v.error) throw new Error(v.error);
      if (dry) return console.log(`Would create ${path.join(PROJECTS_ROOT, v.id)} and register "${v.name}" (${v.id}).`);
      const { message } = await api("POST", "/api/agent/messages", { text: `Start a new project: ${v.name}`, status: "new", mode: "setup", meta: { kind: "new", name: v.name, id: v.id } });
      return console.log(`Queued (message ${message?.id}): the worker creates ${v.id} and runs the setup session on its next pass.`);
    }
    if (cmd && dry) {
      const project = (await api("GET", "/api/agent/projects?all=1")).find((p) => p.id === cmd);
      if (!project) throw new Error(`no project ${cmd}`);
      const fp = fingerprint(project.dir);
      const state = await getState();
      console.log(`${project.id}: ${project.dir}\npresent: ${fp.present.join(", ") || "nothing"}\nmissing: ${fp.missing.join(", ") || "nothing"}\nhead ${fp.head || "—"} · docs ${fp.docs.slice(0, 12)} · remote ${fp.remote || "—"} · repo for PRs ${repoInfo(project.dir) ? "yes" : "no"}`);
      console.log(`automatic run now: ${JSON.stringify(shouldRunSetup(state?.[project.id] || null, fp, opts()))}`);
      // Read-only: the checklist straight from the API (gather() would also write moved milestones into PRD.md).
      const mine = await api("GET", "/api/agent/items" + qs({ project: project.id }));
      let pack = null;
      try { pack = prepareSetupSkills(); } catch (e) { console.log(`skills: ${e.message}`); }
      if (pack) console.log(`skills: ${Object.keys(pack.skills).join(", ")} (${pack.pluginDir})`);
      console.log("\n--- prompt ---\n" + buildSetupPrompt({ project, dir: project.dir, trigger: "manual", reason: "", fp, mine, roles: sectionRoles(project.sections), pack, isNew: false }));
      return;
    }
    console.log("Usage: node setup.mjs check [id] | <id> --dry-run | queue <id> | new \"<name>\" [--dry-run] | skills");
    process.exitCode = cmd ? 1 : 0;
  })().catch((e) => { console.error(e.message); process.exitCode = 1; });
}
