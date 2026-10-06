// Reviews → "Build website" / "Try a new visual". Pure helpers (no imports) so `npm test` can load them.

export type SiteLike = { site?: { code: { framework: string; path: string } | null; url: string | null; source: string | null; live: boolean; deploy: string | null } | null; site_url?: string };

/** The address the owner typed: "" clears it; a bare domain gets https://. Null when it isn't a web address. */
export function normSiteUrl(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (!s) return "";
  if (s.length > 300) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`);
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".")) return null;
    return u.toString().replace(/\/$/, "");
  } catch { return null; }
}

/** "redesign" when the project already has a site (an address, or site code in the folder), else "new". */
export function websiteKind(p: SiteLike): "new" | "redesign" {
  return p.site_url || p.site?.url || p.site?.code ? "redesign" : "new";
}

/** One line on what Jarvis knows about the site, for the card. */
export function siteSummary(p: SiteLike): string {
  const s = p.site;
  if (p.site_url) return `${p.site_url} (set by you)`;
  if (!s) return "Not checked yet: it's checked on the next project folder refresh.";
  const parts: string[] = [];
  if (s.url) parts.push(`${s.url}${s.live ? "" : " (didn't answer)"} · found in ${s.source}`);
  if (s.code) parts.push(`${s.code.framework} code in ${s.code.path === "." ? "the project folder" : s.code.path + "/"}`);
  if (s.deploy && !s.url) parts.push(`linked to ${s.deploy}`);
  return parts.length ? parts.join(" · ") : "No website found in the project folder.";
}
