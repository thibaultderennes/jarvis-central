import type { Cost, DailyStats, Economics, Item, Project } from "./data";
import { isOpen, monthly } from "./data";
import type { Snapshot } from "./metrics";
import { addDays, daysBetween, isoInTZ } from "./time";

/*
 * Numbers for a project's Stats view, computed from rows already loaded (pure: no queries).
 * Product: the latest metrics snapshot vs the one a period (7 days) earlier, plus costs. Delivery: flow metrics from the
 * checklist (throughput, lead time, age of open work, overdue, scope added vs finished, a forecast to the next milestone).
 */
export type Pt = { date: string; v: number };
export type Tile = { key: string; label: string; value: number | null; fmt: "n" | "money" | "pct" | "days"; prev: number | null; up: "good" | "bad" | "none"; sub: string; spark: Pt[]; hint: string; tone?: "bad" | "go" };

const day = (v: string) => isoInTZ(new Date(v));
const median = (a: number[]) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pctl = (a: number[], p: number) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]; };
const r1 = (v: number) => Math.round(v * 10) / 10;

export function series(snaps: Snapshot[], key: string): Pt[] {
  return snaps.filter((s) => typeof s.metrics[key] === "number").map((s) => ({ date: s.date, v: s.metrics[key] }));
}
/** The value a period before the latest point: the newest point at least `days` older (null when history is shorter). */
function before(pts: Pt[], days = 7): number | null {
  const last = pts.at(-1); if (!last) return null;
  const cut = addDays(last.date, -days);
  for (let i = pts.length - 2; i >= 0; i--) if (pts[i].date <= cut) return pts[i].v;
  return null;
}

/** Monthly total of the project's active recurring costs in its main currency, and the rest as text. */
export function costTotals(costs: Cost[], preferred: string) {
  const by: Record<string, number> = {};
  for (const c of costs.filter((x) => x.active)) by[c.currency] = (by[c.currency] || 0) + monthly(c);
  const cur = by[preferred] !== undefined || !Object.keys(by).length ? preferred : Object.entries(by).sort((a, b) => b[1] - a[1])[0][0];
  return { currency: cur, monthly: by[cur] || 0, count: costs.filter((x) => x.active).length, others: Object.entries(by).filter(([k]) => k !== cur).map(([k, v]) => `${Math.round(v)} ${k}`) };
}

/** The unit-economics model's monthly cost and revenue at `users`, at its default scenario (linear between grid rows). */
export function modelAt(e: Economics | null, users: number | null) {
  const d = e?.data; if (!d || users === null || !d.users.length) return null;
  const k = `${Math.max(0, d.options.findIndex((x) => x.id === d.defaults.option))}.${Math.max(0, d.mixes.findIndex((x) => x.id === d.defaults.mix))}.${Math.max(0, d.usage.indexOf(d.defaults.usage))}.${d.driver ? Math.max(0, d.driver.values.indexOf(d.defaults.driver ?? NaN)) : 0}`;
  const rows = d.grid[k]; if (!rows) return null;
  const u = d.users, n = Math.min(Math.max(users, u[0]), u[u.length - 1]);
  const i = u.findIndex((x) => x >= n);
  if (i <= 0) return { cost: Math.round(rows[0][1]), revenue: Math.round(rows[0][0]), currency: d.currency };
  const f = u[i] === u[i - 1] ? 0 : (n - u[i - 1]) / (u[i] - u[i - 1]);
  const lerp = (j: number) => rows[i - 1][j] + (rows[i][j] - rows[i - 1][j]) * f;
  return { cost: Math.round(lerp(1)), revenue: Math.round(lerp(0)), currency: d.currency };
}

