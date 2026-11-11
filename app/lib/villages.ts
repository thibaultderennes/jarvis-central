// The Villages (the Map): one settlement per project on a shared colony map (components/Colony.tsx). Pure functions (no imports) so `npm test` can load them. All randomness is seeded from the project
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
  // Only on items still open: a finished item can keep its old "pr_open" status long after the pull request merged.
  const prs = live.filter((i) => (i.status === "todo" || i.status === "doing") && (i.build_status === "pr_open" || i.build_status === "merge_requested"));
  const failed = live.filter((i) => i.build_status === "failed" && (i.status === "todo" || i.status === "doing"))
    .map((i) => ({ id: i.id, title: i.title, note: String(i.build_note || "").trim() }));
  return { built: true, running, waiting: prs.length, failed, prUrl: prs.length === 1 ? prs[0].pr_url || null : null };
}

export type PartKey = "hall" | "police" | "bank" | "shop" | "workshop" | "homes";

// ---- Events: what happened lately in a project (the colony map's chronicle, wagons and fireworks). ----

export type MapEvent = { id: string; at: string; kind: "done" | "late" | "review" | "audit" | "pr" | "failed" | "building"; text: string; part: PartKey };
export type EventItem = { id: string; title: string; status: string; due: string | null; done_at: string | null; done_on: string | null; build_status?: string | null; build_updated_at?: string | null };
export type EventReview = { id: string; type: string; title: string; headline?: string | null; created_at: string };

/** One project's events of the last `days`, newest first: items finished (on time or late), builds, reviews and audits. */
export function eventsFor(items: EventItem[], reviews: EventReview[], now: string, days = 7, max = 12): MapEvent[] {
  const to = Date.parse(now), from = to - days * DAY;
  const within = (t: string | null | undefined) => { const v = t ? Date.parse(t) : NaN; return v > from && v <= to; };
  const out: MapEvent[] = [];
  for (const i of items) {
    if (i.status === "done" && within(i.done_at)) out.push({ id: `d:${i.id}`, at: i.done_at!, kind: !i.due || (!!i.done_on && i.done_on <= i.due) ? "done" : "late", text: i.title, part: "hall" });
    if (i.status !== "cancelled" && i.build_status && within(i.build_updated_at)) {
      const k = i.build_status === "failed" ? "failed" : i.build_status === "working" ? "building" : i.build_status === "pr_open" || i.build_status === "merge_requested" ? "pr" : null;
      if (k) out.push({ id: `b:${i.id}`, at: i.build_updated_at!, kind: k, text: i.title, part: "workshop" });
    }
  }
  for (const r of reviews) if (within(r.created_at)) out.push({ id: `r:${r.id}`, at: r.created_at, kind: r.type === "project" ? "review" : "audit", text: r.headline || r.title, part: r.type === "project" ? "hall" : "police" });
  return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, max);
}

/** "12 min ago", "3 h ago", "yesterday", "4 days ago". */
export function agoWords(at: string, now: string): string {
  const m = Math.max(0, Math.round((Date.parse(now) - Date.parse(at)) / 60_000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  if (m < 24 * 60) return `${Math.round(m / 60)} h ago`;
  const d = Math.round(m / (24 * 60));
  return d === 1 ? "yesterday" : `${d} days ago`;
}

// ---- History: the colony as it stood on an earlier day, rebuilt from item dates (no snapshots stored). ----

export type DatedItem = { status: string; created_on: string; done_on: string | null; closed_on?: string | null };
/**
 * The items as they stood at the end of `date`: later ones are gone, ones finished or cancelled after it are open again.
 * Due dates are today's (moves aren't replayed), so "overdue then" is an estimate.
 */
export function itemsAsOf<T extends DatedItem>(items: T[], date: string): T[] {
  return items.filter((i) => i.created_on <= date).map((i) => {
    if (i.status === "done") return i.done_on && i.done_on <= date ? i : { ...i, status: "todo", done_on: null };
    if (i.status === "cancelled") return i.closed_on && i.closed_on <= date ? i : { ...i, status: "todo" };
    return i;
  });
}

/** Open items at the end of each of the last `weeks` weeks (oldest first, the last point is `today`), and items finished in each. */
export function weekSeries(items: DatedItem[], today: string, weeks = 8): { date: string; open: number; done: number }[] {
  return Array.from({ length: weeks }, (_, k) => {
    const date = shift(today, -7 * (weeks - 1 - k)), from = shift(date, -7);
    return {
      date,
      open: itemsAsOf(items, date).filter((i) => i.status === "todo" || i.status === "doing").length,
      done: items.filter((i) => i.status === "done" && i.done_on && i.done_on > from && i.done_on <= date).length,
    };
  });
}

export type Season = "winter" | "spring" | "summer" | "autumn";
/** The season of a date; `south` flips it for the southern hemisphere. */
export function seasonOf(date: string, south = false): Season {
  const m = (+date.slice(5, 7) + (south ? 6 : 0) - 1) % 12 + 1;
  return m === 12 || m <= 2 ? "winter" : m <= 5 ? "spring" : m <= 8 ? "summer" : "autumn";
}

export const LANDMARKS = ["windmill", "lighthouse", "obelisk", "oak"] as const;
export type Landmark = (typeof LANDMARKS)[number];
/** Each project keeps one landmark for life, picked from its id. */
export const landmarkFor = (id: string): Landmark => LANDMARKS[hash(id) % LANDMARKS.length];
