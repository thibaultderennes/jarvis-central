// Helpers that keep the Monday run (weekly.mjs) going when a step is slow or dies. No imports, so the site's tests
// load it too (app/test/weeklyrun.test.mjs).

/** The cross-project reports, in the order the Monday run writes them (the Jarvis review first). */
export const REPORTS = ["jarvis", "recap", "coaching"];
export const REPORT_NAMES = { jarvis: "Jarvis review", recap: "week recap", coaching: "working-with-AI report" };

/**
 * A shorter copy of a markdown bundle, for one retry after a timeout: each section keeps its heading and first
 * `perSection` lines, long lines are cut to `lineChars`, and the whole is capped at `maxChars`. Code fences stay balanced.
 */
export function shortenBundle(md, { perSection = 25, lineChars = 300, maxChars = 60_000 } = {}) {
  const out = [];
  let kept = 0, cut = 0, fence = false;
  const flush = () => { if (cut) out.push(`- … ${cut} more line${cut === 1 ? "" : "s"} cut (shorter bundle for a retry)`); cut = 0; };
  for (const line of String(md || "").split("\n")) {
    if (line.startsWith("```")) {
      fence = !fence;
      if (fence) { flush(); kept = 0; }
      out.push(line);
      continue;
    }
    if (!fence && /^#{1,4} /.test(line)) { flush(); kept = 0; out.push(line); continue; }
    if (kept >= perSection) { cut++; continue; }
    kept++;
    out.push(line.length > lineChars ? line.slice(0, lineChars) + "…" : line);
  }
  flush();
  const s = out.join("\n");
  return s.length > maxChars ? s.slice(0, maxChars) + "\n\n[…the rest was cut for the retry]" : s;
}

/** The project whose folder is the Jarvis repo goes first, so its review is not the one a long run loses. */
export function jarvisFirst(projects, isJarvis) {
  return [...projects].sort((a, b) => Number(isJarvis(b)) - Number(isJarvis(a)));
}

/** The arguments `weekly.mjs` gets for a "Run again" on a failed report (a mode 'review' message with meta.kind 'rerun'). */
export function rerunArgs(meta, projectId) {
  const week = meta?.week;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week || "")) return null;
  if (REPORTS.includes(meta.report)) return ["--report", meta.report, "--week", week];
  return projectId ? ["--only", projectId, "--week", week] : null;
}

/** The body of a 'failed' report: what died, and how to get it back. */
export function failedBody(why) {
  const first = String(why || "unknown error").split("\n")[0].slice(0, 600);
  return `## The run didn't finish\n${first}\n\nPress **Run again** to write this report on its own. If it fails again, the weekly log on your Mac has the details (\`~/Library/Logs/jarvis/weekly.log\`).`;
}

/** True when claude's output says the headless login is gone (expired OAuth, logged out, bad key), not a model answer. */
export function isAuthError(text) {
  return /failed to authenticate|oauth (session|token)[^\n]*(expired|invalid|revoked)|not logged in|please run \/login|invalid api key|authentication_error|credit balance is too low/i.test(String(text || ""));
}

/** The first non-empty line of a model's output, cut to `n` characters: what an error shows instead of "no JSON object". */
export function firstLine(text, n = 200) {
  const l = String(text || "").split("\n").map((s) => s.trim()).find(Boolean) || "";
  return l.length > n ? l.slice(0, n) + "…" : l;
}

const ymdShift = (ymd, n) => { const [y, m, d] = ymd.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const mondayOfYmd = (ymd) => { const [y, m, d] = ymd.split("-").map(Number); return ymdShift(ymd, -((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7)); };

/**
 * The scheduled Monday-run date whose run never got going, or null. `today` and `nowMinutes` (minutes since local
 * midnight) are in the Jarvis timezone; `sched` is schedule().weekly ({day 0=Sun, hour, minute}); `lastRun` is the
 * local date of the last run that passed its checks. Only within the same week as the slot: a run on a later week
 * would review a different period.
 */
export function missedWeeklyRun({ today, nowMinutes, sched, lastRun }) {
  const [y, m, d] = today.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  let back = (wd - sched.day + 7) % 7;
  if (back === 0 && nowMinutes < sched.hour * 60 + sched.minute) back = 7;
  const slot = ymdShift(today, -back);
  if (mondayOfYmd(slot) !== mondayOfYmd(today)) return null;
  if (back === 0 && nowMinutes < sched.hour * 60 + sched.minute + 30) return null; // give the scheduled run its half hour
  return lastRun && lastRun >= slot ? null : slot;
}
