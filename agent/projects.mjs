#!/usr/bin/env node
// Projects: one folder per project under projects_root (docs/conventions.md).
//
//   node projects.mjs list                                 what Jarvis sees in projects_root
//   node projects.mjs scaffold [--only id] [--dry-run]     draft missing CLAUDE.md / PRD.md with Claude (never overwrites)
//   node projects.mjs sync [--dry-run]                     register / update every project on the dashboard
//   node projects.mjs checklist <id> [--dry-run]           draft a first checklist from the PRD (only if it has no items)
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { api, qs, CONFIG, PROJECTS_ROOT, JARVIS_ROOT, OWNER, TZ, todayTZ, parseModelJSON, makeLog } from "./lib.mjs";
import { runClaude } from "./claude.mjs";
import { oneLiner } from "./advisors.mjs";
import { DEFAULT_SECTIONS, parseMilestones, slugify } from "./structure.mjs";
import { applyMilestoneMoves } from "./milestones.mjs";

export { DEFAULT_SECTIONS, parseMilestones, slugify };

const log = makeLog("projects");
const argv = process.argv.slice(2);
const flag = (k) => argv.includes(`--${k}`);
const opt = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const DRY = flag("dry-run");
const TEMPLATES = path.join(JARVIS_ROOT, "templates");
const COLORS = ["p1", "p2", "p3", "p4", "p5", "p6", "p7"];

const read = (f) => { try { return fs.readFileSync(f, "utf8"); } catch { return null; } };
const git = (dir, ...args) => { try { return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 10_000 }).trim(); } catch { return null; } };

