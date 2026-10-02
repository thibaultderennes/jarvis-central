import { sql } from "./db";

/*
 * First-party click and page-view tracking for the Monday Jarvis review (table click_events).
 * The browser side is components/UsageTracker.tsx; it posts batches to /api/usage. Nothing typed by the owner is
 * stored: only the label the code gives an element (data-track, aria-label, title, short button text) and paths.
 * Turned off on the site with JARVIS_TRACK_CLICKS=off (written from usage.track_clicks by setup.mjs secrets).
 */
export const trackingEnabled = () => !/^(0|false|off|no)$/i.test((process.env.JARVIS_TRACK_CLICKS || "").trim());

export type ClickIn = { t?: number; k?: string; p?: string; l?: string; g?: string; s?: string; h?: string };
const KINDS = new Set(["click", "view"]);
const str = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n) : "");
const path = (v: unknown) => { const s = str(v, 160); return s.startsWith("/") ? s : ""; };

/** Validate and store one batch. Never throws: telemetry must not break the page (or a deploy before the migration). */
export async function addClickEvents(sid: string, events: ClickIn[]) {
  const now = Date.now(), rows = [];
  for (const e of events.slice(0, 100)) {
    const kind = KINDS.has(e.k || "") ? e.k! : "click", page = path(e.p);
    if (!page) continue;
    const t = Number(e.t), at = Number.isFinite(t) && t > now - 3600_000 && t <= now + 60_000 ? Math.min(t, now) : now;
    rows.push({ at: new Date(at).toISOString(), kind, page, label: str(e.l, 60), target: str(e.g, 20), section: str(e.s, 60), href: path(e.h) || null });
  }
  if (!rows.length) return 0;
  try {
    await sql()`insert into click_events (at, session_id, kind, page, label, target, section, href)
      select * from unnest(${rows.map((r) => r.at)}::timestamptz[], ${rows.map(() => str(sid, 40))}::text[], ${rows.map((r) => r.kind)}::text[],
        ${rows.map((r) => r.page)}::text[], ${rows.map((r) => r.label)}::text[], ${rows.map((r) => r.target)}::text[],
        ${rows.map((r) => r.section)}::text[], ${rows.map((r) => r.href)}::text[])`;
    return rows.length;
  } catch { return 0; }
}

/** Delete raw events older than `days` (the weekly run calls it with usage.retention_days). */
export async function pruneClickEvents(days: number) {
  const d = Math.max(1, Math.floor(days));
  const rows = await sql()`with gone as (delete from click_events where at < now() - make_interval(days => ${d}::int) returning 1) select count(*)::int as n from gone`;
  return rows[0]?.n as number ?? 0;
}

type Row = { at: string; session_id: string; kind: string; page: string; label: string; target: string; section: string; href: string | null };
const inc = <K>(m: Map<K, number>, k: K, by = 1) => m.set(k, (m.get(k) || 0) + by);
const top = <T>(m: Map<string, number>, n: number, f: (k: string, v: number) => T) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => f(k, v));
const SEP = "\u0000";

/**
 * The weekly aggregate the Jarvis review reads: top clicks, pages (views, clicks, dead ends, exits), page-to-page
 * sequences and backtracks, and features used before but rarely this period. No raw events leave the database.
 */
export async function usageSummary(since: string, until: string) {
  const rows = (await sql()`select at, session_id, kind, page, label, target, section, href from click_events
    where at >= ${since} and at < ${until} order by session_id, at limit 50000`) as Row[];
  const clicks = new Map<string, number>(), views = new Map<string, number>(), pageClicks = new Map<string, number>();
  const deadEnds = new Map<string, number>(), exits = new Map<string, number>(), moves = new Map<string, number>();
  const backtracks = new Map<string, number>(), chains = new Map<string, number>(), days = new Set<string>();
  const sessions = new Map<string, Row[]>();
  for (const r of rows) {
    days.add(new Date(r.at).toISOString().slice(0, 10));
    if (!sessions.has(r.session_id)) sessions.set(r.session_id, []);
    sessions.get(r.session_id)!.push(r);
    if (r.kind === "click") {
      inc(clicks, [r.page, r.label || (r.href ? `→ ${r.href}` : `(${r.target || "unlabelled"})`), r.target, r.section].join(SEP));
      inc(pageClicks, r.page);
    } else inc(views, r.page);
  }
  for (const evs of sessions.values()) {
    const vs = evs.filter((e) => e.kind === "view");
    // A view with no click before the next view (or the end of the session) is a dead end; the last view is an exit.
    evs.forEach((e, i) => {
      if (e.kind !== "view") return;
      const nxt = evs[i + 1];
      if (!nxt || nxt.kind === "view") inc(deadEnds, e.page);
    });
    if (vs.length) inc(exits, vs[vs.length - 1].page);
    for (let i = 1; i < vs.length; i++) {
      if (vs[i].page === vs[i - 1].page) continue;
      inc(moves, vs[i - 1].page + SEP + vs[i].page);
      if (i >= 2 && vs[i].page === vs[i - 2].page) inc(backtracks, vs[i - 2].page + SEP + vs[i - 1].page);
      if (i >= 2 && vs[i - 1].page !== vs[i - 2].page) inc(chains, [vs[i - 2].page, vs[i - 1].page, vs[i].page].join(SEP));
    }
  }
  // Rarely used: elements clicked in the retained history before this period, at most once during it.
  let rare: { page: string; label: string; before: number; now: number }[] = [];
  try {
    const hist = await sql()`select page, label, count(*)::int as n from click_events where kind = 'click' and at < ${since} and label <> ''
      group by 1, 2 order by n desc limit 300`;
    const nowBy = new Map<string, number>();
    for (const [k, v] of clicks) { const [page, label] = k.split(SEP); inc(nowBy, page + SEP + label, v); }
    rare = hist.map((h) => ({ page: h.page as string, label: h.label as string, before: h.n as number, now: nowBy.get(`${h.page}${SEP}${h.label}`) || 0 }))
      .filter((h) => h.now <= 1).slice(0, 25);
  } catch { /* history is optional */ }
  const pages = [...new Set([...views.keys(), ...pageClicks.keys()])].map((p) => ({
    page: p, views: views.get(p) || 0, clicks: pageClicks.get(p) || 0, dead_ends: deadEnds.get(p) || 0, exits: exits.get(p) || 0,
  })).sort((a, b) => b.views - a.views || b.clicks - a.clicks).slice(0, 40);
  return {
    since, until, truncated: rows.length >= 50000,
    totals: { events: rows.length, clicks: rows.filter((r) => r.kind === "click").length, views: rows.filter((r) => r.kind === "view").length, sessions: sessions.size, active_days: days.size },
    top_clicks: top(clicks, 30, (k, n) => { const [page, label, target, section] = k.split(SEP); return { page, label, target, section, n }; }),
    pages,
    dead_end_pages: pages.filter((p) => p.views >= 2 && p.dead_ends / p.views >= 0.5).sort((a, b) => b.dead_ends - a.dead_ends).slice(0, 10),
    sequences: top(moves, 25, (k, n) => { const [from, to] = k.split(SEP); return { from, to, n }; }),
    paths: top(chains, 15, (k, n) => ({ path: k.split(SEP), n })),
    backtracks: top(backtracks, 15, (k, n) => { const [page, via] = k.split(SEP); return { page, via, n }; }), // page → via → straight back to page
    rarely_used: rare,
  };
}
