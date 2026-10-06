// The foundation every project folder should have (PRD, CLAUDE.md, README, brand, stack, design system…), how to tell
// from the folder which pieces exist, and when the project setup session (setup.mjs) should run again.
// Pure: no API calls, no file system, no side effects on import. Tested in app/test/foundation.test.mjs.
import { slugify } from "./structure.mjs";

/**
 * The pieces, in the order a new project needs them. `file` is where the setup session writes a missing piece
 * (`section` = appended as that heading to an existing file instead); `owner`/`role` are for the checklist item that
 * replaces it when the session can't write it (role: decide = the owner's call, build = Claude's work, other = the owner's work).
 */
export const FOUNDATION = [
  { key: "prd", label: "PRD.md (problem, users, scope, dated milestones)", file: "PRD.md", owner: "founder", role: "decide" },
  { key: "value", label: "Value, pain and ideal customer (PRD: Problem and Users)", file: "PRD.md", section: "Problem", owner: "founder", role: "decide" },
  { key: "non-goals", label: "Non-goals (PRD)", file: "PRD.md", section: "Non-goals", owner: "founder", role: "decide" },
  { key: "claude-md", label: "CLAUDE.md (how Claude works here, How we work)", file: "CLAUDE.md", owner: "claude", role: "build" },
  { key: "readme", label: "README.md", file: "README.md", owner: "claude", role: "build" },
  { key: "gitignore", label: ".gitignore", file: ".gitignore", owner: "claude", role: "build" },
  { key: "github", label: "GitHub repository (git, remote, pushed)", file: null, owner: "founder", role: "other" },
  { key: "stack", label: "Stack (language, framework, hosting)", file: "docs/architecture.md", section: "Stack", owner: "both", role: "decide" },
  { key: "db-auth", label: "Database and auth", file: "docs/architecture.md", section: "Data and auth", owner: "both", role: "decide" },
  { key: "env-vars", label: "Environment variables (.env.example, names only)", file: ".env.example", owner: "claude", role: "build" },
  { key: "environments", label: "Staging and production", file: "docs/architecture.md", section: "Environments", owner: "both", role: "decide" },
  { key: "error-tracking", label: "Error tracking", file: "docs/architecture.md", section: "Error tracking", owner: "both", role: "decide" },
  { key: "brand", label: "Brand doc (name, voice, audience, look)", file: "docs/BRAND.md", owner: "founder", role: "decide" },
  { key: "design-system", label: "Design system (DESIGN.md: tokens, type, components)", file: "DESIGN.md", owner: "claude", role: "build" },
];
export const FOUNDATION_KEYS = FOUNDATION.map((f) => f.key);

const ERROR_TRACKERS = /^(@sentry\/|sentry-|@bugsnag\/|bugsnag|rollbar|@honeybadger-io\/|honeybadger|@highlight-run\/|logrocket|dd-trace|@datadog\/|newrelic|@appsignal\/|posthog)/;

/**
 * Which pieces a folder has. `ctx` = { files: ["PRD.md", "docs/brand.md", …] (paths relative to the folder: the
 * top level and docs/), text: {path: content} for the markdown and dot files read, deps: [package names], remote }.
 */
