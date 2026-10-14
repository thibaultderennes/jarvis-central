// Spacing stays on the 4px scale (DESIGN.md "Spacing and shape"): every padding / margin / gap pixel value in the
// app's CSS and inline styles is a scale step (or a 0–2px hairline); tokens used are the ones defined on :root.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCALE = new Set([4, 8, 12, 16, 20, 24, 32, 40]);
const HAIRLINE = new Set([0, 1, 2]);
// Layout offsets that must match a measured position, not the spacing rhythm. Keep this list short.
const ALLOW = [
  { file: "app/globals.css", rule: ".shell", px: 72, why: "bottom clearance under the page content" },
  { file: "app/globals.css", rule: ".shell", px: 92, why: "phone: clears the fixed bottom bar" },
  { file: "app/(main)/today/today.css", rule: ".td-allday", px: 42, why: "lines up with the timed blocks (left: 42px in TodayView)" },
];

const CSS_DECL = /(?<=[{;\s]|^)((?:padding|margin|gap|row-gap|column-gap)(?:-(?:top|right|bottom|left|inline|block)(?:-(?:start|end))?)?)\s*:\s*([^;}]+)/g;
const TSX_DECL = /\b((?:padding|margin|gap|rowGap|columnGap)(?:Top|Right|Bottom|Left|Inline|Block)?(?:Start|End)?)\s*:\s*("[^"]*"|'[^']*'|-?\d+(?:\.\d+)?)(?=[\s,}])/g;

/** Off-scale spacing values in one file's source: [{ line, prop, px, text }]. */
export function offScale(src, kind) {
  const out = [];
  src.split("\n").forEach((line, i) => {
    for (const m of line.matchAll(kind === "css" ? CSS_DECL : TSX_DECL)) {
      const v = m[2];
      const nums = kind === "tsx" && /^-?[\d.]+$/.test(v) ? [v] : [...v.matchAll(/(-?\d+(?:\.\d+)?)px/g)].map((x) => x[1]);
      for (const n of nums) {
        const px = Math.abs(Number(n));
        if (!SCALE.has(px) && !HAIRLINE.has(px)) out.push({ line: i + 1, prop: m[1], px, text: line.trim() });
      }
    }
  });
  return out;
}

function files(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) files(p, acc);
    else if (/\.(css|tsx)$/.test(e.name)) acc.push(p);
  }
  return acc;
}
const SOURCES = [...files(path.join(APP, "app")), ...files(path.join(APP, "components"))];

test("offScale: flags odd values, passes the scale, hairlines and tokens", () => {
  assert.deepEqual(offScale(".a { padding: 7px 12px; gap: 6px; margin: 0 -1px; }", "css").map((x) => x.px), [7, 6]);
  assert.deepEqual(offScale(".a { padding: var(--s-2) 2px calc(var(--s-3) + env(x, 0px)); margin-top: -8px; }", "css"), []);
  assert.deepEqual(offScale(".a { border-gap: 7px; } .gap:hover { color: red; }", "css"), []);
  assert.deepEqual(offScale(`<div style={{ gap: 10, padding: "3px 0", marginTop: "var(--s-2)" }} />`, "tsx").map((x) => x.px), [10, 3]);
});

test("every padding / margin / gap in the app is on the 4px scale", () => {
  const bad = [];
  for (const f of SOURCES) {
    const rel = path.relative(APP, f).split(path.sep).join("/");
    for (const hit of offScale(fs.readFileSync(f, "utf8"), f.endsWith(".css") ? "css" : "tsx")) {
      if (ALLOW.some((a) => a.file === rel && a.px === hit.px && hit.text.startsWith(a.rule + " "))) continue;
      bad.push(`${rel}:${hit.line} ${hit.prop}: ${hit.px}px`);
    }
  }
  assert.deepEqual(bad, [], `Off the 4px spacing scale (use var(--s-N), see DESIGN.md):\n${bad.join("\n")}`);
});

test("the allowlist has no stale entries", () => {
  for (const a of ALLOW) {
    const src = fs.readFileSync(path.join(APP, a.file), "utf8");
    assert.ok(offScale(src, "css").some((h) => h.px === a.px && h.text.startsWith(a.rule + " ")), `${a.file} ${a.rule} ${a.px}px is no longer used: drop it from ALLOW`);
  }
});

test("spacing tokens used are defined on :root", () => {
  const root = fs.readFileSync(path.join(APP, "app/globals.css"), "utf8");
  const defined = new Set([...root.matchAll(/(--s-\d+):\s*(\d+)px/g)].map((m) => { assert.equal(Number(m[2]), 4 * Number(m[1].slice(4)), m[1]); return m[1]; }));
  for (const f of SOURCES) {
    for (const m of fs.readFileSync(f, "utf8").matchAll(/var\((--s-\d+)\)/g)) assert.ok(defined.has(m[1]), `${path.relative(APP, f)} uses ${m[1]}, not defined on :root`);
  }
});