/** Every project folder under projects_root, per the conventions (hidden / excluded / include-list). */
export function scanProjects() {
  if (!fs.existsSync(PROJECTS_ROOT)) throw new Error(`projects_root doesn't exist: ${PROJECTS_ROOT} (set it in jarvis.config.json)`);
  const include = (CONFIG.projects?.include || []).map(String);
  const exclude = new Set((CONFIG.projects?.exclude || []).map(String));
  const overrides = CONFIG.projects?.overrides || {};
  return fs.readdirSync(PROJECTS_ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith(".") && !exclude.has(e.name))
    .filter((e) => !include.length || include.includes(e.name) || include.includes(slugify(e.name)))
    .map((e) => {
      // Overrides are keyed by folder name or by slug; they may set a different id and a subfolder (`dir`).
      const o = overrides[e.name] || overrides[slugify(e.name)] || {};
      const id = o.id || slugify(e.name);
      const dir = o.dir ? path.resolve(PROJECTS_ROOT, e.name, o.dir) : path.join(PROJECTS_ROOT, e.name);
      const top = git(dir, "rev-parse", "--show-toplevel");
      const ownRepo = !!top && path.resolve(top) === path.resolve(dir);
      return {
        id, folder: e.name, dir, name: o.name || e.name, kind: o.kind || "checklist", color: o.color || null, tagline: o.tagline || null, state: o.state || null, status: o.status || null,
        hasClaude: fs.existsSync(path.join(dir, "CLAUDE.md")), hasPrd: fs.existsSync(path.join(dir, "PRD.md")),
        remote: ownRepo ? git(dir, "remote", "get-url", "origin") : null, isRepo: ownRepo,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

function taglineFor(p) {
  const fromClaude = oneLiner(p.dir);
  if (fromClaude && !/\{\{/.test(fromClaude) && !/^TODO/i.test(fromClaude)) return fromClaude.slice(0, 160);
  const prd = read(path.join(p.dir, "PRD.md")) || "";
  const prob = prd.split(/^##\s+Problem\s*$/m)[1]?.split("\n").find((l) => l.trim() && !l.startsWith("#"));
  return (prob || "").replace(/\{\{.*?\}\}/g, "").trim().slice(0, 160);
}

/* ---------------- list ---------------- */
function list() {
  const ps = scanProjects();
  console.log(`projects_root: ${PROJECTS_ROOT}  (${ps.length} projects)\n`);
  for (const p of ps) console.log(`${p.id.padEnd(22)} ${p.kind.padEnd(9)} CLAUDE.md ${p.hasClaude ? "✓" : "✗"}  PRD.md ${p.hasPrd ? "✓" : "✗"}  ${p.isRepo ? (p.remote ? `git: ${p.remote}` : "git (no remote: Build it will only plan)") : "no git repo"}`);
  const missing = ps.filter((p) => !p.hasClaude || !p.hasPrd);
  if (missing.length) console.log(`\n${missing.length} project(s) need files: node agent/projects.mjs scaffold`);
}

/* ---------------- scaffold ---------------- */
function scaffoldPrompt(p, need) {
  const tpl = (f) => read(path.join(TEMPLATES, f));
  return `You are setting up the project folder "${p.folder}" (${p.dir}) for Jarvis Central Dashboard. It is missing ${need.join(" and ")}.
Read what is actually in the folder first: README files, package manifests (package.json, pyproject, Cargo.toml…), docs/, config files, the existing ${p.hasClaude ? "CLAUDE.md" : p.hasPrd ? "PRD.md" : "files"}, and \`git log --oneline -30\` if it's a git repo. Don't read secrets (.env files, credentials).

Then draft the missing file(s) from these templates, keeping their headings. Replace every {{placeholder}}:
- with facts you found in the folder, stated plainly; or
- when you can't tell, with \`TODO(owner): <the exact question to answer>\`.
Never invent facts, numbers, users, dates or metrics. A short, honest file with TODOs beats a confident made-up one.
Values you know: project id \`${p.id}\`, owner ${OWNER}, Jarvis repo ${JARVIS_ROOT}, today ${todayTZ()} (${TZ}).
In the PRD milestones table, only put real dates you found; otherwise one row \`| TODO(owner): YYYY-MM-DD | TODO(owner): first milestone |\`.

${need.includes("CLAUDE.md") ? `## Template: CLAUDE.md\n${tpl("CLAUDE.md")}\n` : ""}${need.includes("PRD.md") ? `## Template: PRD.md\n${tpl("PRD.md")}\n` : ""}
Output ONLY one JSON object, no code fences: {${need.includes("CLAUDE.md") ? `"claude_md": "<markdown>"` : ""}${need.length === 2 ? ", " : ""}${need.includes("PRD.md") ? `"prd_md": "<markdown>"` : ""}}`;
}
async function scaffold() {
  const only = opt("only");
  const ps = scanProjects().filter((p) => (!only || p.id === only) && (!p.hasClaude || !p.hasPrd));
  if (!ps.length) return console.log(only ? `${only}: nothing missing (or no such project)` : "Every project already has CLAUDE.md and PRD.md.");
  for (const p of ps) {
    const need = [!p.hasClaude && "CLAUDE.md", !p.hasPrd && "PRD.md"].filter(Boolean);
    const prompt = scaffoldPrompt(p, need);
    if (DRY) { console.log(`\n=== ${p.id}: would create ${need.join(", ")} ===\n${prompt}`); continue; }
    console.log(`${p.id}: drafting ${need.join(" + ")}…`);
    try {
      const res = await runClaude({ prompt, cwd: p.dir, allowedTools: ["Read", "Grep", "Glob", "Bash(git log:*)"], disallowedTools: ["Edit", "Write"], addDirs: [TEMPLATES], maxTurns: 25, timeoutMs: 10 * 60_000, log });
      const j = parseModelJSON(res.result);
      for (const [key, file] of [["claude_md", "CLAUDE.md"], ["prd_md", "PRD.md"]]) {
        if (!need.includes(file)) continue;
        const target = path.join(p.dir, file);
        if (fs.existsSync(target)) { console.log(`  ${file} appeared meanwhile, left untouched`); continue; }
        if (!j[key] || typeof j[key] !== "string") { console.log(`  ${file}: no draft returned`); continue; }
        fs.writeFileSync(target, j[key].trim() + "\n", { flag: "wx" });
        const todos = (j[key].match(/TODO\(owner\)/g) || []).length;
        console.log(`  created ${file}${todos ? ` (${todos} TODO(owner) to fill in)` : ""}`);
      }
    } catch (e) { console.log(`  failed: ${e.message}`); }
  }
}

/* ---------------- sync ---------------- */
/** Folders the owner removed or declined on the Admin page (kv `projects.ignored`): never registered or proposed again. */
export async function ignoredProjects() {
  try { const v = (await api("GET", "/api/agent/kv?key=projects.ignored")).value; return Array.isArray(v) ? v : []; }
  catch (e) { if (e.status === 404) return []; throw e; }
}

/**
 * Register / update every project folder on the dashboard. Never deletes: a project whose folder is gone is archived.
 * Folders on the ignore list are skipped. With `addNew: false` (the Admin page's refresh) a folder that isn't
 * registered yet is only proposed: its payload comes back in `proposed` for the owner to approve or decline.
 * Returns the ids it upserted, the ones that weren't registered before (`added`), the proposals and the ones it archived.
 */
export async function syncProjects({ dry = false, print = console.log, addNew = true } = {}) {
  let existing = [], ignored = [];
  try { [existing, ignored] = await Promise.all([api("GET", "/api/agent/projects?all=1"), ignoredProjects()]); } catch (e) { if (!dry) throw e; print(`(dry run: API unavailable — ${e.message})`); }
  const skip = new Set(ignored.flatMap((x) => [x.id, x.folder].filter(Boolean)));
  const ps = scanProjects().filter((p) => !skip.has(p.id) && !skip.has(p.folder));
  // Milestones moved on the Timeline go into PRD.md first, so the parse below keeps them instead of reverting.
  if (!dry) await applyMilestoneMoves(existing, (...a) => print(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")));
  const byId = Object.fromEntries(existing.map((p) => [p.id, p]));
  const used = new Set(existing.filter((p) => !p.archived).map((p) => p.color));
  const nextColor = () => { const c = COLORS.find((x) => !used.has(x)) || COLORS[used.size % COLORS.length]; used.add(c); return c; };
  const payloads = ps.map((p, i) => {
    const cur = byId[p.id];
    const prd = read(path.join(p.dir, "PRD.md"));
    const body = {
      id: p.id, name: p.name, kind: p.kind, dir: p.dir, archived: false, ...(p.state ? { state: p.state } : {}), ...(p.status ? { status: p.status } : {}),
      color: p.color || cur?.color || nextColor(),
      // Never clobber what's already on the site: a curated tagline wins over one guessed from CLAUDE.md,
      // and deadlines only change when the PRD actually has a milestones table.
      tagline: p.tagline || cur?.tagline || taglineFor(p) || "",
      sort: i + 1,
    };
    const ms = parseMilestones(prd);
    body.deadlines = ms.length || !cur ? ms : cur.deadlines || [];
    if (cur?.state && !p.state) body.state = cur.state;
    if (cur?.status && !p.status) body.status = cur.status;
    if (!cur || !(cur.sections || []).length) body.sections = DEFAULT_SECTIONS; // never overwrite sections you edited
    return body;
  });
  const gone = existing.filter((e) => !e.archived && e.dir && path.resolve(e.dir).startsWith(path.resolve(PROJECTS_ROOT) + path.sep) && !ps.some((p) => p.id === e.id));
  const fresh = payloads.filter((b) => !byId[b.id]);
  const proposed = addNew ? [] : fresh.map((b) => ({ ...b, folder: ps.find((p) => p.id === b.id)?.folder }));
  const toUpsert = addNew ? payloads : payloads.filter((b) => byId[b.id]);
  const added = addNew ? fresh.map((b) => b.id) : [];
  if (dry) {
    print(JSON.stringify({ upsert: toUpsert, propose: proposed.map((b) => b.id), archive: gone.map((g) => g.id) }, null, 2));
    return { upserted: [], added, proposed, archived: [] };
  }
  for (const b of toUpsert) { await api("PUT", "/api/agent/projects", b); print(`✓ ${b.id} (${b.kind}, ${b.color}${b.deadlines.length ? `, ${b.deadlines.length} deadline(s)` : ""})${byId[b.id] ? "" : "  new"}`); }
  for (const g of gone) { await api("PUT", "/api/agent/projects", { id: g.id, name: g.name, archived: true }); print(`archived ${g.id} (folder gone)`); }
  const noPrd = ps.filter((p) => !p.hasPrd).map((p) => p.id);
  if (noPrd.length) print(`\nNo PRD.md yet: ${noPrd.join(", ")}. Their deadlines on the site are unchanged; add a PRD with a milestones table to manage them from the file (node agent/projects.mjs scaffold).`);
  if (proposed.length) print(`\nNew folders waiting for your approval on the Admin page: ${proposed.map((b) => b.id).join(", ")}`);
  return { upserted: toUpsert.map((b) => b.id), added, proposed, archived: gone.map((g) => g.id) };
}
const sync = () => syncProjects({ dry: DRY });

/* ---------------- first checklist ---------------- */
async function checklist() {
  const id = argv.find((a, i) => i > 0 && !a.startsWith("--"));
  if (!id) throw new Error("usage: node projects.mjs checklist <id> [--dry-run]");
  const p = scanProjects().find((x) => x.id === id);
  if (!p) throw new Error(`no project folder with id ${id} under ${PROJECTS_ROOT}`);
  let items = [];
  try { items = await api("GET", "/api/agent/items" + qs({ project: id })); } catch (e) { if (!DRY) throw e; }
  if (items.length) return console.log(`${id} already has ${items.length} checklist items: nothing to do.`);
  const prd = read(path.join(p.dir, "PRD.md")), claude = read(path.join(p.dir, "CLAUDE.md"));
  if (!prd) throw new Error(`${id} has no PRD.md: run scaffold first`);
  const next = parseMilestones(prd).find((m) => m.date >= todayTZ());
  const prompt = `Draft the first checklist for the project "${p.name}" (id ${id}) on Jarvis Central Dashboard. Today is ${todayTZ()} (${TZ}).
Read PRD.md and CLAUDE.md below; you may also read files in ${p.dir} to see what already exists. The checklist should get the project to its next milestone${next ? `: "${next.label}" on ${next.date}` : " (none dated yet: aim for the first working version)"}.

Sections (use these ids): ${DEFAULT_SECTIONS.map((s) => `${s.id} = ${s.name} (${s.note})`).join("; ")}.
Rules:
- 12 to 30 items. Each is one concrete piece of work that fits in a week; split anything bigger.
- owner: "founder" (the human owner: decisions, accounts, money, outreach, anything needing their identity), "claude" (code, research, drafting), or "both".
- due: a realistic YYYY-MM-DD on or before the milestone, spread across the weeks; decisions first.
- critical: true only if it blocks the milestone.
- Every "TODO(owner)" in the PRD becomes a "decide" item.
- No invented facts: items describe work, not claims.

PRD.md:
${prd}

CLAUDE.md:
${claude || "(none)"}

Output ONLY one JSON object, no code fences: {"items": [{"section": "...", "title": "...", "detail": "...", "due": "YYYY-MM-DD", "owner": "founder|claude|both", "critical": false}]}`;
  if (DRY) { console.log(prompt); return; }
  const res = await runClaude({ prompt, cwd: p.dir, allowedTools: ["Read", "Grep", "Glob"], maxTurns: 20, timeoutMs: 10 * 60_000, log });
  const j = parseModelJSON(res.result);
  const seen = new Set(), sectionIds = new Set(DEFAULT_SECTIONS.map((s) => s.id));
  const rows = (j.items || []).filter((it) => it && it.title).map((it, i) => {
    let base = slugify(it.title).split("-").slice(0, 4).join("-"), key = base, n = 2;
    while (seen.has(key)) key = `${base}-${n++}`;
    seen.add(key);
    return { project_id: id, id: key, section: sectionIds.has(it.section) ? it.section : "build", title: String(it.title).slice(0, 300), detail: String(it.detail || "").slice(0, 2000),
      status: "todo", due: /^\d{4}-\d{2}-\d{2}$/.test(it.due || "") ? it.due : null, owner: ["founder", "claude", "both"].includes(it.owner) ? it.owner : "founder", critical: !!it.critical, sort: i + 1 };
  });
  if (!rows.length) throw new Error("the model returned no items");
  const r = await api("POST", "/api/agent/import", { items: rows });
  console.log(`✓ ${id}: ${r?.counts?.items ?? rows.length} checklist items drafted (review them on the dashboard)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cmd = argv[0];
  const run = { list, scaffold, sync, checklist }[cmd];
  if (!run) { console.log("Usage: node projects.mjs list | scaffold [--only id] [--dry-run] | sync [--dry-run] | checklist <id> [--dry-run]"); process.exitCode = cmd ? 1 : 0; }
  else Promise.resolve(run()).catch((e) => { console.error(e.message); process.exitCode = 1; });
}
