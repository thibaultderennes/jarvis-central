import { createHmac, randomBytes, scryptSync } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { bearerOk, safeEq } from "./bearer";
import { makeToken, parseToken, signingKey } from "./sessionToken";

export const COOKIE = "jarvis_session";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function secret(): string {
  const s = process.env.JARVIS_SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("JARVIS_SESSION_SECRET is missing or too short");
  return s;
}
const b64u = (b: Buffer) => b.toString("base64url");

/* ---- password: scrypt$N$r$p$salt$hash (base64url) ---- */
export function hashPassword(pw: string): string {
  const salt = randomBytes(16), N = 16384, r = 8, p = 1;
  const h = scryptSync(pw, salt, 32, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${b64u(salt)}$${b64u(h)}`;
}
export function verifyPassword(pw: string, stored: string | undefined): boolean {
  if (!stored) return false;
  const [alg, N, r, p, salt, hash] = stored.split("$");
  if (alg !== "scrypt") return false;
  const h = scryptSync(pw, Buffer.from(salt, "base64url"), 32, { N: +N, r: +r, p: +p });
  return safeEq(b64u(h), hash);
}

/* ---- TOTP (RFC 6238, SHA-1, 6 digits, 30 s) ---- */
function base32Decode(s: string): Buffer {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, val = 0; const out: number[] = [];
  for (const c of s.toUpperCase().replace(/=+$|\s/g, "")) {
    const i = A.indexOf(c); if (i < 0) continue;
    val = (val << 5) | i; bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
export function totpAt(secretB32: string, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", base32Decode(secretB32)).update(buf).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1e6).padStart(6, "0");
}
export function verifyTotp(code: string, secretB32: string | undefined): boolean {
  if (!secretB32 || !/^\d{6}$/.test(code)) return false;
  const c = Math.floor(Date.now() / 30000);
  return [-1, 0, 1].some((d) => safeEq(totpAt(secretB32, c + d), code));
}

/* ---- session cookie: v2.<exp>.<nonce>.<epoch>.<sig> (lib/sessionToken.ts) ---- */
const key = () => signingKey(secret(), process.env.JARVIS_PASSWORD_HASH, process.env.JARVIS_TOTP_SECRET);
export function newSessionValue(epoch: number): { value: string; maxAge: number } {
  return { value: makeToken(key(), Math.floor(Date.now() / 1000) + MAX_AGE, b64u(randomBytes(12)), epoch), maxAge: MAX_AGE };
}
/** Signature and expiry only: the proxy's cheap first check. */
export function validSession(value: string | undefined): boolean {
  return !!parseToken(key(), value);
}
/** The full check: signature, expiry, and not logged out since (the epoch on the site). */
export async function sessionOk(value: string | undefined): Promise<boolean> {
  const t = parseToken(key(), value);
  if (!t) return false;
  const { sessionEpoch } = await import("./sessionEpoch");
  return t.epoch === (await sessionEpoch());
}

/** Use at the top of every page and Server Function. */
export async function requireSession() {
  const c = await cookies();
  if (!(await sessionOk(c.get(COOKIE)?.value))) redirect("/login");
}

/** Agent API: Authorization: Bearer <JARVIS_AGENT_TOKEN>. */
export function agentOk(req: Request): boolean {
  return bearerOk(req.headers.get("authorization"), process.env.JARVIS_AGENT_TOKEN);
}
