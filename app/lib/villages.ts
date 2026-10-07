// The Villages (Home's Map box): one village per project in a shared pixel world, its next deadline a signpost at the
// end of a dirt road. Pure functions (no imports) so `npm test` can load them. All randomness is seeded from the project
// id, so the server and the next render draw the same world, the same buildings in the same places.
//
// Honest by construction:
// - Cleared ground is what you finished in the last LAND_DAYS: an item done on or before its due date weighs 1, done
//   late 0.5, done with no due date 0.25. The fenced plot's area follows that weight, scaled to your biggest village,
//   so ticking off undated busywork barely clears land. Overdue work never shrinks it.
// - Every building stands for one part of the project and is drawn from what the database holds: the town hall from
//   items done on time, the police station from security audits and screenings, the bank from costs and revenue, the
//   shop from product metrics, the houses from users, the workshop from Claude's builds. Missing data is an empty lot
//   with a sign, never a ruin.

export type DoneLike = { status: string; due: string | null; done_on: string | null };
export type Weather = "storm" | "cloud" | "clear" | null;
export type Pt = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };
/** A tile on the world grid: `t` is the sheet ("tt" Tiny Town, "tb" Tiny Battle, "td" Tiny Dungeon) and the index. */
export type Tile = { x: number; y: number; t: string };

export const LAND_DAYS = 180;
export const W_ON_TIME = 1, W_LATE = 0.5, W_UNDATED = 0.25;
/** On-time items for each town hall tier. */
export const HALL = 25, TOWN_HALL = 125;
export const MAX_SITES = 5, MAX_FIRES = 3, MAX_LAMPS = 3, MAX_STONES = 10, MAX_HOUSES = 6, MAX_COINS = 4;
/** Product metrics compare the latest snapshot with the earliest one in this many days. */
export const TREND_DAYS = 28;

const DAY = 86_400_000;
const ms = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
const shift = (d: string, n: number) => new Date(ms(d) + n * DAY).toISOString().slice(0, 10);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const r2 = (v: number) => Math.round(v * 100) / 100;

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

/** One project's cleared ground: the weighted count of items finished in the last `days` (today included). */
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

