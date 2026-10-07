// The Archipelago: Home's Map box drawn as islands in a sea (server-rendered SVG, no client code here).
// Every mark comes from lib/archipelago.ts and lib/map.ts; read the header of lib/archipelago.ts for the rules.
import type { ReactNode } from "react";
import { FOG_DAYS, SOON_DAYS, type Region, type Step } from "@/lib/map";
import {
  buildingsFor, buoyFor, colsFor, glyphSize, hash, HOUSE, HUT, islandShape, islandSlots, LAND_DAYS, layoutIslands,
  MAX_FIRES, MAX_SITES, MAX_STONES, sample, seaRoute, sharedRoutes, SHALLOW, TOWER, wavesFor, weatherFor, WOBBLE,
  type Building, type Pt, type Tier,
} from "@/lib/archipelago";
import { fmtDate } from "@/lib/time";

export type Isle = Region & { land: { weight: number; onTime: number; late: number; undated: number }; onTimeAll: number; radius: number; top: boolean };

const n = (v: number, one: string, many = one + "s") => `${v} ${v === 1 ? one : many}`;
const until = (d: number) => (d === 0 ? "today" : d === 1 ? "tomorrow" : `in ${d} days`);
const STATE: Record<string, string> = { "on-time": "done on time", late: "late", open: "open" };
const f = (v: number) => Math.round(v * 10) / 10;
const short = (s: string, max = 22) => (s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s);

/** The full spoken summary of one project, shared with the list view's card. */
export function regionLabel(r: Region): string {
  const t = r.trail;
  const quiet = r.quietDays === null ? "Nothing finished yet" : `Quiet for ${n(r.quietDays, "day")}: nothing finished`;
  return `${r.name}: ${n(r.open, "open item")}, ${r.overdue} overdue${r.next ? `, next deadline ${r.next.label} ${until(r.next.daysLeft)}` : ""}${t?.pct != null ? `, ${t.pct}% ground taken` : ""}${r.review?.verdict ? `, latest review ${r.review.verdict.replace("-", " ")}` : ""}${r.fog ? `, ${quiet.toLowerCase()}` : ""}`;
}

// ---- Glyphs. (0, 0) is the middle of the glyph's base; `s` is its size; `v` (0–1) varies the silhouette. ----

type Shape = { walls: string; roof: string; det: string; top: number };
function building(tier: Tier, s: number, v: number): Shape {
  if (tier === "tower") {
    const w = s * 0.72, h = s * 2, x = -w / 2, m = s * 0.18;
    if (v > 0.5) { // spire
      return { walls: `M${f(x)} 0V${f(-h)}H${f(-x)}V0Z`, roof: `M${f(x - s * .08)} ${f(-h)}L0 ${f(-h - s * .7)}L${f(-x + s * .08)} ${f(-h)}Z`,
        det: `M${f(-s * .08)} ${f(-h * .45)}h${f(s * .16)}v${f(-s * .3)}h${f(-s * .16)}Z`, top: h + s * 0.7 };
    }
    const q = w / 5;
    return { walls: `M${f(x)} 0V${f(-h - m)}h${f(q)}v${f(m)}h${f(q)}v${f(-m)}h${f(q)}v${f(m)}h${f(q)}v${f(-m)}h${f(q)}V0Z`, roof: "",
      det: `M${f(-s * .08)} ${f(-h * .5)}h${f(s * .16)}v${f(-s * .34)}h${f(-s * .16)}Z M${f(-s * .1)} 0v${f(-s * .3)}h${f(s * .2)}v${f(s * .3)}Z`, top: h + m };
  }
  if (tier === "house") {
    const w = s * 1.35, h = s * 0.85, rh = s * (0.45 + v * 0.2), x = -w / 2, cx = x + w * (v > 0.5 ? 0.72 : 0.2);
    return { walls: `M${f(x)} 0V${f(-h)}H${f(-x)}V0Z`,
      roof: `M${f(x - s * .1)} ${f(-h)}L0 ${f(-h - rh)}L${f(-x + s * .1)} ${f(-h)}Z M${f(cx)} ${f(-h - rh * .35)}v${f(-rh * .55)}h${f(s * .16)}v${f(rh * .8)}Z`,
      det: `M${f(x + w * .16)} ${f(-h * .62)}h${f(s * .22)}v${f(s * .22)}h${f(-s * .22)}Z M${f(-x - w * .16 - s * .22)} ${f(-h * .62)}h${f(s * .22)}v${f(s * .22)}h${f(-s * .22)}Z M${f(-s * .1)} 0v${f(-s * .34)}h${f(s * .2)}v${f(s * .34)}Z`,
      top: h + rh };
  }
  const w = s, h = s * 0.55, rh = s * (0.38 + v * 0.22), off = (v - 0.5) * s * 0.3, dx = (v > 0.5 ? 0.18 : -0.18) * s;
  return { walls: `M${f(-w / 2)} 0V${f(-h)}H${f(w / 2)}V0Z`, roof: `M${f(-w * .62)} ${f(-h)}L${f(off)} ${f(-h - rh)}L${f(w * .62)} ${f(-h)}Z`,
    det: `M${f(dx - s * .09)} 0v${f(-s * .28)}h${f(s * .18)}v${f(s * .28)}Z`, top: h + rh };
}

