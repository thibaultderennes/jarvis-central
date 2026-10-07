// The Archipelago (Home's Map box): each project is an island, its next deadline a buoy offshore.
// Pure functions (no imports) so `npm test` can load them. All randomness is seeded from the project id, so a render
// on the server and the next one draw the same coast, the same houses in the same places.
//
// Honest by construction:
// - Land is what you finished in the last LAND_DAYS: an item done on or before its due date weighs 1, done late 0.5,
//   done with no due date 0.25. Radius grows with the square root (area tracks the weight), normalised to the biggest
//   island and clamped, so ticking off undated busywork barely grows land. Overdue work never shrinks it.
// - Buildings count every item ever done on time: one hut per HUT, five huts merge into a house, five houses into a
//   tower. Nothing is drawn that the database doesn't hold.

export type DoneLike = { status: string; due: string | null; done_on: string | null };
export type Tier = "hut" | "house" | "tower";
/** `earnedAt`: the on-time count at which this building was complete (the "since your last visit" check uses it). */
export type Building = { tier: Tier; earnedAt: number };
export type Pt = { x: number; y: number };
export type Weather = "storm" | "cloud" | "clear" | null;

export const LAND_DAYS = 180;
export const W_ON_TIME = 1, W_LATE = 0.5, W_UNDATED = 0.25;
/** On-time items per building tier. */
export const HUT = 5, HOUSE = 25, TOWER = 125;
export const MAX_BUILDINGS = 12, MAX_SITES = 5, MAX_FIRES = 3, MAX_STONES = 10;
export const R_MIN = 26, R_MAX = 56;
/** The shallow-water ring around the coast, as a multiple of the land radius. */
export const SHALLOW = 1.2;
/** How far the coast may wander from the radius (±). */
export const WOBBLE = 0.16;

const DAY = 86_400_000;
const ms = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
const shift = (d: string, n: number) => new Date(ms(d) + n * DAY).toISOString().slice(0, 10);
const r1 = (v: number) => Math.round(v * 10) / 10;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

