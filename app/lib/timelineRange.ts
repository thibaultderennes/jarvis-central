// Shared by the server (lib/timeline.ts) and the client Timeline: no imports, so it never pulls server code into the browser.
/** How far ?w= may move the window, in weeks: half a year back, a year ahead; the arrows move it SHIFT_STEP at a time. */
export const SHIFT_MIN = -26, SHIFT_MAX = 52, SHIFT_STEP = 4;
export const parseShift = (w: unknown) => { const n = Math.round(Number(w)); return Number.isFinite(n) ? Math.min(SHIFT_MAX, Math.max(SHIFT_MIN, n)) : 0; };
