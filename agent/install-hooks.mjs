#!/usr/bin/env node
// Installs the privacy guard as git hooks in this working copy (shared by every worktree, so the inbox
// worker's "Build it" branches are checked too). Safe to re-run.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { JARVIS_ROOT } from "./lib.mjs";

const common = path.resolve(JARVIS_ROOT, execFileSync("git", ["-C", JARVIS_ROOT, "rev-parse", "--git-common-dir"], { encoding: "utf8" }).trim());
const hooks = path.join(common, "hooks");
fs.mkdirSync(hooks, { recursive: true });
const node = process.execPath, guard = path.join(JARVIS_ROOT, "agent", "guard.mjs");
const write = (name, body) => { const f = path.join(hooks, name); fs.writeFileSync(f, `#!/bin/sh\n# Jarvis privacy guard (agent/install-hooks.mjs)\n${body}\n`, { mode: 0o755 }); console.log(`✓ ${name} hook installed`); };
write("pre-commit", `exec "${node}" "${guard}" --staged`);
write("pre-push", `z=0000000000000000000000000000000000000000
while read local_ref local_sha remote_ref remote_sha; do
  [ "$local_sha" = "$z" ] && continue
  if [ "$remote_sha" = "$z" ]; then range="$local_sha --not --remotes"; else range="$remote_sha..$local_sha"; fi
  "${node}" "${guard}" --push "$range" || exit 1
done
exit 0`);