/** FNV-1a: a stable 32-bit seed from a string (the project id). */
export function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** mulberry32: a small seeded generator returning numbers in [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One project's land: the weighted count of items finished in the last `days` (today included). */
export function areaWeight(items: DoneLike[], today: string, days = LAND_DAYS) {
  const from = shift(today, -days);
  let onTime = 0, late = 0, undated = 0;
  for (const i of items) {
    if (i.status !== "done" || !i.done_on || i.done_on <= from || i.done_on > today) continue;
    if (!i.due) undated++;
    else if (i.done_on <= i.due) onTime++;
    else late++;
  }
  return { weight: onTime * W_ON_TIME + late * W_LATE + undated * W_UNDATED, onTime, late, undated };
}

/** Island radius: ∝ √weight, the biggest island gets `rMax`, nothing below `rMin` (an empty island is still a place). */
export function islandRadius(weight: number, maxWeight: number, rMin = R_MIN, rMax = R_MAX): number {
  if (!(maxWeight > 0) || !(weight > 0)) return rMin;
  return r1(clamp(rMax * Math.sqrt(weight / maxWeight), rMin, rMax));
}

/** Items ever finished on or before their due date: what the buildings count. */
export function onTimeCount(items: DoneLike[]): number {
  return items.filter((i) => i.status === "done" && i.done_on && i.due && i.done_on <= i.due).length;
}

/** Buildings for `onTime` on-time items, tallest first. Over `max`, the oldest towers are left out and counted in `hidden`. */
export function buildingsFor(onTime: number, max = MAX_BUILDINGS): { buildings: Building[]; units: number; hidden: number } {
  const n = Math.max(0, Math.floor(onTime));
  const towers = Math.floor(n / TOWER), houses = Math.floor((n % TOWER) / HOUSE), huts = Math.floor((n % HOUSE) / HUT);
  const all: Building[] = [
    ...Array.from({ length: towers }, (_, k): Building => ({ tier: "tower", earnedAt: (k + 1) * TOWER })),
    ...Array.from({ length: houses }, (_, k): Building => ({ tier: "house", earnedAt: towers * TOWER + (k + 1) * HOUSE })),
    ...Array.from({ length: huts }, (_, k): Building => ({ tier: "hut", earnedAt: towers * TOWER + houses * HOUSE + (k + 1) * HUT })),
  ];
  const hidden = Math.max(0, all.length - max);
  return { buildings: all.slice(hidden), units: Math.floor(n / HUT), hidden };
}

/** Closed smooth curve (Catmull-Rom as cubic Béziers) through the points. */
export function closedCurve(pts: Pt[]): string {
  const n = pts.length;
  if (n < 3) return "";
  const p = (i: number) => pts[(i + n) % n];
  let d = `M${r1(p(0).x)} ${r1(p(0).y)}`;
  for (let i = 0; i < n; i++) {
    const a = p(i - 1), b = p(i), c = p(i + 1), e = p(i + 2);
    d += `C${r1(b.x + (c.x - a.x) / 6)} ${r1(b.y + (c.y - a.y) / 6)} ${r1(c.x - (e.x - b.x) / 6)} ${r1(c.y - (e.y - b.y) / 6)} ${r1(c.x)} ${r1(c.y)}`;
  }
  return d + "Z";
}

/** A seeded blob around (0, 0): the same seed gives the same coast at any radius (so the shallows follow the shore). */
export function islandShape(seed: number, r: number, points = 11): string {
  const rand = rng(seed);
  const pts = Array.from({ length: points }, (_, i) => {
    const a = (i / points) * Math.PI * 2, k = 1 + (rand() * 2 - 1) * WOBBLE;
    return { x: Math.cos(a) * r * k, y: Math.sin(a) * r * k };
  });
  return closedCurve(pts);
}

/** `n` building or site spots on the island's inner area (a seeded sunflower): first spot nearest the middle. */
export function islandSlots(seed: number, r: number, n: number): Pt[] {
  if (n <= 0) return [];
  const rot = rng(seed ^ 0x9e3779b9)() * Math.PI * 2, R = r * 0.58;
  return Array.from({ length: n }, (_, k) => {
    const d = n === 1 ? 0 : R * Math.sqrt((k + 0.5) / n), a = rot + k * GOLDEN;
    return { x: r1(Math.cos(a) * d), y: r1(Math.sin(a) * d) };
  });
}

/** Glyph size for `n` things on an island of radius `r`: smaller when crowded, never unreadable. */
export function glyphSize(r: number, n: number): number {
  const spacing = r * 0.58 * Math.sqrt(Math.PI / Math.max(1, n));
  return r1(clamp(spacing * 0.72, 6, 12));
}

/** Where the buoy sits: left or right of the island, level or a little up (labels sit below). */
export function buoyFor(seed: number, r: number): Pt & { angle: number } {
  const rand = rng(seed ^ 0x51ed270b);
  const right = rand() < 0.5, tilt = -0.7 + rand() * 1.0; // −0.7 (up) … +0.3 (down) radians
  const angle = right ? tilt : Math.PI - tilt, d = r * SHALLOW + 24;
  return { angle: r1(angle * 100) / 100, x: r1(Math.cos(angle) * d), y: r1(Math.sin(angle) * d) };
}

/** `n + 2` points on a gentle curve from `a` to `b` (both ends included): the stones of a sea route. */
export function routePoints(n: number, a: Pt, b: Pt, bend = 0.18): Pt[] {
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, dx = b.x - a.x, dy = b.y - a.y;
  const c = { x: mx - dy * bend, y: my + dx * bend };
  const m = n + 2;
  return Array.from({ length: m }, (_, i) => {
    const t = i / (m - 1), u = 1 - t;
    return { x: r1(u * u * a.x + 2 * u * t * c.x + t * t * b.x), y: r1(u * u * a.y + 2 * u * t * c.y + t * t * b.y) };
  });
}

/** At most `max` items, evenly sampled in order (a long trail keeps its shape when drawn short). */
export function sample<T>(xs: T[], max: number): T[] {
  if (xs.length <= max) return xs;
  if (max <= 1) return xs.slice(0, Math.max(0, max));
  return Array.from({ length: max }, (_, i) => xs[Math.round((i * (xs.length - 1)) / (max - 1))]);
}

/** Weather from the latest review verdict. */
export function weatherFor(verdict: string | null | undefined): Weather {
  if (verdict === "off-track") return "storm";
  if (verdict === "at-risk") return "cloud";
  if (verdict === "on-track") return "clear";
  return null;
}

/** Columns for `n` islands on a wide map. */
export function colsFor(n: number, max = 5): number {
  return clamp(Math.min(n, Math.ceil(Math.sqrt(n * 1.5))), 1, max);
}

export type Layout = { slots: Pt[]; width: number; height: number };

/**
 * Packed slots on a staggered grid: rows alternate `cols` and `cols − 1` cells (hex packing), the last row centred,
 * a seeded jitter of ±`jitter` × cell size. The first `central` islands (the top 3) take the cells nearest the middle;
 * the rest fill the others in reading order. No simulation: the same input always gives the same map.
 */
export function layoutIslands(n: number, o: { cols: number; cellW: number; cellH: number; seed?: number; jitter?: number; central?: number }): Layout {
  const cols = Math.max(1, Math.floor(o.cols)), jitter = o.jitter ?? 0.04, central = Math.min(n, o.central ?? 3);
  if (n <= 0) return { slots: [], width: cols * o.cellW, height: 0 };
  const cells: Pt[] = [];
  for (let row = 0; cells.length < n; row++) {
    const full = cols === 1 || row % 2 === 0 ? cols : cols - 1;
    const k = Math.min(full, n - cells.length), x0 = ((cols - k) * o.cellW) / 2;
    for (let c = 0; c < k; c++) cells.push({ x: x0 + (c + 0.5) * o.cellW, y: (row + 0.5) * o.cellH });
  }
  const rows = Math.round(cells[cells.length - 1].y / o.cellH + 0.5);
  const cx = cells.reduce((s, p) => s + p.x, 0) / n, cy = cells.reduce((s, p) => s + p.y, 0) / n;
  const byCentre = cells.map((p, i) => ({ i, d: Math.hypot(p.x - cx, (p.y - cy) * 1.2) })).sort((a, b) => a.d - b.d || a.i - b.i).map((x) => x.i);
  const middle = byCentre.slice(0, central).sort((a, b) => a - b);
  const taken = new Set(middle);
  const order = [...middle, ...cells.map((_, i) => i).filter((i) => !taken.has(i))];
  const rand = rng(o.seed ?? 1);
  const slots = order.map((ci) => {
    const p = cells[ci];
    return { x: r1(p.x + (rand() * 2 - 1) * jitter * o.cellW), y: r1(p.y + (rand() * 2 - 1) * jitter * o.cellH) };
  });
  return { slots, width: cols * o.cellW, height: rows * o.cellH };
}

/** Pairs of islands (indexes) whose next deadlines fall on the same day: chained in order, one route per neighbour. */
export function sharedRoutes(dates: (string | null | undefined)[]): [number, number][] {
  const by = new Map<string, number[]>();
  dates.forEach((d, i) => { if (d) by.set(d, [...(by.get(d) || []), i]); });
  const out: [number, number][] = [];
  for (const ids of by.values()) for (let k = 1; k < ids.length; k++) out.push([ids[k - 1], ids[k]]);
  return out;
}

/** Seeded wave marks across the sea, kept clear of every island (`avoid`: centre and radius). */
export function wavesFor(seed: number, width: number, height: number, avoid: (Pt & { r: number })[], count: number): Pt[] {
  const rand = rng(seed ^ 0x2545f491), out: Pt[] = [];
  for (let tries = 0; out.length < count && tries < count * 20; tries++) {
    const p = { x: r1(12 + rand() * (width - 36)), y: r1(8 + rand() * (height - 16)) };
    if (avoid.some((a) => Math.hypot(p.x - a.x, p.y - a.y) < a.r)) continue;
    if (out.some((q) => Math.hypot(p.x - q.x, p.y - q.y) < 36)) continue;
    out.push(p);
  }
  return out;
}

/** Huts newly earned since `seen` on-time items (what the "since your last visit" chip counts). */
export function newSince(onTimeNow: number, seen: number | null | undefined): number {
  if (seen == null || !Number.isFinite(seen)) return 0;
  return Math.max(0, Math.floor(onTimeNow / HUT) - Math.floor(Math.max(0, seen) / HUT));
}

/**
 * The sea route to the buoy: `n + 2` points (shore, n stones, buoy) that leave the island from its top and swing out
 * round the coast to the buoy, so a long trail still gets room. Steps sit on the stones in due-date order.
 */
export function seaRoute(n: number, r: number, buoy: Pt & { angle: number }): Pt[] {
  const right = Math.cos(buoy.angle) >= 0, sweep = 1.5;
  const a0 = buoy.angle + (right ? -sweep : sweep), rho0 = r * 0.92, rho1 = Math.hypot(buoy.x, buoy.y), m = n + 2;
  return Array.from({ length: m }, (_, i) => {
    const t = i / (m - 1), a = a0 + (buoy.angle - a0) * t, rho = rho0 + (rho1 - rho0) * Math.sqrt(t);
    return { x: r1(Math.cos(a) * rho), y: r1(Math.sin(a) * rho) };
  });
}
