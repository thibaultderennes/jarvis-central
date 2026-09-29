import { createHmac } from "node:crypto";

function base32Decode(s) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = 0, val = 0; const out = [];
  for (const c of s.toUpperCase().replace(/=+$|\s/g, "")) { const i = A.indexOf(c); if (i < 0) continue; val = (val << 5) | i; bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
export function totpAt(secret, counter) {
  const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", base32Decode(secret)).update(buf).digest();
  const o = h[h.length - 1] & 15;
  return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, "0");
}
/** Codes for the previous, current and next 30 s window. */
export const totpNow = (secret) => { const c = Math.floor(Date.now() / 30000); return [c - 1, c, c + 1].map((x) => totpAt(secret, x)); };
