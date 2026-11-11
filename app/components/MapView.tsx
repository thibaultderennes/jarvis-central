import Link from "next/link";
import { displayColor, getCosts, getItems, getMessages, getProjects, getReviews, kvGet, splitFeatured } from "@/lib/data";
import { getMetrics } from "@/lib/metrics";
import { buildRegions, FOG_DAYS, nextStop, SOON_DAYS, totals, trailPoints, WINDOW_DAYS, type Region, type Trail } from "@/lib/map";
import { agoWords, eventsFor, areaWeight, bankState, hallTier, HALL, homesState, itemsAsOf, LAND_DAYS, onTimeCount, onTimeWeeks, policeState, seasonOf, validChoices, shopState, TOWN_HALL, weekSeries, workshopState, type Snap } from "@/lib/villages";
import { regionLabel, type OpenItem, type Village } from "@/components/Villages";
import Colony from "@/components/Colony";
import { fmtDate, isoInTZ, today } from "@/lib/time";
import "@/app/(main)/map/map.css";

const W = 320, H = 44;
const n = (v: number, one: string, many = one + "s") => `${v} ${v === 1 ? one : many}`;
const until = (d: number) => (d === 0 ? "today" : d === 1 ? "tomorrow" : `in ${d} days`);
const STATE: Record<string, string> = { "on-time": "done on time", late: "late", open: "open" };

/** The milestone trail: one stone per item due in the window, the amber "now" dot, the flag at the deadline. */
function TrailArt({ t }: { t: Trail }) {
  const pts = trailPoints(t.steps.length + 2, W, H, 10); // first point = window start, last = the deadline flag
  const gap = pts.length > 1 ? pts[1].x - pts[0].x : W;
  const r = Math.max(2.5, Math.min(5, gap / 2.6));
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join(" ");
  // "You are here": between the last stone due before today and the first one due from today on.
  const a = pts[t.passed], b = pts[t.passed + 1];
  const now = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const flag = pts[pts.length - 1];
  return (
    <svg className="trail" viewBox={`0 0 ${W} ${H}`} role="img"
      aria-label={`Trail to ${t.deadline.label}: ${t.onTime} done on time, ${t.late} late, ${t.open} open`}>
      <path d={d} className="tr-path" />
      <circle cx={pts[0].x} cy={pts[0].y} r={2} className="tr-start" />
      {t.steps.map((s, i) => {
        const p = pts[i + 1];
        return (
          <g key={s.id} className={`st st-${s.state}`}>
            <title>{`${s.title} · due ${fmtDate(s.due)} · ${STATE[s.state]}`}</title>
            {s.state === "late"
              ? <path d={`M${p.x - r * .8} ${p.y - r * .8}L${p.x + r * .8} ${p.y + r * .8}M${p.x + r * .8} ${p.y - r * .8}L${p.x - r * .8} ${p.y + r * .8}`} />
              : <circle cx={p.x} cy={p.y} r={s.state === "open" ? r - .75 : r} />}
          </g>
        );
      })}
      <circle cx={now.x} cy={now.y} r={4} className="tr-now"><title>Today</title></circle>
      <path d={`M${flag.x} ${flag.y + 6}V${flag.y - 12}l9 3.5-9 3.5`} className="tr-flag" />
    </svg>
  );
}

function RegionCard({ r, stop }: { r: Region; stop: boolean }) {
  const t = r.trail;
  const quiet = r.quietDays === null ? "Nothing finished yet" : `Quiet for ${n(r.quietDays, "day")}: nothing finished`;
  const upcoming = t ? t.steps.filter((s) => s.state === "open").slice(0, 3) : [];
  return (
    <Link href={r.href} className={`rg size-${r.size}${r.fog ? " fog" : ""}${stop ? " stop" : ""}`} data-c={r.color} aria-label={regionLabel(r)}>
      <div className="rg-h">
        <i className="dot" aria-hidden="true" /><b className="rg-n">{r.name}</b>
        {stop && <span className="pill you">Next stop</span>}
        {r.fog && <span className="pill">Fog</span>}
      </div>
      <dl className="rg-s">
        <div><dt>Open</dt><dd>{r.open}</dd></div>
        <div className={r.overdue ? "bad" : undefined}><dt>Overdue</dt><dd>{r.overdue}</dd></div>
        <div><dt>Due in 7 days</dt><dd>{r.dueSoon}</dd></div>
        <div><dt>Done, 28 days</dt><dd>{r.done28}{r.done28 > 0 && <small> · {r.onTime28} on time</small>}</dd></div>
      </dl>
      {t ? (
        <div className="rg-t">
          <div className="rg-tl">
            <span className="lbl">Next deadline</span>
            <span className="rg-dl"><b>{t.deadline.label}</b> <span className="mono">{fmtDate(t.deadline.date)} · {until(t.daysLeft)}</span></span>
          </div>
          <TrailArt t={t} />
          <p className="rg-g">
            {t.total ? <><b className="mono">{t.pct}%</b> ground taken: {t.onTime} of {n(t.total, "item")} due by then done on time{t.late ? `, ${t.late} late` : ""}</>
              : "No item is due by this deadline yet: give items a due date to lay the trail"}
          </p>
          {r.size === "l" && upcoming.length > 0 && (
            <ul className="rg-up" aria-label="Next on the trail">
              {upcoming.map((s) => <li key={s.id}><span className="mono">{fmtDate(s.due)}</span> {s.title}</li>)}
            </ul>
          )}
        </div>
      ) : <p className="rg-g muted">No deadline ahead. Add one in the project&apos;s PRD milestones to lay a trail.</p>}
      {r.review ? (
        <div className="rg-r">
          {r.review.verdict && <span className={`verdict v-${r.review.verdict}`}>{r.review.verdict.replace("-", " ")}</span>}
          <span className="rg-hl">{r.review.headline || "Latest review has no headline"}</span>
        </div>
      ) : <p className="rg-g muted">No project review yet</p>}
      {r.fog && <p className="rg-fog">{quiet}</p>}
    </Link>
  );
}