export function BuildingGlyph({ tier, s, v }: { tier: Tier; s: number; v: number }) {
  const b = building(tier, s, v);
  return <><path className="b-wall" d={b.walls} />{b.roof && <path className="b-roof" d={b.roof} />}<path className="b-det" d={b.det} /></>;
}
export function SiteGlyph({ s }: { s: number }) {
  const w = s * 0.45, h = s * 0.9;
  return <><path className="s-base" d={`M${f(-w - s * .1)} 0H${f(w + s * .1)}`} />
    <path className="s-frame" d={`M${f(-w)} 0V${f(-h)}M${f(w)} 0V${f(-h)}M${f(-w)} ${f(-h)}H${f(w)}M${f(-w)} ${f(-h / 2)}H${f(w)}M${f(-w)} 0L${f(w)} ${f(-h / 2)}`} /></>;
}
export function LanternGlyph({ s }: { s: number }) {
  const w = s * 0.45, h = s * 0.9;
  return <><path className="l-hook" d={`M${f(w)} ${f(-h)}v${f(-s * .14)}`} /><circle className="l-lamp" cx={f(w)} cy={f(-h - s * .3)} r={f(Math.max(1.8, s * .17))} /></>;
}
export function FireGlyph({ s, at }: { s: number; at: number }) {
  const k = s * 0.55;
  return <g transform={`translate(${f(s * .1)} ${f(-at + s * .08)})`}>
    <circle className="f-smoke" cx={f(k * .5)} cy={f(-k * 1.6)} r={f(k * .32)} />
    <circle className="f-smoke" cx={f(k * .95)} cy={f(-k * 2.3)} r={f(k * .42)} />
    <path className="f-fire" d={`M0 0c${f(-k * .45)} ${f(-k * .2)} ${f(-k * .4)} ${f(-k * .8)} 0 ${f(-k * 1.15)}c${f(k * .1)} ${f(k * .4)} ${f(k * .45)} ${f(k * .45)} ${f(k * .4)} ${f(k * .8)}c0 ${f(k * .2)} ${f(-k * .15)} ${f(k * .35)} ${f(-k * .4)} ${f(k * .35)}Z`} />
  </g>;
}
export function BannerGlyph({ at, s, verdict }: { at: number; s: number; verdict: string | null }) {
  const p = Math.max(7, s * 0.9), w = Math.max(6, s * 0.8);
  return <g className={`banner bn-${verdict || "none"}`}>
    <path className="bn-pole" d={`M0 ${f(-at)}v${f(-p)}`} />
    <path className="bn-flag" d={`M0 ${f(-at - p)}h${f(w)}l${f(-w * .22)} ${f(p * .22)}l${f(w * .22)} ${f(p * .22)}h${f(-w)}Z`} />
  </g>;
}
export function CloudGlyph({ storm }: { storm: boolean }) {
  return <g className={storm ? "wx storm" : "wx cloud"}>
    {storm && <path className="wx-rain" d="M-8 3l-3 7M-1 3l-3 7M6 3l-3 7" />}
    <path className="wx-c" d="M-14 2a6 6 0 0 1 1-11a8 8 0 0 1 14-4a7 7 0 0 1 12 6a5 5 0 0 1 1 9Z" />
    {storm && <path className="wx-bolt" d="M3 1l-4 7h4l-3 7" />}
  </g>;
}
export function BuoyGlyph() {
  return <g className="buoy">
    <path className="by-pole" d="M0 0V-16" />
    <path className="by-flag" d="M0 -16l9 3.5-9 3.5Z" />
    <path className="by-body" d="M-5 0a5 4 0 0 0 10 0Z" />
  </g>;
}
export function BoatGlyph() {
  return <g className="boat"><path className="bt-hull" d="M-5 -1h10l-2 3h-6Z" /><path className="bt-mast" d="M0 -1v-6l3 3.5" /></g>;
}
export function ShipGlyph() {
  return <g className="ship">
    <path className="sh-mast" d="M0 -2V-20" />
    <path className="sh-sail" d="M1.5 -19c5 3 6 9 5 14h-5Z" />
    <path className="sh-sail" d="M-1.5 -16c-4 2.5-5 7-4 11h4Z" />
    <path className="sh-hull" d="M-11 -2h22l-4 6h-14Z" />
  </g>;
}
export function Stone({ p, state, r }: { p: Pt; state: Step["state"]; r: number }) {
  return state === "late"
    ? <path className="stone st-late" d={`M${f(p.x - r * .8)} ${f(p.y - r * .8)}L${f(p.x + r * .8)} ${f(p.y + r * .8)}M${f(p.x + r * .8)} ${f(p.y - r * .8)}L${f(p.x - r * .8)} ${f(p.y + r * .8)}`} />
    : <circle className={`stone st-${state}`} cx={p.x} cy={p.y} r={state === "open" ? f(r - .6) : r} />;
}

