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
/** "https://github.com/owner/repo" for a GitHub remote (ssh or https), else null. */
export function githubWebUrl(remote) {
  const m = String(remote || "").match(/github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/);
  return m ? `https://github.com/${m[1]}/${m[2]}` : null;
}

/**
 * The extra instructions for a website build run; worker.mjs appends them to its usual code-mode prompt.
 * `kind` "new" builds the first site; "redesign" (Try a new visual) builds 3 distinct directions as preview pages next to
 * the live site, which stays untouched. `ask` = what the owner wants changed (free text, may be empty); `keepColours` =
 * keep the current palette (otherwise only the name and logo are fixed). `branch` + `repoWeb` let the reply embed screenshots.
 */
export function websiteBrief({ project, kind, site, siteUrl, pack, playwright, ask = "", keepColours = false, branch = null, repoWeb = null }) {
  const url = siteUrl || site?.url || null;
  const sk = (n) => pack.skills[n] ? `\`${pack.skills[n]}\`` : "(not available this run: skip)";
  const redesign = kind === "redesign";
  const refs = pack.designsDir ? `Real design systems are in \`${pack.designsDir}\` (one folder per brand, each with a DESIGN.md).` : "";
  const shotsUrl = (f) => repoWeb && branch ? `${repoWeb}/blob/${branch}/${f}?raw=true` : null;
  const look = playwright
    ? `Use the Playwright CLI skill ${sk("playwright-cli")} (\`${playwright}\`): serve the site (the project's dev script as a background command, or a static file server for plain HTML), check the console for errors, and fix what looks broken. Stop the server before you finish.`
    : "The Playwright CLI isn't installed on this computer, so you can't screenshot: say so in your final message (install it with `npm i -g @playwright/cli`).";
  const askLine = ask ? `\n\n**What the owner wants changed (their words, the most important input):** ${ask}` : "";
  if (!redesign) return `## Website build (Build website)
The owner pressed "Build website" on ${project.name}'s Reviews page. It has no website yet${site?.code ? ` (but ${site.code.framework} code exists in \`${site.code.path}\`: build on it)` : ""}. Build its first public website.${askLine}

0. **Open the skills before anything else.** Read each SKILL.md named below in full with Read (taste, image-to-code, web design guidelines${playwright ? ", Playwright CLI" : ""}). The worker checks the run's transcript: a skill you never opened counts as not used, and you'll be sent back to apply it.
1. **Read everything about the project first**: PRD.md, CLAUDE.md, README, DESIGN.md or any brand/design doc, docs/, and the existing UI code. The site's message, audience, offer and call to action come from these docs only. Never invent features, numbers, testimonials, logos of customers, prices or claims; where the docs don't say, write \`TODO(owner): …\` in the copy.
2. **Design direction.** Follow the taste skill ${sk("taste-skill")}. Read the SKILL.md files with Read; they are also loaded as the \`${PLUGIN_NAME}\` plugin's skills.
3. **Design system.** ${refs} If the project has a DESIGN.md, follow it. If not, pick 1-2 references that fit the project's audience and tone, and write the project's own \`DESIGN.md\` adapted from them (tokens, type scale, spacing, components, do/don't). Borrow principles and structure, never another brand's name, logo or signature identity.
4. **From reference to code.** Use the image-to-code skill ${sk("image-to-code-skill")} for its analyse-then-implement discipline. There is no image generator in this run: skip any step that generates images.
5. **Where the code goes.** Match the project's stack. ${site?.code ? `The site code lives in \`${site.code.path}\` (${site.code.framework}).` : "If the project has no web stack, create a static site in `site/` (HTML and CSS, no build step) unless the PRD names a stack."} Don't add dependencies unless there is no other way: \`npm install\` is not available in this run, so list any needed package in your final message instead.
6. **Audit.** Run the web design guidelines skill ${sk("web-design-guidelines")} on the files you changed and fix what it finds.
7. **Look at it.** ${look}${playwright ? " Take desktop (1440 px) and mobile (390 px) screenshots of each page into `visuals/screenshots/` and commit them." : ""}
8. Commit in small steps with clear messages (never commit the .playwright-cli folder or other tool output). Never deploy, never change DNS or hosting, never touch .env files or secrets.

