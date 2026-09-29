import type { NextConfig } from "next";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Tool version shown in the top bar. Source of truth: ../VERSION. Vercel may build app/ on its own, so
// fall back to package.json's "version" — releases bump both (see CLAUDE.md, rule 8).
function toolVersion(): string {
  const v = join(process.cwd(), "..", "VERSION");
  if (existsSync(v)) return readFileSync(v, "utf8").trim();
  return JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")).version || "dev";
}

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_JARVIS_VERSION: toolVersion() },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
