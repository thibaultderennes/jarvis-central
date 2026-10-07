import Link from "next/link";
import { displayColor, getItems, getProjects, getReviews, splitFeatured } from "@/lib/data";
import { buildRegions, FOG_DAYS, nextStop, SOON_DAYS, totals, trailPoints, WINDOW_DAYS, type Region, type Trail } from "@/lib/map";
import { areaWeight, HUT, islandRadius, LAND_DAYS, onTimeCount } from "@/lib/archipelago";
import Archipelago, { ArchLegend, regionLabel, type Isle } from "@/components/Archipelago";
import ArchipelagoShell from "@/components/ArchipelagoShell";
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

/** The map of projects: one island per active project (Home's Map box; /map redirects there), or the card list. */
export default async function MapView() {
  const t = today();
  const [projects, items, reviews] = await Promise.all([getProjects(), getItems(), getReviews({ type: "project", limit: 500 })]);
  const top = new Set(splitFeatured(projects).featured.map((p) => p.id));
  const rows = items.map((i) => ({ project_id: i.project_id, id: i.id, title: i.title, status: i.status, due: i.due, done_on: i.done_at ? isoInTZ(new Date(i.done_at)) : null }));
  const regions = buildRegions(
    projects.map((p) => ({ id: p.id, name: p.name, color: displayColor(p, top), deadlines: p.deadlines || [] })),
    rows, reviews, t,
  );
  // Top 3 first, in their rank, then the rest in sidebar order.
  const rank = (id: string) => { const i = [...top].indexOf(id); return i < 0 ? 99 : i; };
  regions.sort((a, b) => rank(a.id) - rank(b.id));
  const stop = nextStop(regions), sum = totals(regions);

  const byProject = new Map<string, typeof rows>();
  for (const r of rows) byProject.set(r.project_id, [...(byProject.get(r.project_id) || []), r]);
  const lands = regions.map((r) => areaWeight(byProject.get(r.id) || [], t));
  const maxW = Math.max(0, ...lands.map((l) => l.weight));
  const isles: Isle[] = regions.map((r, i) => ({
    ...r, land: lands[i], onTimeAll: onTimeCount(byProject.get(r.id) || []), radius: islandRadius(lands[i].weight, maxW), top: top.has(r.id),
  }));

  const list = (
    <div className="mapv-list">
      <div className="map" role="list" aria-label="Projects">
        {regions.map((r) => <div role="listitem" key={r.id} className={`cell cell-${r.size}`}><RegionCard r={r} stop={r.id === stop} /></div>)}
      </div>
      <div className="key-row" aria-hidden="true">
        <span><svg width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="7" r="5" className="k-on" /></svg>Done on time</span>
        <span><svg width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="7" r="4.25" className="k-open" /></svg>Open</span>
        <span><svg width="14" height="14" viewBox="0 0 14 14"><path d="M3 3l8 8M11 3l-8 8" className="k-late" /></svg>Late</span>
        <span><svg width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="7" r="4" className="k-now" /></svg>Today</span>
        <span><svg width="14" height="14" viewBox="0 0 14 14"><path d="M4 12V2l8 3.5L4 9" className="k-flag" /></svg>Deadline</span>
      </div>
    </div>
  );
  const map = (
    <div className="mapv-map">
      <Archipelago isles={isles} stop={stop} today={t} />
      <ArchLegend />
    </div>
  );

  return (
    <div className="mapv">
      <p className="map-sum">
        <span><b className="mono">{sum.regions}</b> {sum.regions === 1 ? "island" : "islands"}</span>
        <span><b className="mono">{sum.open}</b> open</span>
        <span className={sum.overdue ? "bad" : undefined}><b className="mono">{sum.overdue}</b> overdue</span>
        <span><b className="mono">{sum.fog}</b> in fog</span>
        {sum.pct !== null && <span><b className="mono">{sum.pct}%</b> ground taken ({sum.onTime} of {sum.steps} on time)</span>}
      </p>

      {regions.length
        ? <ArchipelagoShell map={map} list={list} seen={isles.map((i) => ({ id: i.id, name: i.name, onTime: i.onTimeAll }))} />
        : <div className="panel empty">No active projects yet. Approve a project folder in <Link href="/admin">Admin</Link> and it appears here.</div>}

      <details className="map-how">
        <summary>How ground is taken</summary>
        <p>Land is what you finished in the last {LAND_DAYS} days. An item done on or before its due date adds a full share, one done late half, one with no due date a quarter, so ticking off undated work barely grows the island. The island&apos;s radius follows the square root of that weight (its area tracks your work), scaled to your biggest island. Overdue work never shrinks land: it sets a building on fire instead.</p>
        <p>Buildings count every item you ever finished on time: a hut for each {HUT}, five huts make a house, five houses a tower. Scaffolding marks open items, a lantern the ones due in {SOON_DAYS} days. Fog settles after {FOG_DAYS} days with nothing finished. Weather follows the latest review: a storm when it&apos;s off track, a light cloud when at risk.</p>
        <p>The route to the buoy holds the items due between the previous deadline (or the last {WINDOW_DAYS} days when there is none) and the next one. An item takes ground only when you finish it on or before its due date. Finishing it late, or letting it pass its date, keeps it on the route as a lost step, so that milestone can no longer reach 100%. Items without a due date and cancelled items don&apos;t count. The boat marks today; your ship waits at the nearest deadline, the next stop. Islands whose deadlines fall on the same day are joined by a dashed line.</p>
      </details>
    </div>
  );
}
