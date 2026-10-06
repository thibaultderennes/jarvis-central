import { test } from "node:test";
import assert from "node:assert/strict";
import { normSiteUrl, websiteKind, siteSummary } from "../lib/website.ts";

test("normSiteUrl: bare domains get https, junk is refused, empty clears", () => {
  assert.equal(normSiteUrl("example.com"), "https://example.com");
  assert.equal(normSiteUrl(" https://example.com/ "), "https://example.com");
  assert.equal(normSiteUrl("http://shop.example.com/path"), "http://shop.example.com/path");
  assert.equal(normSiteUrl(""), "");
  assert.equal(normSiteUrl("not a url"), null);
  assert.equal(normSiteUrl("localhost"), null);
  assert.equal(normSiteUrl("javascript://alert(1)"), null);
  assert.equal(normSiteUrl("ftp://example.com"), null);
});

test("websiteKind: an address or site code means Try a new visual", () => {
  assert.equal(websiteKind({}), "new");
  assert.equal(websiteKind({ site: { code: null, url: null, source: null, live: false, deploy: "Vercel" } }), "new");
  assert.equal(websiteKind({ site_url: "https://example.com" }), "redesign");
  assert.equal(websiteKind({ site: { code: { framework: "Astro", path: "." }, url: null, source: null, live: false, deploy: null } }), "redesign");
  assert.equal(websiteKind({ site: { code: null, url: "https://example.com", source: "README.md", live: true, deploy: null } }), "redesign");
});

test("siteSummary: the owner's address wins, then what was found", () => {
  assert.match(siteSummary({ site_url: "https://example.com", site: { code: null, url: "https://other.com", source: "README.md", live: true, deploy: null } }), /example\.com \(set by you\)/);
  assert.match(siteSummary({}), /next project folder refresh/);
  assert.match(siteSummary({ site: { code: { framework: "Next.js", path: "app" }, url: null, source: null, live: false, deploy: null } }), /Next\.js code in app\//);
});

import { websiteBrief, githubWebUrl } from "../../agent/website.mjs";

const pack = { skills: { "taste-skill": "/x/taste/SKILL.md", "redesign-skill": "/x/redesign/SKILL.md" }, designsDir: "/x/designs" };
const project = { name: "Demo" };

test("websiteBrief: Try a new visual asks for 3 distinct previews and leaves the live site alone", () => {
  const b = websiteBrief({ project, kind: "redesign", site: { code: { framework: "Static HTML", path: "public" }, url: "https://example.com", source: "README.md" }, pack, playwright: "playwright-cli",
    ask: "darker and bolder", branch: "jarvis/website-abc", repoWeb: "https://github.com/acme/demo" });
  assert.match(b, /3 distinct directions/);
  assert.match(b, /Do not change the live pages/);
  assert.match(b, /darker and bolder/);
  assert.match(b, /including the palette and the typefaces/);
  assert.match(b, /https:\/\/github\.com\/acme\/demo\/blob\/jarvis\/website-abc\/visuals\/screenshots\/<file>\.png\?raw=true/);
  const kept = websiteBrief({ project, kind: "redesign", site: null, pack, playwright: null, keepColours: true });
  assert.match(kept, /keep their colours/);
  assert.doesNotMatch(kept, /Screenshots\*\* section/);
});

test("websiteBrief: Build website builds one site", () => {
  const b = websiteBrief({ project, kind: "new", site: null, pack, playwright: null });
  assert.match(b, /Build its first public website/);
  assert.doesNotMatch(b, /3 distinct directions/);
});

test("githubWebUrl: ssh and https GitHub remotes only", () => {
  assert.equal(githubWebUrl("git@github.com:acme/demo.git"), "https://github.com/acme/demo");
  assert.equal(githubWebUrl("https://github.com/acme/demo"), "https://github.com/acme/demo");
  assert.equal(githubWebUrl("https://gitlab.com/acme/demo"), null);
});
