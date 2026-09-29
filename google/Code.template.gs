/**
 * Jarvis → Google Calendar.
 * Writes the week plan Jarvis makes on Sunday into its own calendar, "Jarvis · work plan".
 * Runs every hour, but only changes the calendar on Sundays (for the week ahead), or once
 * on a weekday if that week was never written. Your other calendars are never touched.
 *
 * Setup: paste this whole file into a new project at https://script.google.com, press Run on `install`,
 * and allow access to your calendar when Google asks.
 */
const JARVIS_URL = "__JARVIS_URL__";
const TOKEN = "__JARVIS_CAL_TOKEN__"; // read-only: it can fetch the plan, nothing else
const TIMEZONE = "__JARVIS_TZ__";
const CAL_NAME = "Jarvis · work plan";
// Project colour slots (p1…p7, see docs/conventions.md) → nearest Google Calendar event colour.
const COLORS = {
  p1: CalendarApp.EventColor.BLUE, p2: CalendarApp.EventColor.ORANGE, p3: CalendarApp.EventColor.CYAN,
  p4: CalendarApp.EventColor.YELLOW, p5: CalendarApp.EventColor.GREEN, p6: CalendarApp.EventColor.MAUVE,
  p7: CalendarApp.EventColor.RED, other: CalendarApp.EventColor.GRAY,
};

function install() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("syncJarvis").timeBased().everyHours(1).create();
  syncJarvis();
}

function syncJarvis() {
  const res = UrlFetchApp.fetch(JARVIS_URL + "/api/cal/plan", { headers: { Authorization: "Bearer " + TOKEN }, muteHttpExceptions: true });
  if (res.getResponseCode() === 404) { console.log("No plan for this week yet."); return; }
  if (res.getResponseCode() !== 200) throw new Error("Jarvis answered " + res.getResponseCode() + ": " + res.getContentText().slice(0, 200));
  const plan = JSON.parse(res.getContentText());
  const props = PropertiesService.getScriptProperties();
  const key = "synced:" + plan.week_start, done = props.getProperty(key);
  if (done === String(plan.version)) return;               // already written
  if (done && !plan.is_sunday) return;                     // during the week the calendar stays as planned on Sunday

  const cal = calendar();
  cal.getEvents(new Date(plan.range_start), new Date(plan.range_end)).forEach(function (e) {
    if (e.getTag("jarvis")) e.deleteEvent();
  });
  plan.events.forEach(function (ev) {
    const e = cal.createEvent(ev.title, new Date(ev.start), new Date(ev.end), { description: ev.description });
    e.setTag("jarvis", ev.uid);
    if (COLORS[ev.color]) e.setColor(COLORS[ev.color]);
  });
  props.setProperty(key, String(plan.version));
  UrlFetchApp.fetch(JARVIS_URL + "/api/cal/synced", {
    method: "post", contentType: "application/json", muteHttpExceptions: true, headers: { Authorization: "Bearer " + TOKEN },
    payload: JSON.stringify({ week_start: plan.week_start, version: plan.version, count: plan.events.length }),
  });
  console.log("Wrote " + plan.events.length + " blocks for the week of " + plan.week_start);
}

function calendar() {
  const found = CalendarApp.getCalendarsByName(CAL_NAME);
  if (found.length) return found[0];
  const c = CalendarApp.createCalendar(CAL_NAME, { timeZone: TIMEZONE });
  c.setColor(CalendarApp.Color.ORANGE);
  return c;
}