/** How far back the time slider goes. */
export const HISTORY_WEEKS = 8;

/**
 * The map of projects: every active project a settlement on the colony map, with the card list as its non-map twin.
 * `at` (YYYY-MM-DD) shows the colony as it stood that day, rebuilt from item dates; `full` is the /map page (the Home
 * box is the same map without the time slider).
 */
export default async function MapView({ at = null, full = false }: { at?: string | null; full?: boolean } = {}) {
  const now = today(), t = at && at < now ? at : now, past = t !== now;
  const nowIso = past ? `${t}T23:59:59.999Z` : new Date().toISOString();
  const since = new Date(Date.parse(nowIso) - 90 * 86_400_000).toISOString().slice(0, 10);
  const [projects, allItems, allReviews, allSecurity, allScreenings, costs, allMetrics, stored, messages] = await Promise.all([
    getProjects(), getItems(), getReviews({ type: "project", limit: 500 }),
    getReviews({ type: "security", limit: 500, light: true }), getReviews({ type: "screening", limit: 500, light: true }),
    getCosts(), getMetrics({ since, limit: 2000 }),
    kvGet<Record<string, unknown>>("map.choices").catch(() => null), past ? Promise.resolve([]) : getMessages({ limit: 200 }).catch(() => []),
  ]);
  // Replies and decisions you haven't dealt with yet, per project: the courier at the gate.
  const waiting = messages.filter((m) => m.project_id && !m.archived && !m.treated_at && !["new", "seen", "working"].includes(m.status));
  const day = (iso: string | null) => (iso ? isoInTZ(new Date(iso)) : null);
  const before = <T extends { created_at: string }>(xs: T[]) => (past ? xs.filter((x) => x.created_at <= nowIso) : xs);
  const reviews = before(allReviews), security = before(allSecurity), screenings = before(allScreenings);
  const metrics = past ? allMetrics.filter((m) => m.date <= t) : allMetrics;
  // Each item with its dates as days; in the past, as it stood then (build status isn't replayed).
  const dated = allItems.map((i) => ({ ...i, created_on: day(i.created_at) || "", done_on: day(i.done_at), closed_on: i.status === "cancelled" ? day(i.updated_at) : null }));
  const items = past ? itemsAsOf(dated, t).map((i) => ({ ...i, done_at: i.done_on ? i.done_at : null, build_status: null, pr_url: null })) : dated;
  const top = new Set(splitFeatured(projects).featured.map((p) => p.id));
  const rows = items.map((i) => ({ project_id: i.project_id, id: i.id, title: i.title, status: i.status, due: i.due, done_on: i.done_on }));
  const regions = buildRegions(
    projects.map((p) => ({ id: p.id, name: p.name, color: displayColor(p, top), deadlines: p.deadlines || [] })),
    rows, reviews, t,
  );
  // Top 3 first, in their rank, then the rest in sidebar order.
  const rank = (id: string) => { const i = [...top].indexOf(id); return i < 0 ? 99 : i; };
  regions.sort((a, b) => rank(a.id) - rank(b.id));
  const stop = nextStop(regions), sum = totals(regions);

  const group = <T extends { project_id: string | null }>(xs: T[]) => {
    const m = new Map<string, T[]>();
    for (const x of xs) if (x.project_id) m.set(x.project_id, [...(m.get(x.project_id) || []), x]);
    return m;
  };
  const byProject = group(rows), itemsBy = group(items), datedBy = group(dated), checksBy = group([...security, ...screenings]), costsBy = group(costs);
  const snapsBy = new Map<string, Snap[]>();
  for (const s of metrics) snapsBy.set(s.project_id, [...(snapsBy.get(s.project_id) || []), s]);
  const lands = regions.map((r) => areaWeight(byProject.get(r.id) || [], t));
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const soon = new Date(Date.parse(`${t}T00:00:00Z`) + SOON_DAYS * 86_400_000).toISOString().slice(0, 10);
  const villages: Village[] = regions.map((r, i) => {
    const onTimeAll = onTimeCount(byProject.get(r.id) || []), snaps = snapsBy.get(r.id) || [], its = itemsBy.get(r.id) || [], p = projectById.get(r.id);
    const open = its.filter((x) => x.status === "todo" || x.status === "doing");
    const openItems: OpenItem[] = open
      .map((x) => ({ id: x.id, title: x.title, due: x.due, owner: x.owner, tone: (x.due && x.due < t ? "bad" : x.due && x.due <= soon ? "warn" : "ok") as OpenItem["tone"] }))
      .sort((a, b) => (a.due || "9").localeCompare(b.due || "9")).slice(0, 10);
    return {
      ...r, land: lands[i], onTimeAll, top: top.has(r.id), hall: hallTier(onTimeAll),
      police: policeState(checksBy.get(r.id) || []), bank: bankState(costsBy.get(r.id) || [], snaps),
      shop: shopState(snaps, t), homes: homesState(snaps),
      workshop: workshopState(its, !!p?.site?.code),
      paused: !!p?.paused_at, openItems,
      ...(() => { const weeks = onTimeWeeks(datedBy.get(r.id) || []); return { earnedWeeks: weeks, choices: validChoices(stored?.value?.[r.id], weeks) }; })(),
      mail: (() => { const m = waiting.filter((x) => x.project_id === r.id); return { count: m.length, needs: m.filter((x) => x.status === "needs_you").length, first: (m.find((x) => x.status === "needs_you") || m[0])?.text?.slice(0, 120) || "" }; })(),
      claude: {
        working: open.filter((x) => x.build_status === "working").map((x) => x.title),
        waiting: open.filter((x) => x.build_status === "pr_open" || x.build_status === "merge_requested").map((x) => ({ title: x.title, url: x.pr_url })),
        failed: open.filter((x) => x.build_status === "failed").map((x) => x.title),
      },
      series: weekSeries(datedBy.get(r.id) || [], t, HISTORY_WEEKS),
      milestones: (p?.deadlines || []).filter((d) => d.date < t).length,
      events: eventsFor(
        its.map((x) => ({ id: x.id, title: x.title, status: x.status, due: x.due, done_at: x.done_at, done_on: x.done_on, build_status: x.build_status, build_updated_at: past ? null : x.build_updated_at })),
        [...reviews, ...security, ...screenings].filter((x) => x.project_id === r.id), nowIso,
      ).map((e) => ({ ...e, ago: agoWords(e.at, nowIso) })),
    };
  });
  // What needs you first: overdue, then due this week; paused projects last. Ties keep the order above.
  const plots = villages.map((v, i) => ({ v, i })).sort((a, b) => Number(!!a.v.paused) - Number(!!b.v.paused) || b.v.overdue - a.v.overdue || b.v.dueSoon - a.v.dueSoon || a.i - b.i).map((x) => x.v);

  if (!regions.length) return <div className="panel empty">No active projects yet. Approve a project folder in <Link href="/admin">Admin</Link> and it appears here.</div>;
  return (
    <div className="mapv">
      <Colony villages={plots} today={t} now={now} season={seasonOf(t)} seasonSouth={seasonOf(t, true)} past={past} full={full} weeks={HISTORY_WEEKS} />
      <details className="map-how">
        <summary>The same as a list ({sum.regions} {sum.regions === 1 ? "project" : "projects"}, {sum.open} open, {sum.overdue} overdue)</summary>
        <div className="mapv-list">
          <div className="map" role="list" aria-label="Projects">
            {regions.map((r) => <div role="listitem" key={r.id} className={`cell cell-${r.size}`}><RegionCard r={r} stop={r.id === stop} /></div>)}
          </div>
        </div>
      </details>
      <details className="map-how">
        <summary>How to read the map</summary>
        <p>Every project is a walled settlement. Each building is one part of the project and nothing is decoration only: the <b>town hall</b> is the checklist and grows a tower, then a clock tower, with items you finished on time (at {HALL} and {TOWN_HALL}); the <b>workshop</b> is Claude&apos;s builds; the <b>watchtower</b> is security, its beacon calm, amber or red; the <b>vault</b> is money; the <b>market</b> is growth; the <b>homes</b> are customers. A part with nothing recorded is an empty lot with a sign, never a ruin.</p>
        <p><b>Crates</b> on the square are open items, the most pressing first: red is overdue, amber is due within {SOON_DAYS} days. Click one to finish it, move its date or hand it to Claude. <b>Fields</b> are items done on time in the last 28 days and <b>villagers</b> walk when work is moving. A <b>wagon</b> is something you finished in the last two days. <b>Mist</b> means nothing was finished for {FOG_DAYS} days; stone ground and a shut gate mean the project is paused. The <b>landmark</b> behind the hall is the project&apos;s own, and it rises with every deadline behind you. The stones on the road lead to the next deadline (the last {WINDOW_DAYS} days when there was none before): green done on time, red late, hollow still open.</p>
        <p>Weather follows the latest review: a storm when it is off track, a cloud when at risk. The season is the calendar&apos;s, and night falls in the evening. The <b>lenses</b> recolour every settlement by one question. Cleared ground in the last {LAND_DAYS} days still counts on-time work fully, late work half and undated work a quarter. The time slider rebuilds an earlier week from item dates; due dates are today&apos;s, so past overdue counts are an estimate.</p>
      </details>
    </div>
  );
}
