import { test } from "node:test";
import assert from "node:assert/strict";
import { claudeArgs, secretDeny } from "../../agent/claude.mjs";

const HOME = "/home/testowner";

/** The values of one variadic flag: everything after it until the next `--flag`. */
function group(args, flag) {
  const i = args.indexOf(flag);
  if (i < 0) return null;
  const out = [];
  for (let n = i + 1; n < args.length && !args[n].startsWith("--"); n++) out.push(args[n]);
  return out;
}

test("secretDeny covers every credential path, in both the ~ and the absolute form", () => {
  const deny = secretDeny(HOME);
  for (const p of ["~/.config/jarvis", "~/.ssh", "~/.config/gh", "~/.aws", "~/.gnupg"]) {
    assert.ok(deny.includes(`Read(${p}/**)`), `missing Read(${p}/**)`);
    assert.ok(deny.includes(`Read(${p.replace("~", HOME)}/**)`), `missing the absolute form of ${p}`);
  }
  for (const f of ["**/.env", "**/.env.*", "**/*.pem", "**/id_rsa*", "**/id_ed25519*"]) {
    assert.ok(deny.includes(`Read(${f})`), `missing Read(${f})`);
  }
  assert.equal(new Set(deny).size, deny.length, "no duplicates");
  // The list is built from the home directory given, never from a path in the repo.
  assert.ok(!deny.some((r) => /\/Users\/|\/home\/(?!testowner)/.test(r)), "no hardcoded home path");
});

test("every run denies the credential paths, on top of what the caller denies", () => {
  for (const opts of [
    { prompt: "p" },                                                        // no allow-list at all
    { prompt: "p", tools: "" },                                             // pure text/JSON call
    { prompt: "p", allowedTools: ["Read", "Grep", "Glob"] },                // read-only review
    { prompt: "p", allowedTools: ["Read", "WebSearch", "WebFetch"] },       // the repo scout / advisors
    { prompt: "p", allowedTools: ["Edit", "Write"], disallowedTools: ["Bash(git push:*)"] }, // a build run
  ]) {
    const args = claudeArgs({ ...opts, home: HOME });
    const deny = group(args, "--disallowedTools");
    assert.ok(deny, `${JSON.stringify(opts)}: no --disallowedTools`);
    for (const rule of secretDeny(HOME)) assert.ok(deny.includes(rule), `${JSON.stringify(opts)}: ${rule} not denied`);
    for (const own of opts.disallowedTools || []) assert.ok(deny.includes(own), `${JSON.stringify(opts)}: dropped the caller's ${own}`);
  }
});

test("the deny rules stay out of the allow-list, and the run is still headless", () => {
  const args = claudeArgs({ prompt: "p", allowedTools: ["Read", "WebFetch"], addDirs: ["/tmp/a"], maxTurns: 70, model: "sonnet", home: HOME });
  assert.deepEqual(group(args, "--allowedTools"), ["Read", "WebFetch"]);
  assert.deepEqual(args.slice(0, 2), ["-p", "p"]);
  assert.deepEqual(group(args, "--permission-mode"), ["dontAsk"]);
  assert.deepEqual(group(args, "--max-turns"), ["70"]);
  assert.deepEqual(group(args, "--add-dir"), ["/tmp/a"]);
  assert.deepEqual(group(args, "--model"), ["sonnet"]);
  assert.deepEqual(group(args, "--output-format"), ["json"]);
});

test("a resumed run is denied the same paths as the run it continues", () => {
  const first = claudeArgs({ prompt: "p", allowedTools: ["Read"], home: HOME });
  const resumed = claudeArgs({ prompt: "more", allowedTools: ["Read"], resume: "sess-1", home: HOME });
  assert.deepEqual(group(resumed, "--disallowedTools"), group(first, "--disallowedTools"));
  assert.deepEqual(group(resumed, "--resume"), ["sess-1"]);
});
