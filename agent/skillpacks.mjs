// Skill packs: third-party Claude Code skills fetched at pinned commits into the cache and bundled as a local plugin,
// loaded for one headless run with `claude --plugin-dir` (runClaude's `pluginDirs`). Nothing is installed user-wide.
// Used by website builds (website.mjs); other runs declare their own SOURCES the same way.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { cacheDir, makeLog } from "./lib.mjs";

const log = makeLog("skillpacks");
const git = (dir, ...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 180_000 }).trim();

/** One repo at its pinned commit under the cache (shallow fetch of that commit only). */
export function fetchPinned({ repo, ref }) {
  const dir = path.join(cacheDir("skillpacks", "repos"), repo.replace("/", "__"));
  let head = null;
  try { head = git(dir, "rev-parse", "HEAD"); } catch {}
  if (head === ref) return dir;
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q");
  git(dir, "remote", "add", "origin", `https://github.com/${repo}.git`);
  git(dir, "fetch", "-q", "--depth", "1", "origin", ref);
  git(dir, "checkout", "-q", "FETCH_HEAD");
  return dir;
}

/**
 * Builds the plugin `name` from `sources`: [{repo, ref, skills?: {skillName: "path/in/repo"}, extra?: {key: "path/in/repo"}}].
 * `skills` are copied into the plugin; `extra` paths (reference libraries the run reads) are returned as absolute paths.
 * Returns { pluginDir, skills: {name: SKILL.md path}, extra: {key: dir} }. Throws when no skill could be fetched.
 */
export function preparePack(name, sources, description = "") {
  const pluginDir = cacheDir("skillpacks", "plugins", name);
  const skillsDir = path.join(pluginDir, "skills");
  fs.rmSync(skillsDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(pluginDir, ".claude-plugin"), { recursive: true });
  fs.writeFileSync(path.join(pluginDir, ".claude-plugin", "plugin.json"), JSON.stringify({ name, version: "1.0.0", description: description || `Skills for Jarvis ${name} runs (pinned; see agent/skillpacks.mjs).` }, null, 2));
  const skills = {}, extra = {};
  for (const s of sources) {
    let dir;
    try { dir = fetchPinned(s); } catch (e) { log("fetch failed", s.repo, e.message.split("\n")[0]); continue; }
    for (const [key, rel] of Object.entries(s.extra || {})) extra[key] = path.join(dir, rel);
    for (const [skill, rel] of Object.entries(s.skills || {})) {
      const src = path.join(dir, rel);
      if (!fs.existsSync(path.join(src, "SKILL.md"))) { log("skill missing at the pinned commit", s.repo, rel); continue; }
      fs.cpSync(src, path.join(skillsDir, skill), { recursive: true });
      skills[skill] = path.join(skillsDir, skill, "SKILL.md");
    }
  }
  if (!Object.keys(skills).length) throw new Error(`none of the ${name} skills could be fetched`);
  return { pluginDir, skills, extra };
}