export function productStats(snaps: Snapshot[], costs: Cost[], economics: Economics | null, currency: string) {
  const s = (k: string) => series(snaps, k);
  const users = s("users"), active = s("active_users"), signups = s("signups"), visits = s("visits"), paying = s("paying_users"), mrr = s("mrr"), revenue = s("revenue"), activated = s("activated");
  const last = (p: Pt[]) => p.at(-1)?.v ?? null;
  const ct = costTotals(costs, currency), model = modelAt(economics, last(users) ?? last(active));
  const base = active.length ? active : users;
  const perUser = ct.monthly && base.length ? base.map((p) => ({ date: p.date, v: p.v > 0 ? ct.monthly / p.v : 0 })).filter((p) => p.v > 0) : [];
  const pct = (a: number | null, b: number | null) => (a !== null && b ? Math.round((a / b) * 1000) / 10 : null);
  const money = ct.currency;
  const rev = mrr.length ? mrr : revenue;
  const tiles: Tile[] = [
    { key: "users", label: "Users", value: last(users), fmt: "n", prev: before(users), up: "good", spark: users, hint: "Total accounts on the latest snapshot",
      sub: last(signups) !== null ? `+${last(signups)} signups in 7 d${activated.length && last(signups) ? ` · ${pct(last(activated), last(signups))}% activated` : ""}` : "" },
    { key: "active_users", label: "Active users", value: last(active), fmt: "n", prev: before(active), up: "good", spark: active, hint: "Active in the last 7 days (WAU)",
      sub: pct(last(active), last(users)) !== null ? `${pct(last(active), last(users))}% of users active` : "weekly active" },
    { key: "visits", label: "Visitors · 7 d", value: last(visits), fmt: "n", prev: before(visits), up: "good", spark: visits, hint: "Unique visitors over the 7 days before the snapshot",
      sub: pct(last(signups), last(visits)) !== null ? `${pct(last(signups), last(visits))}% became signups` : "" },
    { key: "revenue", label: mrr.length ? "MRR" : "Revenue · 7 d", value: last(rev), fmt: "money", prev: before(rev), up: "good", spark: rev, hint: mrr.length ? "Monthly recurring revenue" : "Money collected over the 7 days before the snapshot",
      sub: last(paying) !== null ? `${last(paying)} paying${mrr.length && last(paying) ? ` · ${Math.round(last(mrr)! / last(paying)!)} ${money} each` : ""}` : "" },
    { key: "expenses", label: "Expenses / month", value: ct.count ? Math.round(ct.monthly) : null, fmt: "money", prev: null, up: "none", spark: [], hint: "Active recurring costs of this project (Finances), as a monthly amount",
      sub: [ct.count ? `${ct.count} recurring cost${ct.count > 1 ? "s" : ""}` : "", ...ct.others.map((o) => `+ ${o}`), model ? `model: ${model.cost} ${model.currency} at ${last(users) ?? last(active)} users` : ""].filter(Boolean).join(" · ") },
    { key: "per_user", label: active.length ? "Cost per active user" : "Cost per user", value: perUser.at(-1)?.v ?? null, fmt: "money", prev: before(perUser), up: "bad", spark: perUser, hint: "Monthly expenses divided by (active) users",
      sub: mrr.length && ct.monthly ? `net ${Math.round(last(mrr)! - ct.monthly)} ${money} / month` : "per month" },
  ];
  const extra = [...new Set(snaps.flatMap((x) => Object.keys(x.metrics)))].filter((k) => !["users", "active_users", "signups", "activated", "visits", "paying_users", "churned", "mrr", "revenue"].includes(k));
  return { tiles, currency: money, users, active, paying, visits, signups, latest: snaps.at(-1) || null, extra: extra.map((k) => ({ key: k, value: snaps.findLast((x) => typeof x.metrics[k] === "number")?.metrics[k] ?? null })) };
}

