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
