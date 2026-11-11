/**
 * The Mac worker's heartbeat, read on the site. The worker runs every worker.interval_seconds (an hour by default)
 * and reports that interval in its heartbeat; an agent older than 0.7.5 doesn't, and ran every minute.
 */
export type WorkerBeat = { at?: string; info?: { interval_s?: number } } | null | undefined;

/** Seconds between the worker's passes. */
export const workerEvery = (hb: WorkerBeat) => Math.max(30, Number(hb?.info?.interval_s) || 60);

/** Online while the last pass is at most two intervals old (plus 5 minutes' slack for a long pass). */
export const workerAlive = (at: string | null, everyS: number, now: number) =>
  !!at && now - +new Date(at) < (2 * everyS + 300) * 1000;

/** "every minute", "every 15 minutes", "every hour", "every 6 hours". */
export function everyLabel(s: number) {
  if (s >= 3600) { const h = Math.round(s / 3600); return h === 1 ? "every hour" : `every ${h} hours`; }
  if (s >= 60) { const m = Math.round(s / 60); return m === 1 ? "every minute" : `every ${m} minutes`; }
  return `every ${s} seconds`;
}
