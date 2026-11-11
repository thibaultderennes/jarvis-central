// Session cookie (lib/sessionToken.ts): a new password or TOTP secret, an expiry or a tampered epoch ends a session.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeToken, parseToken, signingKey } from "../lib/sessionToken.ts";

const SECRET = "s".repeat(40), NOW = 1_800_000_000;
const k = signingKey(SECRET, "scrypt$hash-one", "TOTPONE");

test("a fresh token parses to its expiry and epoch", () => {
  assert.deepEqual(parseToken(k, makeToken(k, NOW + 60, "n", 3), NOW), { exp: NOW + 60, epoch: 3 });
});

test("a new password or authenticator invalidates every token", () => {
  const t = makeToken(k, NOW + 60, "n", 0);
  assert.equal(parseToken(signingKey(SECRET, "scrypt$hash-two", "TOTPONE"), t, NOW), null);
  assert.equal(parseToken(signingKey(SECRET, "scrypt$hash-one", "TOTPTWO"), t, NOW), null);
  assert.equal(parseToken(signingKey("t".repeat(40), "scrypt$hash-one", "TOTPONE"), t, NOW), null);
});

test("expired, tampered, old-format and junk tokens are refused", () => {
  assert.equal(parseToken(k, makeToken(k, NOW - 1, "n", 0), NOW), null);
  const t = makeToken(k, NOW + 60, "n", 0).split(".");
  t[3] = "1"; // claim a later epoch
  assert.equal(parseToken(k, t.join("."), NOW), null);
  assert.equal(parseToken(k, "v1.1900000000.abc.sig", NOW), null);
  for (const bad of [undefined, "", "v2", "v2.a.b.c.d"]) assert.equal(parseToken(k, bad, NOW), null);
});
