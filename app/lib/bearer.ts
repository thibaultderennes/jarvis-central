import { timingSafeEqual } from "node:crypto";

/** Constant-time string compare (different lengths are unequal without leaking where they differ). */
export function safeEq(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
/** The agent API's check: `Authorization: Bearer <token>`, and a configured token of at least 32 characters. */
export function bearerOk(header: string | null, token: string | undefined): boolean {
  const h = header || "";
  if (!token || token.length < 32 || !h.startsWith("Bearer ")) return false;
  return safeEq(h.slice(7), token);
}