const TIER_WORD: Record<Tier, string> = { hut: "hut", house: "house", tower: "tower" };
function cityLine(bs: Building[], hidden: number, all: number) {
  if (!bs.length) return `No buildings yet: a hut takes ${HUT} items done on time (${all} so far)`;
  const c = { tower: 0, house: 0, hut: 0 } as Record<Tier, number>;
  for (const b of bs) c[b.tier]++;
  c.tower += hidden;
  const parts = (["tower", "house", "hut"] as Tier[]).filter((t) => c[t]).map((t) => n(c[t], TIER_WORD[t]));
  return `${parts.join(", ")}: ${all} items done on time in all`;
}

// ---- One island, drawn around (0, 0). ----

function Island({ isle, stop, today, k }: { isle: Isle; stop: boolean; today: string; k: number }) {
  const seed = hash(isle.id), r = isle.radius;
  const { buildings, hidden } = buildingsFor(isle.onTimeAll);
  const sites = Math.min(isle.open, MAX_SITES), more = isle.open - sites;
  const slots = islandSlots(seed, r, buildings.length + sites);
  const s = glyphSize(r, buildings.length + sites);
  const rand = (i: number) => ((seed >>> (i % 24)) % 97) / 96; // a cheap, stable per-glyph variant
  type Thing = { kind: "b"; i: number; p: Pt; b: Building; top: number } | { kind: "s"; i: number; p: Pt };
  const things: Thing[] = [
    ...buildings.map((b, i): Thing => ({ kind: "b", i, p: slots[i], b, top: building(b.tier, s, rand(i)).top })),
    ...Array.from({ length: sites }, (_, i): Thing => ({ kind: "s", i, p: slots[buildings.length + i] })),
  ];
  const lit = Math.min(isle.dueSoon, sites);
  const fires = Math.min(isle.overdue, MAX_FIRES);
  // Fire goes on buildings first (work that's slipping puts what you built at risk), then on sites.
  const burning = new Set<string>();
  for (const t of [...things.filter((x) => x.kind === "b"), ...things.filter((x) => x.kind === "s")].slice(0, fires)) burning.add(`${t.kind}${t.i}`);
  const tallest = things.find((t) => t.kind === "b") as Extract<Thing, { kind: "b" }> | undefined;
  const wx = weatherFor(isle.review?.verdict);
  const t = isle.trail, buoy = t ? buoyFor(seed, r) : null;
  const steps = t ? sample(t.steps, MAX_STONES) : [];
  const route = buoy ? seaRoute(steps.length, r, buoy) : [];
  const passed = steps.filter((x) => x.due < today).length;
  const right = buoy ? Math.cos(buoy.angle) >= 0 : seed % 2 === 0;
  const reach = r * SHALLOW * (1 + WOBBLE);
  const stoneR = Math.max(2, Math.min(3.2, r / 14));

  return (
    <a href={isle.href} className={`isl${isle.fog ? " fogged" : ""}${isle.top ? " top" : ""}${stop ? " stop" : ""}`} data-c={isle.color} data-isl={isle.id} data-k={k} aria-label={regionLabel(isle)}>
      <title>{regionLabel(isle)}</title>
      <path className="ring" d={islandShape(seed, r * 1.34)} />
      <path className="shallow" d={islandShape(seed, r * SHALLOW)} />
      {buoy && <path className="route" d={route.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join("")} />}
      <path className="surf" d={islandShape(seed, r * 1.07)} />
      <path className="land" d={islandShape(seed, r)} />
      <path className="contour" d={islandShape(seed, r * 0.8)} />
      {things.sort((a, b) => a.p.y - b.p.y || a.p.x - b.p.x).map((x) => (
        <g key={`${x.kind}${x.i}`} transform={`translate(${x.p.x} ${x.p.y})`}>
          {x.kind === "b"
            ? <g className={`bld b-${x.b.tier}`} data-earned={x.b.earnedAt}><BuildingGlyph tier={x.b.tier} s={s} v={rand(x.i)} /></g>
            : <g className="site"><SiteGlyph s={s * 0.9} />{x.i < lit && <LanternGlyph s={s * 0.9} />}</g>}
          {burning.has(`${x.kind}${x.i}`) && <FireGlyph s={s} at={x.kind === "b" ? x.top : s * 0.8} />}
        </g>
      ))}
      {isle.review && (tallest
        ? <g transform={`translate(${tallest.p.x} ${tallest.p.y})`}><BannerGlyph at={tallest.top} s={s} verdict={isle.review.verdict} /></g>
        : <BannerGlyph at={0} s={Math.max(s, 9)} verdict={isle.review.verdict} />)}
      {isle.overdue > MAX_FIRES && <text className="count bad" x={f(right ? r * .8 : -r * .8)} y={f(r * 1.02)} textAnchor="middle">+{isle.overdue - MAX_FIRES}</text>}
      {more > 0 && <text className="count" x={f(right ? -r * .8 : r * .8)} y={f(r * 1.02)} textAnchor="middle">+{more}</text>}
      {buoy && <>
        {steps.map((st, i) => <Stone key={st.id} p={route[i + 1]} state={st.state} r={stoneR} />)}
        <g transform={`translate(${f((route[passed].x + route[passed + 1].x) / 2)} ${f((route[passed].y + route[passed + 1].y) / 2 + 3)})`}><BoatGlyph /></g>
        <g transform={`translate(${buoy.x} ${buoy.y + 3})`}><BuoyGlyph /></g>
        {stop && <g transform={`translate(${f(buoy.x + (right ? 15 : -15))} ${f(buoy.y + 6)})${right ? "" : " scale(-1 1)"}`}><ShipGlyph /></g>}
      </>}
      {isle.fog && <g className="fog" filter={`url(#arch-fog)`}>
        <ellipse cx={f(-r * .3)} cy={f(-r * .2)} rx={f(r * .9)} ry={f(r * .55)} />
        <ellipse cx={f(r * .35)} cy={f(r * .25)} rx={f(r * .85)} ry={f(r * .5)} />
        <ellipse cx={0} cy={f(r * .05)} rx={f(r * 1.1)} ry={f(r * .4)} />
      </g>}
      {(wx === "storm" || wx === "cloud") && <g transform={`translate(${f((right ? -1 : 1) * (reach + 6) * 0.68)} ${f(-(reach + 6) * 0.74)})`}><CloudGlyph storm={wx === "storm"} /></g>}
      <text className="isl-n" y={f(reach + 12)} textAnchor="middle">{short(isle.name)}</text>
      <text className="isl-s" y={f(reach + (isle.top ? 27 : 24))} textAnchor="middle">
        {isle.open} open{isle.overdue > 0 && <tspan className="bad"> · {isle.overdue} overdue</tspan>}
      </text>
    </a>
  );
}

