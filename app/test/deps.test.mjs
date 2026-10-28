// `next` is pinned exactly (no range), so a vulnerable version can only come back by someone editing this pin.
// The floor below is the first release outside the advisory range 16.0.0–16.4.0 (the 2026-10-28 audit, finding H 9.9:
// unauthenticated RCE in image optimisation, GHSA-2464-fhr4-w9xw, on a `/_next/image` that answers without a session).
// Raise MIN_NEXT whenever a later advisory moves the floor; never lower it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const MIN_NEXT = [16, 4, 3];
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const atLeast = (v, min) => min.every((m, i) => v[i] === m) || v[min.findIndex((m, i) => v[i] !== m)] > min[min.findIndex((m, i) => v[i] !== m)];

test("next is pinned to an exact version", () => {
  assert.match(pkg.dependencies.next, /^\d+\.\d+\.\d+$/, `next must be an exact version, got "${pkg.dependencies.next}"`);
});

test("next is at or above the patched floor", () => {
  const v = pkg.dependencies.next.split(".").map(Number);
  assert.ok(atLeast(v, MIN_NEXT), `next ${pkg.dependencies.next} is below ${MIN_NEXT.join(".")}, the floor set by GHSA-2464-fhr4-w9xw`);
});
