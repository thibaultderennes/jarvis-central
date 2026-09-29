import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { getProjects, logActivity } from "@/lib/data";
import { getPlan, planEvents } from "@/lib/plan";
import { addDays, mondayOf, today, TZ, weekday, zonedToUtc } from "@/lib/time";

// Read-only endpoint for the Google Apps Script that writes the week plan into Google Calendar.
// Its own token (JARVIS_CAL_TOKEN) can only read the plan and report a sync, nothing else.
function ok(req: NextRequest, allowQuery = false) {
  const t = process.env.JARVIS_CAL_TOKEN, h = req.headers.get("authorization") || "";
  // Calendar apps can't send headers, so the subscription feed takes the key in its URL.
  const given = h.startsWith("Bearer ") ? h.slice(7) : allowQuery ? req.nextUrl.searchParams.get("key") || "" : "";
  if (!t || t.length < 32 || !given) return false;
  const a = Buffer.from(given), b = Buffer.from(t);
  return a.length === b.length && timingSafeEqual(a, b);
}
const J = (v: unknown, status = 200) => NextResponse.json(v, { status });

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const what = (await ctx.params).path[0];
  if (what === "jarvis.ics") return feed(req);
  if (!ok(req)) return J({ error: "Unauthorized" }, 401);
  if (what !== "plan") return J({ error: "Not found" }, 404);
  const t = today(), sunday = weekday(t) === 6;
  const week = sunday ? addDays(t, 1) : mondayOf(t);
  const plan = await getPlan(week);
  if (!plan) return J({ error: "No plan for that week yet", week_start: week }, 404);
  const colors = Object.fromEntries((await getProjects(true)).map((p) => [p.id, p.color]));
  return J({
    week_start: week, version: plan.version, synced_version: plan.synced_version,
    // the script only rewrites a week on Sundays; a forced re-plan (plan.mjs --force) counts as one
    is_sunday: sunday || !!plan.force_resync,
    range_start: zonedToUtc(week, "00:00").toISOString(), range_end: zonedToUtc(addDays(week, 7), "00:00").toISOString(),
    events: planEvents(plan, req.nextUrl.origin, colors),
  });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  if (!ok(req)) return J({ error: "Unauthorized" }, 401);
  if ((await ctx.params).path[0] !== "synced") return J({ error: "Not found" }, 404);
  const b = await req.json().catch(() => ({}));
  await sql()`update week_plans set synced_version = ${+b.version || null}, synced_at = now(), synced_count = ${+b.count || 0} where week_start = ${b.week_start}`;
  await logActivity("calendar_sync", null, { week: b.week_start, count: b.count });
  return J({ ok: true });
}

/* ---------- iCalendar feed for Apple Calendar (File → New Calendar Subscription) ---------- */
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const icsTime = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
function fold(line: string) {
  const out: string[] = []; let s = line;
  while (Buffer.byteLength(s) > 74) { let n = 74; while (Buffer.byteLength(s.slice(0, n)) > 74) n--; out.push(s.slice(0, n)); s = " " + s.slice(n); }
  out.push(s); return out.join("\r\n");
}
async function feed(req: NextRequest) {
  if (!ok(req, true)) return new NextResponse("Unauthorized", { status: 401 });
  const t = today(), start = addDays(mondayOf(t), -14);
  const colors = Object.fromEntries((await getProjects(true)).map((p) => [p.id, p.color]));
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Jarvis Central//Week plan//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "X-WR-CALNAME:Jarvis · work plan", `X-WR-TIMEZONE:${TZ}`, "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H"];
  const stamp = icsTime(new Date().toISOString());
  // Same rule as the Google script: a week appears once it's planned on its Sunday, never earlier.
  const lastWeek = weekday(t) === 6 ? addDays(t, 1) : mondayOf(t);
  for (let w = 0; w < 5; w++) {
    const wk = addDays(start, 7 * w);
    if (wk > lastWeek) break;
    const plan = await getPlan(wk);
    if (!plan) continue;
    for (const ev of planEvents(plan, req.nextUrl.origin, colors)) {
      lines.push("BEGIN:VEVENT", `UID:${ev.uid}@jarvis-central`, `DTSTAMP:${stamp}`, `DTSTART:${icsTime(ev.start)}`, `DTEND:${icsTime(ev.end)}`,
        fold(`SUMMARY:${esc(ev.title)}`), fold(`DESCRIPTION:${esc(ev.description)}`), `CATEGORIES:${esc(ev.color)}`, "TRANSP:OPAQUE", "END:VEVENT");
    }
  }
  lines.push("END:VCALENDAR");
  await logActivity("calendar_feed", null, {});
  return new NextResponse(lines.join("\r\n") + "\r\n", { headers: { "content-type": "text/calendar; charset=utf-8", "cache-control": "no-store" } });
}