// ---- The hover / focus card: the list view's stats, floating over the map. ----

function Card({ isle, stop, k, x, y, W, H }: { isle: Isle; stop: boolean; k: number; x: number; y: number; W: number; H: number }) {
  const t = isle.trail;
  const quiet = isle.quietDays === null ? "Nothing finished yet" : `Quiet for ${n(isle.quietDays, "day")}: nothing finished`;
  const { buildings, hidden } = buildingsFor(isle.onTimeAll);
  const reach = isle.radius * SHALLOW * (1 + WOBBLE);
  const up = y / H > 0.55;
  const side = x / W < 0.3 ? "al" : x / W > 0.7 ? "ar" : "ac";
  const style = { left: `${f((x / W) * 100)}%`, top: `${f(((up ? y - reach - 20 : y + reach + 32) / H) * 100)}%` };
  return (
    <div className={`acard ${side}${up ? " up" : ""}`} data-k={k} data-c={isle.color} style={style} aria-hidden="true">
      <div className="rg-h"><i className="dot" /><b className="rg-n">{isle.name}</b>
        {stop && <span className="pill you">Next stop</span>}{isle.fog && <span className="pill">Fog</span>}</div>
      <dl className="rg-s">
        <div><dt>Open</dt><dd>{isle.open}</dd></div>
        <div className={isle.overdue ? "bad" : undefined}><dt>Overdue</dt><dd>{isle.overdue}</dd></div>
        <div><dt>Due in 7 days</dt><dd>{isle.dueSoon}</dd></div>
        <div><dt>Done, 28 days</dt><dd>{isle.done28}{isle.done28 > 0 && <small> · {isle.onTime28} on time</small>}</dd></div>
      </dl>
      <p className="rg-g">Land, last {LAND_DAYS} days: {isle.land.onTime} on time, {isle.land.late} late, {isle.land.undated} undated</p>
      <p className="rg-g">{cityLine(buildings, hidden, isle.onTimeAll)}</p>
      {t ? <p className="rg-g"><b>{t.deadline.label}</b> <span className="mono">{fmtDate(t.deadline.date)} · {until(t.daysLeft)}</span>
        {t.total ? <> · <b className="mono">{t.pct}%</b> ground taken ({t.onTime} of {t.total} on time{t.late ? `, ${t.late} late` : ""})</> : " · no item due by then yet"}</p>
        : <p className="rg-g muted">No deadline ahead</p>}
      {isle.review ? <div className="rg-r">{isle.review.verdict && <span className={`verdict v-${isle.review.verdict}`}>{isle.review.verdict.replace("-", " ")}</span>}
        <span className="rg-hl">{isle.review.headline || "Latest review has no headline"}</span></div>
        : <p className="rg-g muted">No project review yet</p>}
      {isle.fog && <p className="rg-fog">{quiet}</p>}
    </div>
  );
}

