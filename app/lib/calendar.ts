import ical, { type CalendarResponse, type VEvent } from "node-ical";
import { addDays, isoInTZ, timeInTZ, TZ } from "./time";

export type CalEvent = { id: string; date: string; start: string; end: string; startTime: string | null; endTime: string | null; allDay: boolean; title: string; location: string; calendar: number };

// Google Calendar → Settings → your calendar → "Secret address in iCal format". Several allowed, comma-separated.
// Apple (iCloud): Calendar app → share the calendar as "Public Calendar" → webcal:// link. Stored in APPLE_ICS_URLS.
const urls = () => [process.env.GOOGLE_ICS_URLS || process.env.GOOGLE_ICS_URL || "", process.env.APPLE_ICS_URLS || ""]
  .join(",").split(",").map((s) => s.trim().replace(/^webcals?:\/\//i, "https://")).filter(Boolean);
export const calendarConfigured = () => urls().length > 0;

let cache: { at: number; data: CalendarResponse[] } | null = null;
async function load(): Promise<CalendarResponse[]> {
  if (cache && Date.now() - cache.at < 5 * 60_000) return cache.data;
  const data = await Promise.all(urls().map(async (u) => {
    const res = await fetch(u, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`Calendar fetch failed (${res.status})`);
    return ical.sync.parseICS(await res.text());
  }));
  cache = { at: Date.now(), data };
  return data;
}

/** Events touching [from, to] (inclusive, YYYY-MM-DD in the owner's timezone), recurring ones expanded. */
export async function getEvents(from: string, to: string): Promise<{ events: CalEvent[]; error?: string }> {
  if (!calendarConfigured()) return { events: [] };
  try {
    const cals = await load();
    const lo = new Date(addDays(from, -1) + "T00:00:00Z"), hi = new Date(addDays(to, 2) + "T00:00:00Z");
    const out: CalEvent[] = [];
    cals.forEach((cal, ci) => {
      for (const v of Object.values(cal)) {
        if (!v || (v as { type?: string }).type !== "VEVENT") continue;
        const ev = v as VEvent;
        if ((ev as { status?: string }).status === "CANCELLED") continue;
        for (const inst of ical.expandRecurringEvent(ev, { from: lo, to: hi, expandOngoing: true })) {
          const s = new Date(inst.start), e = new Date(inst.end || inst.start);
          const allDay = !!inst.isFullDay;
          // all-day dates are floating calendar dates: read them in UTC, not shifted by timezone
          const sd = allDay ? s.toISOString().slice(0, 10) : isoInTZ(s, TZ);
          const ed = allDay ? addDays(e.toISOString().slice(0, 10), -1) : isoInTZ(e, TZ);
          for (let d = sd; d <= ed && d <= to; d = addDays(d, 1)) {
            if (d < from) continue;
            const summary = inst.summary as unknown;
            out.push({
              id: `${ci}:${ev.uid}:${s.toISOString()}:${d}`, date: d, start: s.toISOString(), end: e.toISOString(),
              startTime: allDay || d !== sd ? null : timeInTZ(s), endTime: allDay || d !== ed ? null : timeInTZ(e),
              allDay: allDay || (d !== sd && d !== ed),
              title: (typeof summary === "string" ? summary : (summary as { val?: string })?.val) || "(busy)",
              location: typeof ev.location === "string" ? ev.location : "", calendar: ci,
            });
          }
        }
      }
    });
    out.sort((a, b) => a.date.localeCompare(b.date) || Number(b.allDay) - Number(a.allDay) || (a.startTime || "").localeCompare(b.startTime || ""));
    return { events: out };
  } catch (e) {
    return { events: [], error: e instanceof Error ? e.message : "Calendar unavailable" };
  }
}
