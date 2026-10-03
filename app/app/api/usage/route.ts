import type { NextRequest } from "next/server";
import { COOKIE, validSession } from "@/lib/auth";
import { addClickEvents, trackingEnabled, type ClickIn } from "@/lib/usage";

// Batches from components/UsageTracker.tsx (navigator.sendBeacon or fetch keepalive). Owner session only, same origin.
// Always answers 204 once authenticated: a failed insert (e.g. before the deploy migration) is dropped silently.
const none = (status = 204) => new Response(null, { status });

export async function POST(req: NextRequest) {
  if (!validSession(req.cookies.get(COOKIE)?.value)) return none(401);
  const origin = req.headers.get("origin");
  const host = (() => { try { return origin ? new URL(origin).host : null; } catch { return "?"; } })();
  if (host && host !== req.headers.get("host") && host !== req.nextUrl.host) return none(403);
  if (!trackingEnabled()) return none();
  const text = await req.text().catch(() => "");
  if (!text || text.length > 64_000) return none(text ? 413 : 400);
  let b: { sid?: unknown; events?: unknown };
  try { b = JSON.parse(text); } catch { return none(400); }
  if (!Array.isArray(b?.events)) return none(400);
  await addClickEvents(typeof b.sid === "string" ? b.sid : "", b.events as ClickIn[]);
  return none();
}
