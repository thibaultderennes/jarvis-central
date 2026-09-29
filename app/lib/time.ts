// Your timezone (IANA name, e.g. "Europe/Paris"). Set by `node scripts/setup.mjs secrets` from jarvis.config.json.
export const TZ = process.env.JARVIS_TZ || "UTC";

/** YYYY-MM-DD for an instant, in the owner's timezone. */
export function isoInTZ(d: Date = new Date(), tz = TZ): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return `${g("year")}-${g("month")}-${g("day")}`;
}
export const today = () => isoInTZ(new Date());

const P = (d: string) => new Date(d + "T12:00:00Z");
export function addDays(d: string, n: number): string {
  const x = P(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}
export function mondayOf(d: string): string {
  const x = P(d);
  return addDays(d, -((x.getUTCDay() + 6) % 7));
}
export function weekday(d: string): number {
  return (P(d).getUTCDay() + 6) % 7; // Mon = 0
}
export function daysBetween(a: string, b: string): number {
  return Math.round((P(b).getTime() - P(a).getTime()) / 864e5);
}
export function fmtDate(d: string, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }): string {
  return P(d).toLocaleDateString("en-CA", { timeZone: "UTC", ...opts });
}
export function timeInTZ(d: Date, tz = TZ): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
}
export const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

function tzOffsetMin(d: Date, tz: string): number {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(d);
  const g = (t: string) => +p.find((x) => x.type === t)!.value;
  return (Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - d.getTime()) / 60000;
}
/** A wall-clock date + time in the owner's timezone → the real instant (DST-safe). */
export function zonedToUtc(date: string, time: string, tz = TZ): Date {
  const [y, m, d] = date.split("-").map(Number), [hh, mm] = time.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  let t = wall;
  for (let i = 0; i < 2; i++) t = wall - tzOffsetMin(new Date(t), tz) * 60000;
  return new Date(t);
}
