// The agent API's bearer check (lib/auth.ts agentOk → lib/bearer.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { bearerOk } from "../lib/bearer.ts";

const T = "a".repeat(64);

test("accepts the exact token", () => assert.equal(bearerOk(`Bearer ${T}`, T), true));
test("refuses a wrong, longer or shorter token", () => {
  assert.equal(bearerOk(`Bearer ${"b".repeat(64)}`, T), false);
  assert.equal(bearerOk(`Bearer ${T}x`, T), false);
  assert.equal(bearerOk(`Bearer ${T.slice(1)}`, T), false);
});
test("refuses a missing header or another scheme", () => {
  assert.equal(bearerOk(null, T), false);
  assert.equal(bearerOk("", T), false);
  assert.equal(bearerOk(`Basic ${T}`, T), false);
  assert.equal(bearerOk(T, T), false);
});
test("refuses everything when the token isn't configured or is too short", () => {
  assert.equal(bearerOk("Bearer ", undefined), false);
  assert.equal(bearerOk("Bearer ", ""), false);
  assert.equal(bearerOk("Bearer short", "short"), false);
});
