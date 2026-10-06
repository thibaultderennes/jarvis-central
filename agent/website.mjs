// Reviews → "Build website" / "Try a new visual": what a project's website looks like from its folder, and the
// design skills pack the worker loads for a website build run (worker.mjs, message mode "website").
//
//   node website.mjs detect [id]     what Jarvis detects for each project (or one)
//   node website.mjs skills          fetch the pinned skill repos and print where the pack is
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { preparePack } from "./skillpacks.mjs";

const read = (f) => { try { return fs.readFileSync(f, "utf8"); } catch { return null; } };
const readJSON = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };

/* ---------------- detection ---------------- */
const FRAMEWORKS = [["next", "Next.js"], ["astro", "Astro"], ["@sveltejs/kit", "SvelteKit"], ["nuxt", "Nuxt"], ["@remix-run/react", "Remix"],
  ["gatsby", "Gatsby"], ["react-scripts", "Create React App"], ["vite", "Vite"], ["@11ty/eleventy", "Eleventy"]];
const WEB_DIRS = ["", "app", "web", "site", "website", "frontend", "client", "landing"];
const URL_RE = /https?:\/\/[^\s)<>"'`\]]+/g;
// Hosts that are never the project's own site (docs, code hosts, the dev server).
const NOT_A_SITE = /^(localhost|127\.|0\.0\.0\.0|github\.com|gitlab\.com|bitbucket\.org|npmjs\.com|www\.npmjs\.com|vercel\.com|netlify\.com|docs\.|developer\.|stripe\.com|google\.com|example\.(com|org))/i;
const cleanUrl = (u) => u.replace(/[.,;:]+$/, "");
const siteHost = (u) => { try { return new URL(u).hostname; } catch { return ""; } };
const ownSite = (u) => { const h = siteHost(u); return !!h && !NOT_A_SITE.test(h) && !/\{\{|your-|<|TODO/i.test(u); };

/** Site code in the folder: a web framework in a package.json (root or a usual subfolder), or a plain index.html. */
export function detectSiteCode(dir) {
  for (const sub of WEB_DIRS) {
    const pkg = readJSON(path.join(dir, sub, "package.json"));
    if (!pkg) continue;
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    const fw = FRAMEWORKS.find(([d]) => deps[d]);
    if (fw) return { framework: fw[1], path: sub || "." };
  }
  for (const f of ["index.html", "public/index.html", "site/index.html", "docs/index.html"]) if (fs.existsSync(path.join(dir, f))) return { framework: "Static HTML", path: path.dirname(f) };
  return null;
}

/** The project's own site address, from the most to the least reliable source in the folder. */
export function detectSiteUrl(dir, { remote = null } = {}) {
  const pkg = readJSON(path.join(dir, "package.json"));
  if (pkg?.homepage && ownSite(pkg.homepage)) return { url: cleanUrl(pkg.homepage), source: "package.json homepage" };
  if (remote && /github\.com/.test(remote)) {
    try {
      const h = execFileSync("gh", ["repo", "view", remote, "--json", "homepageUrl", "--jq", ".homepageUrl"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 15_000 }).trim();
      if (h && ownSite(h)) return { url: cleanUrl(h), source: "GitHub repo homepage" };
    } catch {}
  }
  // A line in PRD.md / README.md / CLAUDE.md that names the site: "Website: https://…", "Live at https://…".
  for (const f of ["PRD.md", "README.md", "CLAUDE.md"]) {
    for (const line of (read(path.join(dir, f)) || "").split("\n")) {
      if (!/(website|site|live|production|prod|domain|landing|homepage|url)\b/i.test(line)) continue;
      const u = (line.match(URL_RE) || []).map(cleanUrl).find(ownSite);
      if (u) return { url: u, source: f };
    }
  }
  return null;
}

/** Whether a URL answers with a 2xx/3xx within 8 s. */
async function isLive(url) {
  try { const r = await fetch(url, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(8000) }); return r.ok; } catch { return false; }
}

/**
 * What Jarvis knows about a project's website, stored on the project as `site` by projects sync:
 * { code: {framework, path} | null, url, source, live, deploy, checked_at }. The owner's own address (`site_url`,
 * set on the Reviews page) always wins on the site; this is only the guess.
 */
export async function detectSite(dir, { remote = null } = {}) {
  if (!dir || !fs.existsSync(dir)) return null;
  const code = detectSiteCode(dir);
  const found = detectSiteUrl(dir, { remote });
  const deploy = fs.existsSync(path.join(dir, ".vercel", "project.json")) ? "Vercel" : fs.existsSync(path.join(dir, "netlify.toml")) ? "Netlify" : null;
  const live = found ? await isLive(found.url) : false;
  return { code, url: found?.url || null, source: found?.source || null, live, deploy, checked_at: new Date().toISOString() };
}

/* ---------------- the skills pack ---------------- */
// Pinned so every install builds with the same skills; bump the commits in a tool release.
export const SOURCES = [
  { repo: "Leonxlnx/taste-skill", ref: "ce26fc25c0e5e8cab638f883de62d9a86ee5e45b", licence: "MIT",
    skills: { "taste-skill": "skills/taste-skill", "redesign-skill": "skills/redesign-skill", "image-to-code-skill": "skills/image-to-code-skill" } },
  { repo: "vercel-labs/agent-skills", ref: "063bee94c3f4df8453406c830b0a7df0f2860278", licence: "see repo",
    skills: { "web-design-guidelines": "skills/web-design-guidelines" } },
  { repo: "microsoft/playwright-cli", ref: "b85c7a736bb473bf55b584e54a09ffa698d6d871", licence: "Apache-2.0",
    skills: { "playwright-cli": "skills/playwright-cli" } },
  { repo: "VoltAgent/awesome-design-md", ref: "13be5c05c63be24b57581162364167028020f043", licence: "MIT", extra: { designs: "design-md" } },
];
export const PLUGIN_NAME = "jarvis-website";

/** The pack a website run loads: { pluginDir, designsDir, skills: {name: SKILL.md path} }. */
export function prepareWebsiteSkills() {
  const { pluginDir, skills, extra } = preparePack(PLUGIN_NAME, SOURCES, "Design skills for Jarvis website builds (pinned; see agent/website.mjs).");
  return { pluginDir, designsDir: extra.designs || null, skills };
}

/* ---------------- the run's prompt ---------------- */
/** The extra instructions for a website build run; worker.mjs appends them to its usual code-mode prompt. */
export function websiteBrief({ project, kind, site, siteUrl, pack, playwright }) {
  const url = siteUrl || site?.url || null;
  const sk = (n) => pack.skills[n] ? `\`${pack.skills[n]}\`` : "(not available this run: skip)";
  const redesign = kind === "redesign";
  return `## Website build (${redesign ? "Try a new visual" : "Build website"})
The owner pressed "${redesign ? "Try a new visual" : "Build website"}" on ${project.name}'s Reviews page. ${redesign
    ? `The project already has a website${url ? ` (${url}${siteUrl ? ", set by the owner" : site?.source ? `, found in ${site.source}` : ""})` : ""}${site?.code ? `; its code is ${site.code.framework} in \`${site.code.path}\`` : ""}. Give it a new, clearly better visual direction: restyle the existing pages, keep the routes, content, data and behaviour.`
    : `It has no website yet${site?.code ? ` (but ${site.code.framework} code exists in \`${site.code.path}\`: build on it)` : ""}. Build its first public website.`}

1. **Read everything about the project first**: PRD.md, CLAUDE.md, README, DESIGN.md or any brand/design doc, docs/, and the existing UI code. The site's message, audience, offer and call to action come from these docs only. Never invent features, numbers, testimonials, logos of customers, prices or claims; where the docs don't say, write \`TODO(owner): …\` in the copy.
2. **Design direction.** Follow the taste skill ${sk("taste-skill")}${redesign ? ` and the redesign skill ${sk("redesign-skill")} (audit the current UI first, then redesign)` : ""}. Read the SKILL.md files with Read; they are also loaded as the \`${PLUGIN_NAME}\` plugin's skills.
3. **Design system.** ${pack.designsDir ? `Real design systems are in \`${pack.designsDir}\` (one folder per brand, each with a DESIGN.md).` : ""} If the project has a DESIGN.md, follow it. If not, pick 1-2 references that fit the project's audience and tone, and write the project's own \`DESIGN.md\` adapted from them (tokens, type scale, spacing, components, do/don't). Borrow principles and structure, never another brand's name, logo or signature identity.
4. **From reference to code.** Use the image-to-code skill ${sk("image-to-code-skill")} for its analyse-then-implement discipline. There is no image generator in this run: skip any step that generates images and work from the DESIGN.md and the references instead.
5. **Where the code goes.** Match the project's stack. ${site?.code ? `The site code lives in \`${site.code.path}\` (${site.code.framework}).` : "If the project has no web stack, create a static site in `site/` (HTML and CSS, no build step) unless the PRD names a stack."} Don't add dependencies unless there is no other way: \`npm install\` is not available in this run, so list any needed package in your final message instead.
6. **Audit.** Run the web design guidelines skill ${sk("web-design-guidelines")} on the files you changed and fix what it finds (it fetches its rules with WebFetch).
7. **Look at it.** ${playwright ? `Use the Playwright CLI skill ${sk("playwright-cli")} (\`${playwright}\`): start the site (the project's dev script as a background command, or open the static file), take desktop (1440 px) and mobile (390 px) screenshots of each page you touched, check the console for errors, and fix what looks broken. Stop the dev server before you finish. Don't commit screenshots.` : "The Playwright CLI isn't installed on this computer, so skip the visual check and say so in your final message (install it with `npm i -g @playwright/cli`)."}
8. Commit in small steps with clear messages. Never deploy, never change DNS or hosting, never touch .env files or secrets.

Final message: what you built or changed (files), the design reference you used and why, the guideline findings fixed and left, what the screenshots showed, every \`TODO(owner)\` you left, and how to preview it locally.`;
}

/** The Playwright CLI command available on this computer, if any. */
export function playwrightCommand() {
  try { execFileSync("playwright-cli", ["--version"], { stdio: "ignore", timeout: 15_000 }); return "playwright-cli"; } catch { return null; }
}

/* ---------------- CLI ---------------- */
if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, only] = process.argv.slice(2);
  if (cmd === "skills") {
    const pack = prepareWebsiteSkills();
    console.log(JSON.stringify({ ...pack, playwright: playwrightCommand() }, null, 2));
  } else if (cmd === "detect") {
    const { scanProjects } = await import("./projects.mjs");
    for (const p of scanProjects().filter((x) => !only || x.id === only)) console.log(p.id.padEnd(22), JSON.stringify(await detectSite(p.dir, { remote: p.remote })));
  } else console.log("usage: node website.mjs detect [id] | skills");
}
