import { createHmac, randomBytes, scryptSync } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { bearerOk, safeEq } from "./bearer";

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

/* ---- session cookie: v1.<exp>.<nonce>.<sig> ---- */
function sign(payload: string) {
  return b64u(createHmac("sha256", secret()).update(payload).digest());
}
export function newSessionValue(): { value: string; maxAge: number } {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE;
  const payload = `v1.${exp}.${b64u(randomBytes(12))}`;
  return { value: `${payload}.${sign(payload)}`, maxAge: MAX_AGE };
}
export function validSession(value: string | undefined): boolean {
  if (!value) return false;
  const parts = value.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return false;
  const payload = parts.slice(0, 3).join(".");
  if (!safeEq(sign(payload), parts[3])) return false;
  return +parts[1] > Date.now() / 1000;
}

/** Use at the top of every page and Server Function. */
export async function requireSession() {
  const c = await cookies();
  if (!validSession(c.get(COOKIE)?.value)) redirect("/login");
}

/** Agent API: Authorization: Bearer <JARVIS_AGENT_TOKEN>. */
export function agentOk(req: Request): boolean {
  return bearerOk(req.headers.get("authorization"), process.env.JARVIS_AGENT_TOKEN);
}
