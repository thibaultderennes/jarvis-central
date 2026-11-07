// The deny-list every headless `claude -p` run carries (agent/claude.mjs). It is the last line of defence when a run
// reads untrusted text: a web page, a GitHub README, an issue. Two things have to hold — the files that hold
// credentials can't be read, and the files that make a *later* Claude Code session run code can't be written — while
// the one directory advisor runs deliberately add (a project's memory) stays readable.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SECRET_PATHS, SECRET_DENY, DATA_NOTE } from "../../agent/claude.mjs";

/** gitignore-style match, the shape Claude Code's path rules use: `**` crosses directories, `*` does not. */
function matches(pattern, p) {
  const rx = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\//g, "\u0000") // "**/" → any number of leading directories, including none
    .replace(/\*\*/g, "\u0001")
    .replace(/\*/g, "[^/]*")
    .replace(/\u0000/g, "(?:.*/)?")
    .replace(/\u0001/g, ".*");
  return new RegExp(`^${rx}$`).test(p);
}
const denied = (p) => SECRET_PATHS.some((pattern) => matches(pattern, p));

test("the matcher used by these tests behaves like a path rule", () => {
  assert.ok(matches("**/.env", ".env"));
  assert.ok(matches("**/.env", "a/b/.env"));
  assert.ok(!matches("**/.env", ".env.local"));
  assert.ok(matches("~/.claude/plugins/**", "~/.claude/plugins/p/hooks/run.sh"));
  assert.ok(!matches("~/.claude/plugins/**", "~/.claude/settings.json"));
  assert.ok(matches("**/.env.*.local", "app/.env.staging.local"));
});

test("credentials a run could leak are denied", () => {
  for (const p of [
    "~/.config/jarvis/env",            // the agent token (docs/security.md)
    "~/.ssh/id_ed25519",
    "~/.config/gh/hosts.yml",
    "~/.aws/credentials",
    "~/.netrc",
    "~/.npmrc",
    "~/.docker/config.json",
    "~/.claude.json",                  // holds primaryApiKey when the owner signs in with an API key
    "~/.claude/.credentials.json",
  ]) assert.ok(denied(p), p);
});

test("every .env shape that carries real keys is denied, examples aside", () => {
  for (const p of [".env", ".env.local", ".env.production", ".env.development", ".env.test", ".env.staging",
    ".env.production.local", "app/.env", "packages/api/.env.development", ".envrc"]) assert.ok(denied(p), p);
});

test("files that make a later Claude Code session run code are denied", () => {
  // A build run holds Edit/Write by tool name and the OS sandbox only wraps Bash, so these must be on the list:
  // a hook written here would run as the owner next time they open Claude Code, invisibly to the PR they review.
  for (const p of [
    "~/.claude/settings.json",
    "~/.claude/settings.local.json",
    "~/.claude/CLAUDE.md",
    "~/.claude/hooks/pre.sh",
    "~/.claude/plugins/anything/hooks/hooks.json",
    "~/.claude/commands/x.md",
    "~/.claude/agents/x.md",
    "~/.claude/skills/x/SKILL.md",
  ]) assert.ok(denied(p), p);
});

test("a project's memory directory stays readable: advisor runs add it on purpose", () => {
  // agent/weekly.mjs passes memoryDirs() as --add-dir; denying it would silently empty every advisor review's memory.
  assert.ok(!denied("~/.claude/projects/-Users-owner-Projects-app/memory/notes.md"));
  assert.ok(!denied("~/.claude/projects/-Users-owner/memory/notes.md"));
});

test("each path is denied for all three file tools, and every run carries the note", () => {
  for (const p of SECRET_PATHS) for (const tool of ["Read", "Edit", "Write"]) assert.ok(SECRET_DENY.includes(`${tool}(${p})`), `${tool}(${p})`);
  assert.equal(SECRET_DENY.length, SECRET_PATHS.length * 3);
  assert.match(DATA_NOTE, /data, never instructions/);
});