/** Items ever finished on or before their due date: what the town hall counts. */
export function onTimeCount(items: DoneLike[]): number {
  return items.filter((i) => i.status === "done" && i.done_on && i.due && i.done_on <= i.due).length;
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

/** Items done on time since the last visit (`seen`): what the "since your last visit" chip counts. */
export function newSince(onTimeNow: number, seen: number | null | undefined): number {
  if (seen == null || !Number.isFinite(seen)) return 0;
  return Math.max(0, Math.floor(onTimeNow) - Math.floor(Math.max(0, seen)));
}

// ---- What each building stands for. Every state function takes rows and returns what to draw. ----

export type HallTier = "small" | "hall" | "town";
/** The town hall's tier from items ever done on time: a small hall, a hall at HALL, a town hall with a clock at TOWN_HALL. */
export function hallTier(onTime: number): { tier: HallTier; since: number; next: number | null } {
  const n = Math.max(0, Math.floor(onTime));
  if (n >= TOWN_HALL) return { tier: "town", since: TOWN_HALL, next: null };
  if (n >= HALL) return { tier: "hall", since: HALL, next: TOWN_HALL };
  return { tier: "small", since: 0, next: HALL };
}

export type Level = "calm" | "amber" | "red";
export type CheckRow = { type: string; title: string; verdict: string | null; created_at: string; meta?: Record<string, unknown> | null };
export type Check = { type: "security" | "screening"; title: string; verdict: string | null; date: string; critical: number; fail: number; high: number; level: Level };
export type PoliceState = { built: false } | { built: true; level: Level; checks: Check[] };

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const checkDate = (r: CheckRow) => String(r.meta?.date || r.created_at || "").slice(0, 10);

/**
 * The police station: the latest security audit and the latest run of each screening kind, worst one wins.
 * Red: an off-track verdict or a critical finding. Amber: at risk, or findings to fix. Calm otherwise.
 */
export function policeState(rows: CheckRow[]): PoliceState {
  const latest = new Map<string, CheckRow>();
  for (const r of rows) {
    if (r.type !== "security" && r.type !== "screening") continue;
    const key = r.type === "security" ? "security" : `screening:${String(r.meta?.kind || "")}`;
    const cur = latest.get(key);
    if (!cur || `${checkDate(r)}|${r.created_at}` > `${checkDate(cur)}|${cur.created_at}`) latest.set(key, r);
  }
  if (!latest.size) return { built: false };
  const checks = [...latest.values()].map((r): Check => {
    const c = (r.meta?.counts || {}) as Record<string, unknown>;
    const critical = num(c.critical), fail = num(c.fail), high = num(c.high);
    const level: Level = r.verdict === "off-track" || critical > 0 ? "red" : r.verdict === "at-risk" || fail > 0 || high > 0 ? "amber" : "calm";
    return { type: r.type as Check["type"], title: r.title, verdict: r.verdict, date: checkDate(r), critical, fail, high, level };
  }).sort((a, b) => b.date.localeCompare(a.date));
  const level: Level = checks.some((c) => c.level === "red") ? "red" : checks.some((c) => c.level === "amber") ? "amber" : "calm";
  return { built: true, level, checks };
}

export type Snap = { date: string; metrics: Record<string, number> };
export type CostRow = { amount: number; currency: string; period: string; active?: boolean };
export type BankState =
  | { built: false }
  | { built: true; costs: { currency: string; monthly: number }[]; revenue: number | null; revenueFrom: "mrr" | "revenue" | null; coins: number; costSign: boolean };

const monthlyOf = (c: CostRow) => (c.period === "week" ? (c.amount * 52) / 12 : c.period === "year" ? c.amount / 12 : c.amount);
/** The newest value of `key` in the snapshots (oldest first or not), or null. */
export function latestMetric(snaps: Snap[], key: string): { value: number; date: string } | null {
  let best: { value: number; date: string } | null = null;
  for (const s of snaps) {
    const v = s.metrics?.[key];
    if (typeof v === "number" && Number.isFinite(v) && (!best || s.date > best.date)) best = { value: v, date: s.date };
  }
  return best;
}

/** Coins for a monthly revenue, on a log scale: 1 from 1, 2 from 100, 3 from 1,000, 4 from 10,000. */
export function coinsFor(monthly: number | null): number {
  if (!monthly || !(monthly >= 1)) return 0;
  return monthly < 100 ? 1 : clamp(Math.floor(Math.log10(monthly) + 1e-9), 2, MAX_COINS);
}

/**
 * The bank: active recurring costs (monthly, per currency) and revenue from the metrics (MRR, or the last 7 days of
 * revenue times 52/12). A red cost sign when there are costs and revenue is missing, zero or below them (compared only
 * when the costs are in one currency). Neither costs nor revenue: an empty lot.
 */
export function bankState(costs: CostRow[], snaps: Snap[]): BankState {
  const by = new Map<string, number>();
  for (const c of costs) if (c.active !== false && c.amount > 0) by.set(c.currency || "USD", (by.get(c.currency || "USD") || 0) + monthlyOf(c));
  const list = [...by.entries()].map(([currency, monthly]) => ({ currency, monthly: r2(monthly) })).sort((a, b) => b.monthly - a.monthly);
  const mrr = latestMetric(snaps, "mrr"), rev = latestMetric(snaps, "revenue");
  const revenue = mrr ? r2(mrr.value) : rev ? r2((rev.value * 52) / 12) : null;
  if (!list.length && revenue === null) return { built: false };
  const costSign = list.length > 0 && (!revenue || revenue <= 0 || (list.length === 1 && revenue < list[0].monthly));
  return { built: true, costs: list, revenue, revenueFrom: mrr ? "mrr" : rev ? "revenue" : null, coins: coinsFor(revenue), costSign };
}

export type Trend = "up" | "flat" | "down";
export type ShopState = { built: false } | { built: true; metric: string; first: { value: number; date: string }; last: { value: number; date: string }; trend: Trend };
export const SHOP_METRICS = ["visits", "signups", "active_users"] as const;

/**
 * The shop (growth): the first of visits, signups, active users with two snapshots at least 7 days apart in the last
 * TREND_DAYS. Up more than 5%: busy. Down more than 5%: closed sign. Otherwise (or one snapshot only): quiet.
 */
export function shopState(snaps: Snap[], today: string, days = TREND_DAYS): ShopState {
  const from = shift(today, -days);
  const recent = snaps.filter((s) => s.date > from && s.date <= today).sort((a, b) => a.date.localeCompare(b.date));
  let fallback: ShopState = { built: false };
  for (const metric of SHOP_METRICS) {
    const pts = recent.filter((s) => typeof s.metrics?.[metric] === "number" && Number.isFinite(s.metrics[metric])).map((s) => ({ value: s.metrics[metric], date: s.date }));
    if (!pts.length) continue;
    const first = pts[0], last = pts[pts.length - 1];
    const apart = (ms(last.date) - ms(first.date)) / DAY >= 7;
    const trend: Trend = !apart ? "flat" : last.value > first.value * 1.05 ? "up" : last.value < first.value * 0.95 ? "down" : "flat";
    if (apart) return { built: true, metric, first, last, trend };
    if (!fallback.built) fallback = { built: true, metric, first, last, trend };
  }
  return fallback;
}

export type HomesState = { built: false } | { built: true; metric: "paying_users" | "users"; count: number; houses: number };
/** Houses for a user count, on a log scale: 1 from 1, 2 from 10, 3 from 100 … up to MAX_HOUSES. */
export function housesFor(count: number): number {
  if (!(count >= 1)) return 0;
  return clamp(1 + Math.floor(Math.log10(count) + 1e-9), 1, MAX_HOUSES);
}
/** The houses (customers): paying users when recorded, else users, from the newest snapshot holding one. */
export function homesState(snaps: Snap[]): HomesState {
  const paying = latestMetric(snaps, "paying_users"), users = latestMetric(snaps, "users");
  const pick = paying ? { metric: "paying_users" as const, v: paying } : users ? { metric: "users" as const, v: users } : null;
  if (!pick) return { built: false };
  return { built: true, metric: pick.metric, count: pick.v.value, houses: housesFor(pick.v.value) };
}

export type BuildRow = { id: string; title: string; status: string; build_status: string | null; build_note?: string | null; pr_url?: string | null };
export type WorkshopState =
  | { built: false }
  | { built: true; running: number; waiting: number; failed: { id: string; title: string; note: string }[]; prUrl: string | null };
/**
 * The workshop (Claude's builds): items being built, pull requests waiting for you (open or merge requested) and builds
 * that stopped on an open item. No code repository detected and no build ever: an empty lot (no builds possible yet).
 */
export function workshopState(items: BuildRow[], hasRepo: boolean): WorkshopState {
  const live = items.filter((i) => i.status !== "cancelled");
  if (!hasRepo && !live.some((i) => i.build_status)) return { built: false };
  const running = live.filter((i) => i.build_status === "working").length;
  const prs = live.filter((i) => i.build_status === "pr_open" || i.build_status === "merge_requested");
  const failed = live.filter((i) => i.build_status === "failed" && (i.status === "todo" || i.status === "doing"))
    .map((i) => ({ id: i.id, title: i.title, note: String(i.build_note || "").trim() }));
  return { built: true, running, waiting: prs.length, failed, prUrl: prs.length === 1 ? prs[0].pr_url || null : null };
}

// ---- The world: a tile grid. Each village sits in its own cell (no two cells overlap), forest fills the rest. ----

/** The core every village is built on, in tiles (police, hall, bank / shop, square, workshop / houses, road, houses). */
export const CORE_W = 8, CORE_H = 7;
/** One village's cell: a road row on top, the label row, the plot (fence included) and the deadline road below. */
export const CELL_W = 15, CELL_H = 15;
/** Plot sizes (fence included) by how much ground is cleared beyond the core, smallest first. */
export const PLOTS: { ex: number; ey: number; w: number; h: number }[] = [[0, 0], [1, 0], [0, 1], [1, 1]]
  .map(([ex, ey]) => ({ ex, ey, w: CORE_W + 2 + 2 * ex, h: CORE_H + 2 + 2 * ey }))
  .sort((a, b) => a.w * a.h - b.w * b.h);

/** The fenced plot for `weight`: its area tracks the weight (scaled to the heaviest village), nearest available size. */
export function plotFor(weight: number, maxWeight: number) {
  const lo = PLOTS[0].w * PLOTS[0].h, hi = PLOTS[PLOTS.length - 1].w * PLOTS[PLOTS.length - 1].h;
  const f = maxWeight > 0 && weight > 0 ? clamp(weight / maxWeight, 0, 1) : 0;
  const target = lo + (hi - lo) * f;
  return PLOTS.reduce((best, p) => (Math.abs(p.w * p.h - target) < Math.abs(best.w * best.h - target) ? p : best), PLOTS[0]);
}

/** Columns of villages on a wide map. */
export function colsFor(n: number): number {
  return n <= 2 ? Math.max(1, n) : n <= 4 ? 2 : 3;
}

/**
 * Cell origins (in cells) for `n` villages on a grid of `cols`, the last row centred (in half cells). The first
 * `central` villages (the top 3) take the cells nearest the middle; the rest fill the others in reading order.
 */
export function cellOrder(n: number, cols: number, central = 3): Pt[] {
  const cells: Pt[] = [];
  for (let row = 0; cells.length < n; row++) {
    // A short last row spreads over whole cells (never straddling the river gap): 2 of 3 take the outer ones.
    const k = Math.min(cols, n - cells.length);
    for (let c = 0; c < k; c++) cells.push({ x: k === cols ? c : Math.round(((c + 0.5) * cols) / k - 0.5), y: row });
  }
  if (!n) return [];
  const cx = cells.reduce((s, p) => s + p.x, 0) / n, cy = cells.reduce((s, p) => s + p.y, 0) / n;
  const near = cells.map((p, i) => ({ i, d: Math.hypot(p.x - cx, (p.y - cy) * 1.1) })).sort((a, b) => a.d - b.d || a.i - b.i).map((x) => x.i);
  const middle = near.slice(0, Math.min(n, central)).sort((a, b) => a - b), taken = new Set(middle);
  return [...middle, ...cells.map((_, i) => i).filter((i) => !taken.has(i))].map((i) => cells[i]);
}

export type VillageInput = { id: string; weight: number; tier: HallTier; houses: number; built: { police: boolean; bank: boolean; shop: boolean; workshop: boolean }; deadline: boolean };
export type PartKey = "hall" | "police" | "bank" | "shop" | "workshop" | "homes";
export type Part = { key: PartKey; rect: Rect; tiles: Tile[]; built: boolean; slots?: Rect[] };
export type VillagePlan = {
  id: string; cell: Rect; plot: Rect; ring: Rect; core: Pt; size: { ex: number; ey: number };
  parts: Part[]; ground: Tile[];
  /** Square tiles for open-item sites (MAX_SITES) and lamp posts (MAX_LAMPS), in order. */
  sites: Pt[]; lamps: Pt[];
  /** The deadline road, as tile centres from the gate to the signpost (empty without a deadline). */
  road: Pt[]; sign: Pt | null; right: boolean;
  /** Where the label board hangs (centre of its baseline, in tiles). */
  label: Pt;
};

const T = (x: number, y: number, t: string): Tile => ({ x, y, t });
/** The tile rows of each building, top row first. */
export const SHAPES = {
  hall: {
    small: [["tt48", "tt63", "tt50"], ["tt88", "tt89", "tt91"]],
    hall: [["tt48", "tt51", "tt50"], ["tt60", "tt63", "tt62"], ["tt88", "tt89", "tt91"]],
    town: [["tt48", "tt51", "tt49", "tt50"], ["tt60", "tt61", "tt63", "tt62"], ["tt88", "tt89", "tt90", "tt91"]],
  },
  police: [["tt48", "tt50"], ["tt88", "tt89"]],
  bank: [["tt52", "tt54"], ["tt103", "tt79"]],
  shop: [["tt52", "tt54"], ["tt84", "tt85"]],
  workshop: { busy: [["tt52", "tt55"], ["tt73", "tt74"]], quiet: [["tt52", "tt55"], ["tt73", "tt86"]] },
  house: [["tt67"], ["tt86"]],
  lot: [["tt12", "tt14"], ["tt36", "tt38"]],
  lotTall: [["tt39"], ["tt42"]],
} as const;

function shape(rows: readonly (readonly string[])[], x: number, y: number): Tile[] {
  return rows.flatMap((r, j) => r.map((t, i) => T(x + i, y + j, t)));
}

/** One village laid out in its cell (`cx`, `cy` in tiles). Everything is seeded by the project id. */
export function planVillage(v: VillageInput, cx: number, cy: number, maxWeight: number, opts: { busy?: boolean } = {}): VillagePlan {
  const seed = hash(v.id), rand = rng(seed);
  const size = plotFor(v.weight, maxWeight);
  const px = cx + Math.floor((CELL_W - size.w) / 2) + (size.w < CELL_W - 3 && rand() < 0.5 ? 1 : 0) * (rand() < 0.5 ? -1 : 1);
  const py = cy + 2 + Math.floor((11 - size.h) / 2);
  const plot = { x: px, y: py, w: size.w, h: size.h };
  const core = { x: px + 1 + size.ex, y: py + 1 + size.ey };
  const ground: Tile[] = [];
  const parts: Part[] = [];
  const at = (x: number, y: number) => ({ x: core.x + x, y: core.y + y });

  // The town hall: centred at the top of the core; a 3-wide hall leans left or right by seed.
  const hallRows = SHAPES.hall[v.tier];
  const hw = hallRows[0].length, hh = hallRows.length;
  const hx = hw === 4 ? 2 : seed % 2 ? 2 : 3, hy = 3 - hh;
  parts.push({ key: "hall", rect: { ...at(hx, hy), w: hw, h: hh }, tiles: shape(hallRows, at(hx, hy).x, at(hx, hy).y), built: true });
  const two = (key: PartKey, x: number, y: number, rows: readonly (readonly string[])[], built: boolean) => {
    const p = at(x, y);
    parts.push({ key, rect: { ...p, w: 2, h: 2 }, tiles: shape(built ? rows : SHAPES.lot, p.x, p.y), built });
  };
  two("police", 0, 1, SHAPES.police, v.built.police);
  two("bank", 6, 1, SHAPES.bank, v.built.bank);
  two("shop", 0, 3, SHAPES.shop, v.built.shop);
  two("workshop", 6, 3, opts.busy ? SHAPES.workshop.busy : SHAPES.workshop.quiet, v.built.workshop);

  // Houses: one-wide cottages along the street, nearest the road first; no user count yet = two lots for sale.
  const order = [2, 5, 1, 6, 0, 7];
  const n = v.houses > 0 ? Math.min(MAX_HOUSES, v.houses) : 0;
  const slots = (n ? order.slice(0, n) : [2, 5]).map((x) => ({ ...at(x, 5), w: 1, h: 2 }));
  const homeTiles = slots.flatMap((s) => shape(n ? SHAPES.house : SHAPES.lotTall, s.x, s.y));
  const xs = slots.map((s) => s.x), x0 = Math.min(...xs), x1 = Math.max(...xs);
  parts.push({ key: "homes", rect: { x: x0, y: at(0, 5).y, w: x1 - x0 + 1, h: 2 }, tiles: homeTiles, built: n > 0, slots });

  // The square, the street and the gates.
  for (let x = 2; x <= 5; x++) for (let y = 3; y <= 4; y++) ground.push(T(at(x, y).x, at(x, y).y, "tt43"));
  const right = rand() < 0.5;
  const gx = right ? at(4, 0).x : at(3, 0).x;
  for (let y = core.y + 5; y < py + size.h - 1; y++) { ground.push(T(at(3, 0).x, y, "tt40")); ground.push(T(at(4, 0).x, y, "tt40")); }
  for (let y = py + 1; y <= core.y; y++) ground.push(T(px + 1, y, "tt40"));

  // The fence, with a two-wide gate at the bottom (the street) and a one-wide gate at the top left (the high road).
  const gate = new Set([`${at(3, 0).x},${py + size.h - 1}`, `${at(4, 0).x},${py + size.h - 1}`, `${px + 1},${py}`]);
  for (let x = px; x < px + size.w; x++) for (const y of [py, py + size.h - 1]) {
    if (gate.has(`${x},${y}`)) { ground.push(T(x, y, "tt40")); continue; }
    const top = y === py, l = x === px, r = x === px + size.w - 1;
    ground.push(T(x, y, top ? (l ? "tt44" : r ? "tt46" : "tt45") : l ? "tt68" : r ? "tt70" : "tt69"));
  }
  for (let y = py + 1; y < py + size.h - 1; y++) { ground.push(T(px, y, "tt56")); ground.push(T(px + size.w - 1, y, "tt58")); }

  // The square: open-item sites at its corners first, lamp posts between.
  const sites = [at(2, 4), at(5, 4), at(2, 3), at(5, 3), at(4, 4)];
  const lamps = [at(3, 3), at(4, 3), at(3, 4)];

  // Spare cleared ground (a bigger plot): a well, flowers, a tree or two; never on a path.
  const used = new Set([...parts.flatMap((p) => p.tiles), ...ground].map((t) => `${t.x},${t.y}`));
  const spare: Pt[] = [];
  for (let y = py + 1; y < py + size.h - 1; y++) for (let x = px + 1; x < px + size.w - 1; x++) {
    const inCore = x >= core.x && x < core.x + CORE_W && y >= core.y && y < core.y + CORE_H;
    if (!inCore && !used.has(`${x},${y}`)) spare.push({ x, y });
  }
  const decor = ["tt104", "tt16", "tt2", "tt28", "tt1", "tt2", "tt107", "tt1", "tt29", "tt2"];
  let k = 0;
  for (const p of spare) { if (rand() < 0.42) ground.push(T(p.x, p.y, decor[k++ % decor.length])); }
  // Inside the core, the two empty corners by the hall take a flower or a bush.
  for (const [x, y] of [[0, 0], [7, 0], [1, 0], [6, 0]]) {
    const p = at(x, y);
    if (!used.has(`${p.x},${p.y}`)) ground.push(T(p.x, p.y, (x + seed) % 3 ? "tt2" : "tt5"));
  }

  // The deadline road: out of the bottom gate, down to the road row, then along it to the signpost past the corner.
  const road: Pt[] = [];
  let sign: Pt | null = null;
  if (v.deadline) {
    const yRoad = py + size.h + 1, end = right ? px + size.w : px - 1;
    road.push({ x: gx, y: py + size.h }, { x: gx, y: yRoad });
    for (let x = gx; right ? x <= end : x >= end; x += right ? 1 : -1) if (x !== gx) road.push({ x, y: yRoad });
    sign = { x: end, y: yRoad };
  }
  return {
    id: v.id, cell: { x: cx, y: cy, w: CELL_W, h: CELL_H }, plot, ring: { x: px - 1, y: py - 1, w: size.w + 2, h: size.h + 2 },
    core, size: { ex: size.ex, ey: size.ey }, parts, ground, sites, lamps, road, sign, right,
    label: { x: px + size.w / 2, y: py },
  };
}

export type World = { w: number; h: number; villages: VillagePlan[]; tiles: Tile[]; forest: Rect[]; roads: Pt[]; river: Pt[]; bridges: Pt[] };

/** Forest tile for a cell from which of its four neighbours are forest too (3 × 3 cluster pieces, a lone tree otherwise). */
export function forestTile(n: boolean, s: boolean, w: boolean, e: boolean): string {
  if ((!n && !s) || (!w && !e)) return "tt28";
  if (!n) return !w ? "tt6" : !e ? "tt8" : "tt7";
  if (!s) return !w ? "tt30" : !e ? "tt32" : "tt31";
  if (!w) return "tt18";
  if (!e) return "tt20";
  return "tt19";
}

/** Water tile for a river cell from its four neighbours (Tiny Battle's lake pieces). */
export function waterTile(n: boolean, s: boolean, w: boolean, e: boolean): string {
  const row = !n ? 0 : !s ? 2 : 1, col = !w ? 0 : !e ? 2 : 1;
  return `tb${[[18, 19, 20], [36, 37, 38], [54, 55, 56]][row][col]}`;
}

/**
 * The whole world: villages in cells (top 3 central), a high road along the top of each row of cells with a spur to
 * every village's top gate, a two-wide river in its own gap between two columns (bridges where the roads cross), and
 * forest everywhere else. `river: false` (a narrow patch) leaves the river out.
 */
export function buildWorld(vs: VillageInput[], o: { cols: number; central?: number; river?: boolean; seed?: number; busy?: Set<string>; maxWeight?: number; border?: number }): World {
  const cols = Math.max(1, Math.floor(o.cols)), withRiver = o.river !== false && vs.length > 0;
  const order = cellOrder(vs.length, cols, o.central ?? 3);
  const rows = order.length ? Math.max(...order.map((p) => p.y)) + 1 : 0;
  const riverAfter = cols >= 2 ? Math.floor((cols - 1) / 2) : 0, GAP = withRiver ? 4 : 0;
  const B = o.border ?? 1; // forest border
  const cx = (c: number) => B + c * CELL_W + (withRiver && c > riverAfter ? GAP : 0);
  const w = B * 2 + cols * CELL_W + GAP, h = B * 2 + rows * CELL_H;
  const maxW = o.maxWeight ?? Math.max(0, ...vs.map((v) => v.weight));
  const villages = vs.map((v, i) => planVillage(v, cx(order[i].x), B + order[i].y * CELL_H, maxW, { busy: o.busy?.has(v.id) }));

  const key = (x: number, y: number) => `${x},${y}`;
  const clear = new Set<string>();
  for (const v of villages) for (let y = v.ring.y; y < v.ring.y + v.ring.h; y++) for (let x = v.ring.x; x < v.ring.x + v.ring.w; x++) clear.add(key(x, y));

  // High roads: one per row of cells, across the world, with a spur down to each village's top gate.
  const roads: Pt[] = [];
  const roadSet = new Set<string>();
  const addRoad = (x: number, y: number) => { if (!roadSet.has(key(x, y))) { roadSet.add(key(x, y)); roads.push({ x, y }); } };
  for (let r = 0; r < rows; r++) for (let x = B; x < w - B; x++) addRoad(x, B + r * CELL_H);
  for (const v of villages) for (let y = v.cell.y + 1; y < v.plot.y; y++) addRoad(v.plot.x + 1, y);

  // The river: two wide, in its gap, swinging one tile left or right every few rows (seeded), straight at bridges.
  const river: Pt[] = [], bridges: Pt[] = [];
  const water = new Set<string>();
  if (withRiver) {
    const rand = rng((o.seed ?? 7) ^ 0x2545f491);
    const gx = cols >= 2 ? cx(riverAfter) + CELL_W : cx(0) + CELL_W; // first column of the gap
    let off = 1, hold = 0;
    for (let y = 0; y < h; y++) {
      const nearRoad = roadSet.has(key(gx + 1, y)) || roadSet.has(key(gx + 1, y + 1)) || roadSet.has(key(gx + 1, y - 1));
      if (!nearRoad && hold <= 0 && rand() < 0.35) { off = off === 1 ? (rand() < 0.5 ? 0 : 2) : 1; hold = 3; }
      hold--;
      for (const x of [gx + off, gx + off + 1]) { water.add(key(x, y)); river.push({ x, y }); if (roadSet.has(key(x, y))) bridges.push({ x, y, ...(x === gx + off ? {} : { end: true }) } as Pt); }
    }
  }

  const tiles: Tile[] = [];
  for (const p of river) {
    const has = (x: number, y: number) => y < 0 || y >= h || water.has(key(x, y));
    tiles.push(T(p.x, p.y, waterTile(has(p.x, p.y - 1), has(p.x, p.y + 1), has(p.x - 1, p.y), has(p.x + 1, p.y))));
  }
  for (const p of roads) if (!water.has(key(p.x, p.y))) tiles.push(T(p.x, p.y, "tt40"));
  for (const b of bridges) tiles.push(T(b.x, b.y, (b as Pt & { end?: boolean }).end ? "td80" : "td79"));
  for (const v of villages) for (const p of v.road) roadSet.add(key(p.x, p.y));
  for (const v of villages) if (v.sign) roadSet.add(key(v.sign.x, v.sign.y));

  // Forest: every tile not cleared, road or water. Inner tiles merge into runs (one pattern-filled shape); edge tiles
  // are drawn one by one from the cluster pieces.
  const isForest = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && !clear.has(key(x, y)) && !roadSet.has(key(x, y)) && !water.has(key(x, y));
  const forest: Rect[] = [];
  const rand = rng((o.seed ?? 7) ^ 0x51ed270b);
  for (let y = 0; y < h; y++) {
    let run = -1;
    for (let x = 0; x <= w; x++) {
      const f = x < w && isForest(x, y);
      // The world's own edge counts as forest, so the border reads as woods going on.
      const nb = (xx: number, yy: number) => xx < 0 || yy < 0 || xx >= w || yy >= h || isForest(xx, yy);
      const inner = f && nb(x, y - 1) && nb(x, y + 1) && nb(x - 1, y) && nb(x + 1, y);
      if (inner && run < 0) run = x;
      if (!inner && run >= 0) { forest.push({ x: run, y, w: x - run, h: 1 }); run = -1; }
      if (f && !inner) tiles.push(T(x, y, forestTile(nb(x, y - 1), nb(x, y + 1), nb(x - 1, y), nb(x + 1, y))));
    }
  }
  // A few lone trees and flowers on the cleared ring around each fence.
  for (const v of villages) {
    for (let x = v.ring.x; x < v.ring.x + v.ring.w; x++) for (const y of [v.ring.y, v.ring.y + v.ring.h - 1]) {
      if (roadSet.has(key(x, y))) continue;
      const r = rand();
      if (r < 0.12) tiles.push(T(x, y, "tt2")); else if (r < 0.2) tiles.push(T(x, y, "tt1"));
    }
  }
  return { w, h, villages, tiles, forest, roads, river, bridges };
}

/** `n + 2` points spread along a polyline of tile centres (both ends included): the stones on the deadline road. */
export function alongRoad(path: Pt[], n: number): Pt[] {
  if (path.length < 2) return path.slice(0, 1);
  const seg = path.slice(1).map((p, i) => Math.hypot(p.x - path[i].x, p.y - path[i].y));
  const total = seg.reduce((a, b) => a + b, 0), m = n + 2;
  return Array.from({ length: m }, (_, i) => {
    let d = (total * i) / (m - 1), k = 0;
    while (k < seg.length - 1 && d > seg[k]) { d -= seg[k]; k++; }
    const t = seg[k] ? d / seg[k] : 0, a = path[k], b = path[k + 1];
    return { x: r2(a.x + (b.x - a.x) * t), y: r2(a.y + (b.y - a.y) * t) };
  });
}

/** Every tile the map can draw (the page defines one symbol per key; a test checks the world never uses another). */
export const TILE_KEYS: readonly string[] = [
  ...[0, 1, 2, 5, 6, 7, 8, 12, 14, 16, 18, 19, 20, 28, 29, 30, 31, 32, 36, 38, 39, 40, 42, 43, 44, 45, 46, 48, 49, 50, 51, 52, 54, 55, 56, 57, 58,
    60, 61, 62, 63, 67, 68, 69, 70, 73, 74, 79, 83, 84, 85, 86, 88, 89, 90, 91, 103, 104, 107].map((i) => `tt${i}`),
  ...[18, 19, 20, 36, 37, 38, 54, 55, 56].map((i) => `tb${i}`),
  ...[79, 80, 85].map((i) => `td${i}`),
];