export function detectFoundation(ctx) {
  const files = (ctx.files || []).map(String);
  const has = (re) => files.some((f) => re.test(f));
  const text = ctx.text || {};
  const prd = text["PRD.md"] || "";
  const docs = Object.entries(text).filter(([f]) => /\.md$/i.test(f)).map(([, t]) => t || "");
  const heading = (t, re) => t.split("\n").some((l) => /^#{1,4}\s/.test(l) && re.test(l.replace(/^#+\s*/, "")));
  const anyHeading = (re) => docs.some((t) => heading(t, re));
  const deps = ctx.deps || [];
  const found = {
    prd: !!text["PRD.md"] || has(/^PRD\.md$/),
    value: heading(prd, /\b(problem|pain|value)/i) && heading(prd, /\b(users?|customers?|audience|icp|ideal customer|who it'?s for|persona)/i),
    "non-goals": heading(prd, /\b(non-goals?|out of scope|not in scope)/i),
    "claude-md": has(/^(CLAUDE|AGENTS)\.md$/),
    readme: has(/^readme(\.md|\.txt)?$/i),
    gitignore: has(/^\.gitignore$/),
    github: /github\.com[:/]/i.test(ctx.remote || ""),
    stack: anyHeading(/\b(stack|tech stack|technology|technologies)\b/i),
    "db-auth": has(/^docs\/(data|database|auth|schema)[^/]*\.md$/i) || anyHeading(/\b(database|data model|data and auth|auth|authentication|persistence)\b/i),
    "env-vars": has(/^\.env\.(example|sample|template)$/) || has(/^docs\/env[^/]*\.md$/i) || anyHeading(/\b(environment variables|env vars)\b/i),
    environments: anyHeading(/\b(environments?|staging|production|deploy(ment|ing)?|hosting)\b/i),
    "error-tracking": deps.some((d) => ERROR_TRACKERS.test(d)) || anyHeading(/\b(error tracking|monitoring|observability)\b/i),
    brand: has(/^(docs\/)?brand[^/]*\.md$/i) || anyHeading(/\b(brand|voice and tone|tone of voice)\b/i),
    "design-system": has(/^(docs\/)?design[^/]*\.md$/i),
  };
  const present = FOUNDATION_KEYS.filter((k) => found[k]);
  return { present, missing: FOUNDATION_KEYS.filter((k) => !found[k]) };
}

/**
 * Whether the setup session should run for a project now. `record` is what the last run left in kv `projects.setup`
 * (null = never ran), `fp` the folder now: { missing: [keys], docs: hash of the foundation docs, head: git HEAD or null }.
 *
 * - Never ran → a newly loaded project: run (when `autoOnLoad`).
 * - A run queued or running → wait (a run stuck longer than `staleHours` counts as failed).
 * - Otherwise an "update" run needs all of: `autoOnUpdate`; `cooldownDays` since the last run; a missing piece the last
 *   run did not handle (write it, propose it or turn it into an item); and the folder changed since then (new commits
 *   or the foundation docs edited). So a sync, a refresh, or a commit alone never re-runs it, and a complete folder
 *   never does.
 */
export function shouldRunSetup(record, fp, { now = Date.now(), autoOnLoad = true, autoOnUpdate = true, cooldownDays = 7, staleHours = 2 } = {}) {
  if (!record) return autoOnLoad ? { run: true, trigger: "load", reason: "new project" } : { run: false, reason: "automatic runs on load are off" };
  const age = now - +new Date(record.at || 0);
  if (["queued", "running"].includes(record.status) && age < staleHours * 3600_000) return { run: false, reason: `a run is ${record.status}` };
  if (!autoOnUpdate) return { run: false, reason: "automatic runs on update are off" };
  if (age < cooldownDays * 86400_000) return { run: false, reason: `last run under ${cooldownDays} days ago` };
  const handled = new Set(record.handled || []);
  const gaps = (fp.missing || []).filter((k) => !handled.has(k));
  if (!gaps.length) return { run: false, reason: (fp.missing || []).length ? "every missing piece was already handled" : "foundation complete" };
  const commits = !!fp.head && fp.head !== record.head;
  const docs = !!fp.docs && fp.docs !== record.docs;
  if (!commits && !docs) return { run: false, reason: "folder unchanged since the last run" };
  return { run: true, trigger: "update", gaps, reason: `${gaps.join(", ")} missing; ${[commits && "new commits", docs && "foundation docs changed"].filter(Boolean).join(" and ")} since the last run` };
}

/** "Start new project": the folder name for a typed name, or why it can't be used. `taken` = ids/folders in use. */
export function validateProjectName(name, taken = []) {
  const n = String(name ?? "").trim();
  if (!n) return { error: "Type a name for the project." };
  if (n.length > 60) return { error: "Keep the name under 60 characters." };
  if (/[\/\\]/.test(n) || n.startsWith(".")) return { error: "Use a plain name, not a path." };
  if (!/[a-z0-9]/i.test(n.normalize("NFD"))) return { error: "The name needs at least one letter or digit." };
  const id = slugify(n).slice(0, 50).replace(/-+$/, "");
  if (!id || (id === "project" && !/project/i.test(n))) return { error: "The name needs at least one letter or digit." };
  const lower = new Set(taken.map((t) => String(t).toLowerCase()));
  if (lower.has(id) || lower.has(n.toLowerCase())) return { error: `A project or folder called "${id}" already exists. Pick another name.` };
  return { id, name: n };
}

/** A path the setup session may create inside the project: relative, no `..`, not git internals, secrets or dependencies. */
export function safeRelPath(p) {
  const s = String(p || "").replace(/\\/g, "/").replace(/^\.\/+/, "");
  if (!s || s.startsWith("/") || /^[a-z]:/i.test(s) || s.length > 200) return null;
  const parts = s.split("/");
  if (parts.some((x) => !x || x === "." || x === "..")) return null;
  if (parts[0] === ".git" || parts.includes("node_modules")) return null;
  const base = parts[parts.length - 1];
  if (/^\.env/.test(base) && !/^\.env\.(example|sample|template)$/.test(base)) return null;
  if (/\.(pem|key|p12|pfx)$/i.test(base) || /^(id_rsa|id_ed25519|credentials)/i.test(base)) return null;
  return s;
}

/** Append `add` to a file's text without touching what is there. Null when its first heading is already in the file. */
export function appendSection(existing, add) {
  const a = String(add || "").trim();
  if (!a) return null;
  const first = a.split("\n").find((l) => /^#{1,4}\s/.test(l));
  const norm = (l) => l.replace(/^#+\s*/, "").trim().toLowerCase();
  if (first && String(existing || "").split("\n").some((l) => /^#{1,4}\s/.test(l) && norm(l) === norm(first))) return null;
  const base = String(existing || "");
  return base + (base.endsWith("\n") || !base ? "" : "\n") + (base ? "\n" : "") + a + "\n";
}