// ---- The map: one layout for wide boxes, one column for narrow ones (CSS picks with a container query). ----

const CELL = { wide: { w: 204, h: 216 }, narrow: { w: 300, h: 204 } };

function Sea({ isles, stop, today, mode }: { isles: Isle[]; stop: string | null; today: string; mode: "wide" | "narrow" }) {
  const cell = CELL[mode], cols = mode === "wide" ? colsFor(isles.length) : 1;
  // One column reads top to bottom, so the top 3 simply come first there; on a wide map they take the middle.
  const L = layoutIslands(isles.length, { cols, cellW: cell.w, cellH: cell.h, seed: hash(isles.map((i) => i.id).join("|")), central: mode === "wide" ? 3 : 0 });
  const W = L.width, H = L.height;
  const buoys = isles.map((isle, i) => {
    if (!isle.trail) return null;
    const b = buoyFor(hash(isle.id), isle.radius);
    return { x: L.slots[i].x + b.x, y: L.slots[i].y + b.y };
  });
  const shared = sharedRoutes(isles.map((i) => i.next?.date));
  const avoid = isles.flatMap((isle, i) => [{ ...L.slots[i], r: isle.radius * SHALLOW * (1 + WOBBLE) + 34 }, ...(buoys[i] ? [{ ...buoys[i]!, r: 26 }] : [])]);
  const waves = wavesFor(hash(mode), W, H, avoid, Math.round((W * H) / 9000));
  const hover = isles.map((_, k) => `.arch-${mode}:has(.isl[data-k="${k}"]:is(:hover,:focus-visible)) .acard[data-k="${k}"]`).join(",");
  return (
    <div className={`arch-l arch-${mode}`} style={{ maxWidth: `${Math.round(W * 1.25)}px` }}>
      <style>{`${hover}{display:flex}`}</style>
      <svg className="arch-svg" viewBox={`0 0 ${W} ${H}`} role="group" aria-label="Project map: one island per project">
        <rect className="sea" x="0" y="0" width={W} height={H} rx="8" />
        <g aria-hidden="true">
          {waves.map((p, i) => <path key={i} className="wave" d={`M${p.x} ${p.y}q3 -3 6 0t6 0${i % 3 === 0 ? "t6 0" : ""}`} />)}
          {shared.map(([a, b]) => buoys[a] && buoys[b] && (
            <path key={`${a}-${b}`} className="shared" d={`M${buoys[a]!.x} ${buoys[a]!.y}L${buoys[b]!.x} ${buoys[b]!.y}`}>
              <title>{`${isles[a].name} and ${isles[b].name} share a deadline day: ${fmtDate(isles[a].next!.date)}`}</title>
            </path>
          ))}
        </g>
        {isles.map((isle, k) => (
          <g key={isle.id} transform={`translate(${L.slots[k].x} ${L.slots[k].y})`}>
            <Island isle={isle} stop={isle.id === stop} today={today} k={k} />
          </g>
        ))}
      </svg>
      {isles.map((isle, k) => <Card key={isle.id} isle={isle} stop={isle.id === stop} k={k} x={L.slots[k].x} y={L.slots[k].y} W={W} H={H} />)}
    </div>
  );
}

