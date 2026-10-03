import type { NextRequest } from "next/server";
import { COOKIE, validSession } from "@/lib/auth";
import { paletteProjects, searchItems } from "@/lib/search";

// The ⌘K palette (components/CommandPalette.tsx). Owner session only.
// ?q= → {items} (≤ 20, open first); &projects=1 adds {projects} (fetched once, when the palette first opens).
export async function GET(req: NextRequest) {
  if (!validSession(req.cookies.get(COOKIE)?.value)) return Response.json({ error: "signed out" }, { status: 401 });
  const sp = req.nextUrl.searchParams, query = (sp.get("q") || "").slice(0, 120);
  const [items, projects] = await Promise.all([searchItems(query), sp.get("projects") ? paletteProjects() : null]);
  return Response.json(projects ? { items, projects } : { items }, { headers: { "Cache-Control": "private, no-store" } });
}