Final message: a **Skills used** section (each skill and the concrete change it led to), what you built (files), the design reference you used and why, the guideline findings fixed and left, every \`TODO(owner)\` you left, how to preview it locally${shotsUrl("visuals/screenshots/") ? `, and a **Screenshots** section embedding each committed screenshot as a Markdown image with the URL form ${shotsUrl("visuals/screenshots/<file>.png")}` : ""}.`;

  return `## Website build (Try a new visual)
The owner pressed "Try a new visual" on ${project.name}'s Reviews page. The project already has a website${url ? ` (${url}${siteUrl ? ", set by the owner" : site?.source ? `, found in ${site.source}` : ""})` : ""}${site?.code ? `; its code is ${site.code.framework} in \`${site.code.path}\`` : ""}. They want to SEE genuinely different looks, not a polish of the current one. A restyle that keeps the same colours, type and layout is a failed run.${askLine}

**What to build: 3 distinct directions (A, B, C) of the home page**, each a standalone preview next to the live site. Do not change the live pages, their shared CSS, components or routes: everything new lives under a \`visuals/\` path the site serves (for a static site, a \`visuals/\` folder in the folder it publishes; for a framework, a \`/visuals/a\`, \`/visuals/b\`, \`/visuals/c\` route with its own styles), plus an index page at \`/visuals/\` linking the three with one line each.

**Fixed:** the product name, the logo/mark, and the copy (message, claims, CTA) from the docs and the current home page. ${keepColours
    ? "**The owner asked to keep their colours:** reuse the current palette in all three; vary type, layout, density, imagery and motion instead."
    : "**Everything else is open, including the palette and the typefaces.** Brand rules in the docs that lock colours, fonts or layout do not bind these previews: the owner pressed this button to see alternatives. (The name and logo stay.)"}

**How different:** each direction must differ from the current site and from the other two on at least three of: colour palette (or, if colours are kept, its use: dark vs light base, accent placement), type pairing, layout structure (grid, hero composition, section rhythm), density/whitespace, imagery or illustration style, motion. Give each a one-line name (e.g. "A · Night broadcast"). Make one direction safe-but-fresh, one bold, one unexpected for this category.

0. **Open the skills before anything else.** Read each SKILL.md named below in full with Read (taste, redesign, image-to-code, web design guidelines${playwright ? ", Playwright CLI" : ""}). The worker checks the run's transcript: a skill you never opened counts as not used, and you'll be sent back to apply it.
1. **Read the project first**: PRD.md, CLAUDE.md, README, any brand/design doc, and the current home page. Note the audience, the tone and the one thing the page must make people do.
2. **Audit the current look** with the redesign skill ${sk("redesign-skill")}: list what makes it look the way it does (palette, type, layout), so the directions can deliberately move away from it.
3. **Pick a different reference for each direction.** ${refs} Choose three that differ from each other and from the current site, each fitting the audience. Follow the taste skill ${sk("taste-skill")} for each. Borrow principles and structure, never another brand's name, logo or signature identity.
4. **Build each one** with the image-to-code skill's discipline ${sk("image-to-code-skill")} (analyse the reference, then implement; no image generator here, so skip generation). Plain HTML/CSS or the project's stack; no new dependencies (\`npm install\` isn't available; use system font stacks or fonts already in the repo, and say which webfont you'd add).
5. **Audit** each with the web design guidelines skill ${sk("web-design-guidelines")} and fix what it finds.
6. **Look at them.** ${look}${playwright ? " Take desktop (1440 px) and mobile (390 px) screenshots of the current home page and of each direction into `visuals/screenshots/` (`current-desktop.png`, `a-desktop.png`, `a-mobile.png`, …) and commit them. If two directions look alike in the screenshots, change one until they don't." : ""}
7. Write \`visuals/README.md\`: per direction, its name, the reference it borrows from, palette and type, and what it would mean to adopt it (which files change). Commit in small steps (never commit the .playwright-cli folder or other tool output). Never deploy, never touch .env files or secrets.

Final message: a **Skills used** section (each skill and the concrete change it led to), the three directions (name, one line on the idea, the reference), the preview paths (\`/visuals/a\` …) and how to open them locally${shotsUrl("x") ? `, a **Screenshots** section embedding the committed screenshots as Markdown images with the URL form ${shotsUrl("visuals/screenshots/<file>.png")} (current, then A, B, C)` : ""}, and how to adopt one: the owner replies "apply B" (or comments on the PR) and a build run makes it the real site.`;
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
