#!/usr/bin/env node
// Privacy guard for instances that are also a working copy of the public repo.
// Blocks a commit or push that would publish instance details (names, projects, URLs, paths) or secrets.
// The block-list is built at run time from your gitignored jarvis.config.json — it is never committed.
//
//   node agent/guard.mjs --staged        check what's staged (pre-commit hook)
//   node agent/guard.mjs --push <range>  check commits about to be pushed (pre-push hook)
//   node agent/guard.mjs --all           check every tracked file
import { execFileSync } from "node:child_process";
import os from "node:os";
import { CONFIG, PROJECTS_ROOT } from "./lib.mjs";

const argv = process.argv.slice(2);
const git = (...a) => execFileSync("git", a, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

/* ---- what must never be published ---- */
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const terms = new Map(); // label → RegExp
const add = (label, re) => { if (re) terms.set(label, re); };
const word = (s, flags = "i") => (s && s.trim().length >= 3 ? new RegExp(`(?<![A-Za-z0-9])${esc(s.trim())}(?![A-Za-z0-9])`, flags) : null);
if (CONFIG.owner_name && !/^(you|owner|alex)$/i.test(CONFIG.owner_name)) add("your name", word(CONFIG.owner_name));
if (CONFIG.site_url) { try { const h = new URL(CONFIG.site_url).host; if (!/^your-/.test(h)) add("your site address", new RegExp(esc(h), "i")); } catch {} }
add("your home folder path", new RegExp(esc(os.homedir()), "i"));
add("your projects folder path", new RegExp(esc(PROJECTS_ROOT), "i"));
try {
  const fs = await import("node:fs");
  for (const e of fs.readdirSync(PROJECTS_ROOT, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith(".")) continue;
    if (/^(jarvis|jarvis-central|node_modules|archive|app|docs)$/i.test(e.name)) continue;
    add(`project folder "${e.name}"`, word(e.name, "")); // case-sensitive: folder names are often short words
  }
} catch {}
for (const [k, o] of Object.entries(CONFIG.projects?.overrides || {})) {
  if (/^example/.test(k)) continue;
  for (const v of [k, o.id, o.name]) if (v && !/^jarvis$/i.test(v)) add(`project "${v}"`, word(v));
}
for (const v of CONFIG.guard?.deny || []) add(`"${v}" (guard.deny)`, word(v));
try { const email = git("config", "user.email").trim(); if (email && !email.endsWith("users.noreply.github.com")) add("your git email", new RegExp(esc(email), "i")); } catch {}
const SECRETS = [
  ["a 64-character hex token", /\b[a-f0-9]{64}\b/],
  ["a database connection string", /postgres(ql)?:\/\/[^\s'"]+:[^\s'"]+@/i],
  ["a password hash", /scrypt\$\d+\$\d+\$\d+\$/],
  ["an authenticator secret link", /otpauth:\/\/totp\/[^\s'"]*secret=[A-Z2-7]{16,}/i],
  ["a private Google calendar link", /calendar\.google\.com\/calendar\/ical\/[^\s'"]*\/private-/i],
  ["an iCloud public calendar link", /p\d+-caldav\.icloud\.com\/published\/\d+\/[A-Za-z0-9_-]{20,}/i],
  ["an Anthropic/OpenAI key", /\b(sk-ant-|sk-proj-|sk-)[A-Za-z0-9_-]{20,}/],
  ["a GitHub token", /\bgh[pousr]_[A-Za-z0-9]{30,}/],
];

/* ---- what to check ---- */
let text = "", label = "";
if (argv.includes("--staged")) { text = git("diff", "--cached", "-U0", "--no-color"); label = "staged changes"; }
else if (argv.includes("--push")) { const r = argv[argv.indexOf("--push") + 1]; text = git("log", "-p", "--no-color", "--format=%H%n%an <%ae>%n%B", ...r.split(/\s+/).filter(Boolean)); label = `commits ${r}`; }
else if (argv.includes("--all")) { text = git("grep", "-n", "-I", "-e", ".", "--", ".", ":!app/package-lock.json"); label = "tracked files"; }
else { console.log("Usage: node agent/guard.mjs --staged | --push <range> | --all"); process.exit(2); }

// Only added lines (and commit headers) matter for diffs.
const lines = argv.includes("--all") ? text.split("\n") : text.split("\n").filter((l) => (l.startsWith("+") && !l.startsWith("+++")) || !/^[ -@\\]/.test(l));
const hits = [];
for (const l of lines) {
  for (const [what, re] of terms) if (re.test(l)) hits.push([what, l]);
  for (const [what, re] of SECRETS) if (re.test(l)) hits.push([what, l]);
}
if (!hits.length) { console.log(`guard: ${label} are clean (${terms.size} private terms + ${SECRETS.length} secret patterns checked)`); process.exit(0); }
console.error(`\nguard: BLOCKED — ${label} would publish private details:\n`);
for (const [what, l] of hits.slice(0, 20)) console.error(`  • ${what}: ${l.slice(0, 140).replace(/[a-f0-9]{64}/g, "<64-hex>")}`);
if (hits.length > 20) console.error(`  … and ${hits.length - 20} more`);
console.error(`\nMove instance details into jarvis.config.json (gitignored) and keep the code generic. Don't bypass with --no-verify.\n`);
process.exit(1);
