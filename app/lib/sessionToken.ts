import { createHash, createHmac } from "node:crypto";
import { safeEq } from "./bearer.ts"; // with the extension, so node --test can load it

/**
 * The session cookie, pure (tested in test/sessiontoken.test.mjs): `v2.<exp>.<nonce>.<epoch>.<sig>`.
 * - The signing key mixes the session secret with a fingerprint of the password hash and the TOTP secret, so a new
 *   password or authenticator (`setup.mjs login`) ends every session at once, with no second step.
 * - `epoch` must equal the one stored on the site (kv `session.epoch`); logging out bumps it, so a copied cookie
 *   stops working everywhere. That check needs the database, so it lives in auth.ts `sessionOk`, not here.
 */
export function signingKey(secret: string, passwordHash = "", totpSecret = ""): string {
  const fp = createHash("sha256").update(`${passwordHash}\u0000${totpSecret}`).digest("base64url");
  return `${secret}.${fp}`;
}
const sign = (key: string, payload: string) => createHmac("sha256", key).update(payload).digest("base64url");

export function makeToken(key: string, exp: number, nonce: string, epoch: number): string {
  const payload = `v2.${exp}.${nonce}.${epoch}`;
  return `${payload}.${sign(key, payload)}`;
}

/** The token's expiry and epoch when its signature is right and it hasn't expired; else null. */
export function parseToken(key: string, value: string | undefined, nowSec = Date.now() / 1000): { exp: number; epoch: number } | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 5 || parts[0] !== "v2") return null;
  if (!safeEq(sign(key, parts.slice(0, 4).join(".")), parts[4])) return null;
  const exp = Number(parts[1]), epoch = Number(parts[3]);
  if (!Number.isInteger(exp) || !Number.isInteger(epoch) || exp <= nowSec) return null;
  return { exp, epoch };
}