/** Seeded PRNG so the forecast doesn't change on every render. */
function rng(seed: number) { return () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
/** Monte Carlo: weeks to finish `n` items when each week's throughput is drawn from past weeks. Returns [p50, p85] or null. */
export function forecastWeeks(n: number, samples: number[], trials = 2000): [number, number] | null {
  if (!n) return [0, 0];
  if (!samples.length || samples.every((v) => v === 0)) return null;
  const rand = rng(n * 7919 + samples.reduce((a, b) => a * 31 + b, 17)), out: number[] = [];
  for (let t = 0; t < trials; t++) { let left = n, w = 0; while (left > 0 && w < 520) { left -= samples[Math.floor(rand() * samples.length)]; w++; } out.push(w); }
  return [pctl(out, 0.5)!, pctl(out, 0.85)!];
}

export function deliveryStats(p: Project, items: Item[], weekly: DailyStats, t: string) {
  const open = items.filter(isOpen), weeks = weekly.days;
  const full = weeks.slice(0, -1); // the current week is partial
  const last4 = full.slice(-4), prev4 = full.slice(-8, -4), last8 = full.slice(-8);
  const sum = (a: { done: number }[]) => a.reduce((s, d) => s + d.done, 0);
  // A young project may have finished work only this week: then the partial week is the only pace there is.
  const cur = weeks.at(-1), young = sum(last8) === 0 && (cur?.done || 0) > 0;
  const thr = young ? cur!.done : last4.length ? sum(last4) / last4.length : 0, thrPrev = young ? null : prev4.length ? sum(prev4) / prev4.length : null;
  const since56 = addDays(t, -56);
  const lead = items.filter((i) => i.status === "done" && i.done_at && day(i.done_at) >= since56).map((i) => Math.max(0, daysBetween(day(i.created_at), day(i.done_at!))));
  const ages = open.map((i) => ({ i, age: Math.max(0, daysBetween(day(i.created_at), t)) })).sort((a, b) => b.age - a.age);
  const late = open.filter((i) => i.due && i.due < t), oldestLate = late.reduce((m, i) => Math.max(m, daysBetween(i.due!, t)), 0);
  const added4 = last4.reduce((s, d) => s + d.added, 0) + (weeks.at(-1)?.added || 0), done4 = sum(last4) + (weeks.at(-1)?.done || 0);
  const ms = p.deadlines.filter((d) => d.date >= t).sort((a, b) => a.date.localeCompare(b.date))[0] || null;
  const due = ms ? open.filter((i) => i.due && i.due <= ms.date) : [];
  const scope = ms && due.length ? due.length : open.length;
  const fw = forecastWeeks(scope, (young ? [cur!] : last8).map((d) => d.done));
  const p50 = fw ? addDays(t, fw[0] * 7) : null, p85 = fw ? addDays(t, fw[1] * 7) : null;
  const status: "on" | "risk" | "off" | null = !ms || !fw ? (ms && scope ? "off" : null) : p85! <= ms.date ? "on" : p50! <= ms.date ? "risk" : "off";
  const tiles: Tile[] = [
    { key: "throughput", label: "Throughput", value: r1(thr), fmt: "n", prev: thrPrev === null ? null : r1(thrPrev), up: "good", spark: full.slice(-12).map((d) => ({ date: d.date, v: d.done })), hint: young ? "Nothing finished in earlier weeks: this is the current week so far" : "Items finished per week, average of the last 4 full weeks", sub: young ? "this week so far" : "items / week · last 4 weeks" },
    { key: "lead", label: "Lead time", value: median(lead), fmt: "days", prev: null, up: "bad", spark: [], hint: "Median days from adding an item to finishing it, items finished in the last 8 weeks", sub: lead.length ? `median · 85% within ${pctl(lead, 0.85)} d · ${lead.length} items` : "nothing finished in 8 weeks" },
    { key: "age", label: "Age of open work", value: median(ages.map((a) => a.age)), fmt: "days", prev: null, up: "bad", spark: [], hint: "Median days since open items were added", sub: `median · ${ages.filter((a) => a.age > 30).length} of ${open.length} older than 30 d` },
    { key: "overdue", label: "Overdue", value: late.length, fmt: "n", prev: null, up: "bad", spark: [], hint: "Open items past their due date", sub: late.length ? `oldest ${oldestLate} d late` : "nothing late", tone: late.length ? "bad" : undefined },
    { key: "scope", label: "Scope · 4 weeks", value: added4 - done4, fmt: "n", prev: null, up: "bad", spark: [], hint: "Items added minus items finished over the last 4 weeks and this one", sub: `+${added4} added · ${done4} finished` },
  ];
  return {
    tiles, weeks: weeks.slice(-12), open: open.length,
    oldest: ages.slice(0, 5).map(({ i, age }) => ({ id: i.id, title: i.title, age, due: i.due, late: !!(i.due && i.due < t), owner: i.owner, status: i.status })),
    forecast: { milestone: ms, scope, scopeIsDue: !!(ms && due.length), p50, p85, status, samples: last8.length, young, rate: r1(thr) },
  };
}