export default function Archipelago({ isles, stop, today }: { isles: Isle[]; stop: string | null; today: string }) {
  return (
    <div className="arch">
      <svg className="arch-defs" width="0" height="0" aria-hidden="true" focusable="false">
        <defs>
          <filter id="arch-fog" x="-30%" y="-30%" width="160%" height="160%">
            <feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="2" seed="3" result="n" />
            <feDisplacementMap in="SourceGraphic" in2="n" scale="14" xChannelSelector="R" yChannelSelector="G" result="d" />
            <feGaussianBlur in="d" stdDeviation="3.5" />
          </filter>
        </defs>
      </svg>
      <Sea isles={isles} stop={stop} today={today} mode="wide" />
      <Sea isles={isles} stop={stop} today={today} mode="narrow" />
    </div>
  );
}

/** The map's legend: every mark, drawn small, with what it means. */
export function ArchLegend() {
  const G = ({ children, vb = "-11 -14 22 18" }: { children: ReactNode; vb?: string }) => {
    const [, , w, h] = vb.split(" ").map(Number);
    return <svg width={Math.round((w * 18) / h)} height={18} viewBox={vb} aria-hidden="true">{children}</svg>;
  };
  return (
    <ul className="arch-key" aria-label="What the marks mean">
      <li><G vb="-11 -9 22 18"><path className="shallow" d={islandShape(7, 9.5)} /><path className="land" d={islandShape(7, 7.5)} /></G>Land: what you finished in {LAND_DAYS} days (late counts half, undated a quarter)</li>
      <li><G vb="-12 -18 24 20"><g transform="translate(-6 0)" className="bld"><BuildingGlyph tier="hut" s={8} v={.3} /></g><g transform="translate(6 0)" className="bld"><BuildingGlyph tier="tower" s={8} v={.2} /></g></G>Hut: {HUT} items done on time, house {HOUSE}, tower {TOWER}</li>
      <li><G><g className="site"><SiteGlyph s={11} /></g></G>Open item (+N: more than drawn)</li>
      <li><G><g className="site"><SiteGlyph s={11} /><LanternGlyph s={11} /></g></G>Due in {SOON_DAYS} days</li>
      <li><G vb="-8 -16 18 18"><FireGlyph s={12} at={0} /></G>Overdue</li>
      <li><G vb="-11 -9 22 18"><path className="land" d={islandShape(7, 7.5)} /><g className="fog" filter="url(#arch-fog)"><ellipse rx="9" ry="5" /></g></G>Fog: nothing finished for {FOG_DAYS} days</li>
      <li><G vb="-4 -16 16 18"><BannerGlyph at={0} s={11} verdict="on-track" /></G>Latest review verdict</li>
      <li><G vb="-16 -16 32 24"><CloudGlyph storm /></G>Off track (a light cloud: at risk)</li>
      <li><G vb="-4 -18 40 22"><path className="route" d="M0 0L22 0" /><Stone p={{ x: 3, y: 0 }} state="on-time" r={2.6} /><Stone p={{ x: 10, y: 0 }} state="late" r={2.6} /><Stone p={{ x: 17, y: 0 }} state="open" r={2.6} /><g transform="translate(23 2)"><BuoyGlyph /></g></G>Route to the next deadline: on time, late, open</li>
      <li><G vb="-7 -9 14 12"><BoatGlyph /></G>Today</li>
      <li><G vb="-12 -21 24 26"><ShipGlyph /></G>Next stop: the nearest deadline</li>
    </ul>
  );
}
