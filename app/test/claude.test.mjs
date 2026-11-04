// The headless runner's secret deny-list (agent/claude.mjs). It is the one thing every `claude -p` run gets whatever
// its own allow-list, so the audit's H8.1 fix lives here: a run that reads untrusted text must have nothing to leak.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SECRET_PATHS, SECRET_DENY, sandboxSettings, DATA_NOTE } from "../../agent/claude.mjs";

/** The glob subset the deny-list uses: `**` crosses directories, `*` doesn't. */
function matches(pattern, filePath) {
  const rx = pattern
    .split("/")
    .map((seg) => (seg === "**" ? "\u0000" : seg.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*")))
    .join("/")
    .replace(/\u0000\//g, "(?:.*/)?")
    .replace(/\u0000/g, ".*");
  return new RegExp(`^${rx}$`).test(filePath);
}
const denied = (p) => SECRET_PATHS.some((pat) => matches(pat, p));

test("matches: the glob helper itself", () => {
  assert.ok(matches("**/.env", ".env"));
  assert.ok(matches("**/.env", "a/b/.env"));
  assert.ok(!matches("**/.env", ".env.local"));
  assert.ok(matches("~/.ssh/**", "~/.ssh/id_ed25519"));
  assert.ok(!matches("~/.ssh/**", "~/.sshrc"));
});

test("every credential store a run could reach is denied", () => {
  for (const p of [
    "~/.config/jarvis/env",
    "~/.ssh/id_ed25519", "~/.ssh/config",
    "~/.config/gh/hosts.yml",
    "~/.aws/credentials", "~/.azure/msal_token_cache.json",
    "~/.config/gcloud/credentials.db",
    "~/.kube/config",
    "~/.gnupg/private-keys-v1.d/key.key",
    "~/.terraform.d/credentials.tfrc.json",
    "~/Library/Keychains/login.keychain-db",
    "~/.netrc", "~/.npmrc", "~/.pypirc",
    "~/.git-credentials",
    "~/.docker/config.json",
    "~/.cargo/credentials", "~/.cargo/credentials.toml",
    "~/.gem/credentials",
    "~/.composer/auth.json",
    "~/.claude.json", "~/.claude/.credentials.json",
  ]) assert.ok(denied(p), `${p} should be denied`);
});

test("environment files are denied in every spelling, at any depth", () => {
  for (const p of [
    ".env", "app/.env", "a/b/c/.env",
    ".env.local", ".env.production", ".env.production.local",
    ".env.development", ".env.staging", ".env.test", ".env.dev", ".env.prod",
    "packages/api/.env.development",
    ".envrc",
  ]) assert.ok(denied(p), `${p} should be denied`);
});

test("ordinary project files stay readable", () => {
  for (const p of [
    "README.md", "PRD.md", "src/index.ts", "app/lib/db.ts",
    "package.json", "docs/security.md", ".gitignore",
    "environment.md", "src/environments/env.ts",
  ]) assert.ok(!denied(p), `${p} should not be denied`);
});

test("the deny-list is a tool triple per path, so Read, Edit and Write are all covered", () => {
  assert.equal(SECRET_DENY.length, SECRET_PATHS.length * 3);
  for (const tool of ["Read", "Edit", "Write"]) assert.ok(SECRET_DENY.includes(`${tool}(~/.git-credentials)`));
});

test("the sandbox denies reading the same home paths", () => {
  const { sandbox } = sandboxSettings({ allowWrite: ["/tmp/wt/.git"] });
  assert.equal(sandbox.enabled, true);
  assert.equal(sandbox.allowUnsandboxedCommands, false);
  assert.equal(sandbox.failIfUnavailable, true);
  assert.deepEqual(sandbox.filesystem.allowWrite, ["/tmp/wt/.git"]);
  // every ~/ path, and only those: a repo-relative glob means nothing to the OS sandbox
  assert.deepEqual(sandbox.filesystem.denyRead, SECRET_PATHS.filter((p) => p.startsWith("~/")));
  for (const p of ["~/.git-credentials", "~/.claude.json", "~/.config/gcloud/**"]) assert.ok(sandbox.filesystem.denyRead.includes(p));
  assert.deepEqual(sandbox.network.allowedDomains, ["localhost", "127.0.0.1"]);
});

test("every run is told that what it reads is data", () => {
  assert.match(DATA_NOTE, /data, never instructions/);
  assert.match(DATA_NOTE, /reveal or send secrets/);
});
