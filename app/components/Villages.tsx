// The Villages: Home's Map box drawn as one pixel world, a village per project (server-rendered SVG, no client code).
// Every mark comes from lib/villages.ts and lib/map.ts; read the header of lib/villages.ts for the rules. Tiles are
// Kenney's CC0 packs in public/map (see the README there); everything drawn outside the tiles uses DESIGN.md tokens.
import type { ReactNode } from "react";
import { FOG_DAYS, SOON_DAYS, type Region, type Step } from "@/lib/map";
import {
  alongRoad, buildWorld, colsFor, hash, HALL, LAND_DAYS, MAX_FIRES, MAX_LAMPS, MAX_SITES, MAX_STONES, sample, SHOP_METRICS,
  TILE_KEYS, TOWN_HALL, TREND_DAYS, weatherFor,
  type BankState, type HallTier, type HomesState, type PartKey, type PoliceState, type Pt, type Rect, type ShopState, type Tile,
  type VillageInput, type VillagePlan, type WorkshopState,
} from "@/lib/villages";
import { fmtDate } from "@/lib/time";

export type Village = Region & {
  land: { weight: number; onTime: number; late: number; undated: number }; onTimeAll: number; top: boolean;
  hall: { tier: HallTier; since: number; next: number | null };
  police: PoliceState; bank: BankState; shop: ShopState; homes: HomesState; workshop: WorkshopState;
};

const S = 16; // source pixels per tile
const SHEETS: Record<string, { src: string; cols: number; w: number; h: number }> = {
  // The spaced tilemaps (1px gap between tiles), so a scaled tile never samples its neighbour's edge.
  tt: { src: "/map/tiny-town/tilemap.png", cols: 12, w: 203, h: 186 },
  tb: { src: "/map/tiny-battle/tilemap.png", cols: 18, w: 305, h: 186 },
  td: { src: "/map/tiny-dungeon/tilemap.png", cols: 12, w: 203, h: 186 },
};
const n = (v: number, one: string, many = one + "s") => `${v} ${v === 1 ? one : many}`;
const until = (d: number) => (d === 0 ? "today" : d === 1 ? "tomorrow" : `in ${d} days`);
const STATE: Record<string, string> = { "on-time": "done on time", late: "late", open: "open" };
const fmtN = (v: number) => (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString("en-US") : String(Math.round(v * 100) / 100));
const METRIC: Record<string, string> = { visits: "Visitors", signups: "Signups", active_users: "Active users", users: "Users", paying_users: "Paying users", mrr: "MRR", revenue: "Revenue" };
const TIER: Record<HallTier, string> = { small: "small hall", hall: "hall", town: "town hall with a clock" };
const LEVEL: Record<string, string> = { calm: "all clear", amber: "warnings to fix", red: "critical or failing" };
const short = (s: string, max = 26) => (s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s);

/** The full spoken summary of one project, shared with the list view's card. */
export function regionLabel(r: Region): string {
  const t = r.trail;
  const quiet = r.quietDays === null ? "Nothing finished yet" : `Quiet for ${n(r.quietDays, "day")}: nothing finished`;
  return `${r.name}: ${n(r.open, "open item")}, ${r.overdue} overdue${r.next ? `, next deadline ${r.next.label} ${until(r.next.daysLeft)}` : ""}${t?.pct != null ? `, ${t.pct}% ground taken` : ""}${r.review?.verdict ? `, latest review ${r.review.verdict.replace("-", " ")}` : ""}${r.fog ? `, ${quiet.toLowerCase()}` : ""}`;
}

// ---- What each building says, in words (aria-label, hover card). ----

const costWords = (b: Extract<BankState, { built: true }>) => b.costs.length ? `costs ${b.costs.map((c) => `${fmtN(c.monthly)} ${c.currency}`).join(" + ")} a month` : "no recurring costs";
const revWords = (b: Extract<BankState, { built: true }>) => b.revenue === null ? "no revenue recorded" : b.revenueFrom === "mrr" ? `MRR ${fmtN(b.revenue)}` : `revenue about ${fmtN(b.revenue)} a month (last 7 days × 52 / 12)`;
const buildWords = (w: Extract<WorkshopState, { built: true }>) => {
  const parts = [w.running ? `${n(w.running, "build")} running` : "", w.waiting ? `${n(w.waiting, "pull request")} waiting for you` : "", w.failed.length ? `${n(w.failed.length, "build")} stopped` : ""].filter(Boolean);
  return parts.length ? parts.join(", ") : "nothing being built, door closed";
};

export function partLabel(v: Village, key: PartKey): string {
  const name = v.name;
  switch (key) {
    case "hall": return `${name} ${TIER[v.hall.tier]}: the checklist, ${n(v.onTimeAll, "item")} done on time, ${n(v.open, "open item")}, ${v.overdue} overdue, ${v.dueSoon} due in ${SOON_DAYS} days${v.review?.verdict ? `, latest review ${v.review.verdict.replace("-", " ")}` : ""}`;
    case "police": return v.police.built ? `${name} police station: security, ${LEVEL[v.police.level]} (${v.police.checks.map((c) => `${c.type === "security" ? "security audit" : "screening"} ${c.date}${c.verdict ? ` ${c.verdict.replace("-", " ")}` : ""}`).join(", ")})` : `${name} police station: empty lot, no security audit or screening yet`;
    case "bank": return v.bank.built ? `${name} bank: ${costWords(v.bank)}, ${revWords(v.bank)}` : `${name} bank: empty lot, no costs or revenue recorded`;
    case "shop": return v.shop.built ? `${name} shop: ${METRIC[v.shop.metric] || v.shop.metric} ${fmtN(v.shop.first.value)} to ${fmtN(v.shop.last.value)}, ${v.shop.trend === "up" ? "growing" : v.shop.trend === "down" ? "declining, closed sign" : "flat"}` : `${name} shop: empty lot, no product metrics yet`;
    case "homes": return v.homes.built ? `${name} houses: ${METRIC[v.homes.metric]} ${fmtN(v.homes.count)}, ${n(v.homes.houses, "house")}` : `${name} houses: lots for sale, no user count recorded`;
    case "workshop": return v.workshop.built ? `${name} workshop: ${buildWords(v.workshop)}` : `${name} workshop: empty lot, no code repository found for builds`;
  }
}

export function partHref(v: Village, key: PartKey): string {
  const base = `/p/${encodeURIComponent(v.id)}`;
  if (key === "police") return `${base}?v=docs&k=security`;
  if (key === "bank") return `${base}?v=finance`;
  if (key === "shop" || key === "homes") return `${base}?v=stats`;
  if (key === "workshop" && v.workshop.built && v.workshop.prUrl) return v.workshop.prUrl;
  return `${base}?v=checklist`;
}

// ---- Pixel marks drawn outside the tiles (token colours). Coordinates are source pixels. ----

type Px = [number, number, number, number, string];
const px = (x: number, y: number, rects: Px[], key?: string | number) => (
  <g key={key} transform={`translate(${x} ${y})`}>{rects.map(([a, b, w, h, c], i) => <rect key={i} x={a} y={b} width={w} height={h} className={c} />)}</g>
);
const FIRE: Px[] = [[7, 1, 2, 2, "fx1"], [6, 3, 4, 3, "fx1"], [5, 6, 6, 4, "fx1"], [6, 6, 4, 3, "fx2"], [7, 8, 2, 2, "fx3"], [4, 10, 8, 2, "fx1"], [10, -4, 3, 3, "smk"], [12, -9, 4, 4, "smk"]];
const LAMP: Px[] = [[7, 4, 2, 10, "pst"], [5, 14, 6, 2, "pst"], [5, 1, 6, 4, "lmp"], [6, 0, 4, 1, "pst"]];
const PUFFS: [number, number, number, number][] = [[4, 4, 8, 4], [2, 8, 22, 6], [12, 2, 8, 6], [0, 10, 26, 4]];
const CLOUD: Px[] = [...PUFFS.map(([x, y, w, h]): Px => [x - 1, y - 1, w + 2, h + 2, "clo"]), ...PUFFS.map(([x, y, w, h]): Px => [x, y, w, h, "cl"])];
const STORM: Px[] = CLOUD.map((c): Px => [c[0], c[1], c[2], c[3], c[4] === "cl" ? "cl storm" : "clo"]);
const RAIN: Px[] = [[4, 16, 1, 3, "rn"], [3, 20, 1, 3, "rn"], [11, 16, 1, 3, "rn"], [10, 20, 1, 3, "rn"], [18, 16, 1, 3, "rn"], [17, 20, 1, 3, "rn"], [14, 14, 2, 3, "bolt"], [13, 17, 2, 2, "bolt"], [12, 19, 2, 3, "bolt"]];
const flag = (cls: string): Px[] => [[0, -13, 1, 13, "pole"], [1, -13, 7, 5, cls], [1, -8, 4, 0.01, cls]];
const SITE: Px[] = [[2, 9, 12, 6, "dirt"]];

/** One tile. Drawn a hair larger than its cell so neighbours overlap: at a fractional scale, edge-to-edge tiles leave
 * anti-aliased seams. */
const OV = 0.5;
function Sprite({ t, x, y }: { t: string; x: number; y: number }) {
  return <use href={`#vt-${t}`} x={x * S} y={y * S} width={S + OV} height={S + OV} />;
}
const tilesOf = (ts: Tile[]) => ts.map((t, i) => <Sprite key={i} t={t.t} x={t.x} y={t.y} />);

/** The sprite sheet: one symbol per tile used, cut from the packed tilemaps, and the two ground patterns. */
export function VillageDefs({ keys }: { keys: Set<string> }) {
  return (
    <svg className="vw-defs" width="0" height="0" aria-hidden="true" focusable="false">
      <defs>
        {[...keys].sort().map((k) => {
          const sh = SHEETS[k.slice(0, 2)], i = Number(k.slice(2));
          return (
            <symbol key={k} id={`vt-${k}`} viewBox="0 0 16 16">
              <image href={sh.src} x={-(i % sh.cols) * (S + 1)} y={-Math.floor(i / sh.cols) * (S + 1)} width={sh.w} height={sh.h} />
            </symbol>
          );
        })}
        <pattern id="vt-forest" width={S * 3} height={S * 2} patternUnits="userSpaceOnUse">
          {[["tt19", 0, 0], ["tt19", 1, 0], ["tt28", 2, 0], ["tt16", 0, 1], ["tt19", 1, 1], ["tt19", 2, 1]].map(([t, x, y]) => <use key={`${x}${y}`} href={`#vt-${t}`} x={+x * S} y={+y * S} width={S} height={S} />)}
        </pattern>
 <filter id="vt-mist" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="5" /></filter>
        <filter id="vt-night" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
          <feFlood className="vt-flood" result="f" />
          <feBlend in="SourceGraphic" in2="f" mode="multiply" result="b" />
          <feComposite in="b" in2="SourceAlpha" operator="in" />
        </filter>
      </defs>
    </svg>
  );
}

// ---- One village: tiles below (tinted at night), marks and links above. ----

type Placed = { v: Village; plan: VillagePlan; k: number };

function villageTiles({ v, plan }: Placed, stop: boolean, today: string): { tiles: ReactNode } {
  const extra: Tile[] = [];
  for (const p of plan.road) extra.push({ x: p.x, y: p.y, t: "tt40" });
  if (plan.sign) extra.push({ x: plan.sign.x, y: plan.sign.y, t: "tt40" }, { x: plan.sign.x, y: plan.sign.y, t: "tt83" });
  const sites = Math.min(v.open, MAX_SITES);
  plan.sites.slice(0, sites).forEach((p) => extra.push({ x: p.x, y: p.y, t: "tt107" }));
  const lot = (key: PartKey) => plan.parts.find((p) => p.key === key)!;
  for (const key of ["police", "bank", "shop", "workshop"] as PartKey[]) { const p = lot(key); if (!p.built) extra.push({ x: p.rect.x, y: p.rect.y, t: "tt83" }); }
  const homes = lot("homes");
  if (!homes.built) for (const s of homes.slots || []) extra.push({ x: s.x, y: s.y, t: "tt83" });
  const tiles = (
    <g key={v.id} className={`vt${v.fog ? " fogged" : ""}`} data-vil={v.id}>
      {tilesOf(plan.ground)}
      {plan.parts.map((p) => <g key={p.key} data-part={p.key} {...(p.key === "hall" ? { "data-since": v.hall.since } : {})}>{tilesOf(p.tiles)}</g>)}
      {tilesOf(extra)}
      {plan.road.length > 0 && v.trail && (() => {
        const steps = sample(v.trail.steps, MAX_STONES), pts = alongRoad(plan.road, steps.length);
        const passed = steps.filter((x) => x.due < today).length, a = pts[passed], b = pts[passed + 1] || a;
        return <use href="#vt-tt57" x={((a.x + b.x) / 2) * S - 2} y={((a.y + b.y) / 2) * S - 2} width={12} height={12} />;
      })()}
      {stop && plan.sign && <use href="#vt-td85" x={(plan.sign.x + (plan.right ? -0.55 : 0.55)) * S} y={plan.sign.y * S - 7} width={S} height={S} />}
    </g>
  );
  return { tiles };
}

function Stone({ p, state }: { p: Pt; state: Step["state"] }) {
  const x = p.x * S + S / 2, y = p.y * S + S / 2;
  return state === "late"
    ? <path className="stone st-late" d={`M${x - 2.5} ${y - 2.5}l5 5m0 -5l-5 5`} />
    : <rect className={`stone st-${state}`} x={x - 2.5} y={y - 2.5} width={5} height={5} />;
}

function villageMarks({ v, plan }: Placed, today: string): ReactNode {
  const part = (key: PartKey) => plan.parts.find((p) => p.key === key)!;
  const hall = part("hall").rect, police = part("police"), bank = part("bank"), shop = part("shop"), ws = part("workshop"), homes = part("homes");
  const sites = Math.min(v.open, MAX_SITES), lamps = Math.min(v.dueSoon, MAX_LAMPS), fires = Math.min(v.overdue, MAX_FIRES);
  const out: ReactNode[] = [];
  // Hall: the review flag on the roof, fire on its roof tiles (overdue work), lamps on the square (due soon).
  if (v.review) out.push(px((hall.x + hall.w / 2) * S - 1, hall.y * S + 2, flag(`fl v-${v.review.verdict || "none"}`), "flag"));
  if (v.hall.tier === "town") out.push(px((hall.x + 2) * S + 4, (hall.y + 1) * S - 3, [[0, 0, 8, 8, "clk"], [3, 1, 1, 4, "clh"], [3, 4, 3, 1, "clh"]], "clock"));
  for (let i = 0; i < fires; i++) out.push(px((hall.x + [0, hall.w - 1, 1][i]) * S, (hall.y + (i === 2 ? 1 : 0)) * S - 4, FIRE, `fire${i}`));
  for (let i = 0; i < lamps; i++) out.push(px(plan.lamps[i].x * S, plan.lamps[i].y * S - 4, LAMP, `lamp${i}`));
  if (v.open > sites) out.push(<text key="more" className="vt-count" x={(plan.core.x + 6) * S - 2} y={(plan.core.y + 5) * S - 3} textAnchor="end">+{v.open - sites}</text>);
  // Lit windows (dark mode only): the hall, the shop, the houses.
  out.push(<g key="lit" className="lit">
    {px(hall.x * S, (hall.y + hall.h - 1) * S, [[5, 5, 6, 5, "win"]])}
    {shop.built && px(shop.rect.x * S, (shop.rect.y + 1) * S, [[5, 5, 6, 5, "win"]])}
    {homes.built && (homes.slots || []).map((s, i) => px(s.x * S, s.y * S, [[7, 10, 2, 2, "win"]], i))}
  </g>);
  // Police: a light on the roof (calm, amber, red with smoke).
  if (v.police.built) {
    const lv = v.police.level, x = (police.rect.x + 1) * S - 3, y = police.rect.y * S;
    out.push(px(x, y, [[0, 1, 6, 3, `sir sir-${lv}`], [1, 0, 4, 1, `sir sir-${lv}`], ...(lv === "red" ? [[6, -6, 3, 3, "smk"], [8, -11, 4, 4, "smk"]] as Px[] : [])], "siren"));
  }
  // Bank: coins on the step (log of monthly revenue), a red cost sign when costs aren't covered.
  if (v.bank.built) {
    const x = bank.rect.x * S, y = (bank.rect.y + 2) * S;
    out.push(px(x, y, Array.from({ length: v.bank.coins }, (_, i): Px => [2 + i * 5, -4, 4, 3, "coin"]), "coins"));
    if (v.bank.costSign) out.push(px(x + 2 * S - 7, y - 13, [[0, 0, 8, 6, "csign"], [2, 2.5, 4, 1, "csign-m"], [3.5, 6, 1, 4, "pole"]], "cost"));
  }
  // Shop: the awning (lit when growing, dim when flat), a closed sign when declining.
  if (v.shop.built) {
    const tr = v.shop.trend, x = shop.rect.x * S, y = (shop.rect.y + 1) * S;
    out.push(px(x, y, Array.from({ length: 8 }, (_, i): Px => [i * 4, 0, 4, 4, `awn ${tr === "up" ? "awn-on" : "awn-off"}${i % 2 ? " alt" : ""}`]), "awning"));
    if (tr === "down") out.push(px(x + 9, y + 6, [[0, 0, 12, 5, "board"], [2, 2, 8, 1, "board-x"]], "closed"));
  }
  // Workshop: smoke and a glow while a build runs, parcels for pull requests waiting, a cracked sign for a stopped build.
  if (v.workshop.built) {
    const w = v.workshop, x = ws.rect.x * S, y = ws.rect.y * S;
    if (w.running) out.push(px(x + S + 4, y - 6, [[0, 0, 3, 3, "smk"], [2, -5, 4, 4, "smk"], [-14 + 0, 22, 5, 4, "glow"]], "smoke"));
    for (let i = 0; i < Math.min(3, w.waiting); i++) out.push(px(x + 1 + i * 7, y + 2 * S - 7, [[0, 0, 6, 6, "parcel"], [2.5, 0, 1, 6, "parcel-t"]], `pr${i}`));
    if (w.waiting > 3) out.push(<text key="prmore" className="vt-count" x={x + 20} y={y + 2 * S + 6}>+{w.waiting - 3}</text>);
    if (w.failed.length) out.push(px(x + 2, y + S + 2, [[0, 0, 9, 6, "board"], [2, 1, 1, 1, "board-x"], [3, 2, 1, 1, "board-x"], [4, 3, 1, 1, "board-x"], [5, 4, 1, 1, "board-x"], [6, 1, 1, 1, "board-x"], [2, 4, 1, 1, "board-x"]], "failed"));
  }
  // The deadline road: stones in due-date order, the flag at the signpost.
  if (plan.road.length && v.trail) {
    const steps = sample(v.trail.steps, MAX_STONES), pts = alongRoad(plan.road, steps.length);
    out.push(<g key="stones">{steps.map((s, i) => <Stone key={s.id} p={pts[i + 1]} state={s.state} />)}</g>);
    if (plan.sign) out.push(px(plan.sign.x * S + (plan.right ? 12 : 3), plan.sign.y * S + 6, flag("fl dl"), "dlflag"));
  }
  return <g key={v.id} className="vm" data-c={v.color} data-vil={v.id}>{out}</g>;
}

function villageSky({ v, plan }: Placed): ReactNode {
  const wx = weatherFor(v.review?.verdict);
  const r = plan.ring;
  return <g key={v.id}>
    {v.fog && <rect className="fogbank" x={r.x * S} y={r.y * S} width={r.w * S} height={r.h * S} rx={6} filter="url(#vt-mist)" />}
    {(wx === "storm" || wx === "cloud") && px((r.x + r.w - 3) * S, (r.y - 1) * S + 4, wx === "storm" ? [...STORM, ...RAIN] : CLOUD, "wx")}
  </g>;
}

function villageLinks({ v, plan, k }: Placed, mode: string): ReactNode {
  const r = plan.ring, name = short(v.name, v.top ? 24 : 20), fs = v.top ? 10 : 8.5;
  const bw = Math.max(40, name.length * fs * 0.58 + 12), bh = fs + 7, lx = plan.label.x * S, ly = plan.label.y * S + 5;
  return (
    <g key={v.id} className={`vl${v.fog ? " fogged" : ""}`} data-c={v.color}>
      <a href={`/p/${encodeURIComponent(v.id)}`} className="vlink" data-h={`${mode}-${k}-v`} aria-label={regionLabel(v)}>
        <title>{regionLabel(v)}</title>
        <rect className="hit" x={r.x * S} y={r.y * S} width={r.w * S} height={r.h * S} rx={4} />
        <g className={`board${v.top ? " top" : ""}`}>
          <rect className="bd-post" x={lx - 1} y={ly - bh + 2} width={2} height={bh + 6} />
          <rect className="bd" x={lx - bw / 2} y={ly - bh} width={bw} height={bh} rx={2} />
          <rect className="bd-c" x={lx - bw / 2} y={ly - bh} width={3} height={bh} />
          <text className="bd-t" x={lx + 1.5} y={ly - bh / 2 + fs * 0.36} textAnchor="middle" fontSize={fs}>{name}</text>
        </g>
      </a>
      {plan.parts.map((p) => {
        const label = partLabel(v, p.key), b = p.rect;
        return (
          <a key={p.key} href={partHref(v, p.key)} className={`plink p-${p.key}`} data-h={`${mode}-${k}-${p.key}`} aria-label={label}>
            <title>{label}</title>
            <rect className="hit" x={b.x * S - 1} y={b.y * S - 1} width={b.w * S + 2} height={b.h * S + 2} rx={2} />
          </a>
        );
      })}
    </g>
  );
}

// ---- Hover / focus cards. ----

function cardPos(rect: Rect, W: number, H: number) {
  const x = (rect.x + rect.w / 2) / W, top = rect.y / H, bottom = (rect.y + rect.h) / H;
  const up = (top + bottom) / 2 > 0.55;
  return { side: x < 0.25 ? "al" : x > 0.75 ? "ar" : "ac", up, style: { left: `${(x * 100).toFixed(2)}%`, top: `${((up ? top : bottom) * 100).toFixed(2)}%` } };
}

function VillageCard({ v, stop }: { v: Village; stop: boolean }) {
  const t = v.trail;
  const quiet = v.quietDays === null ? "Nothing finished yet" : `Quiet for ${n(v.quietDays, "day")}: nothing finished`;
  return <>
    <div className="rg-h"><i className="dot" /><b className="rg-n">{v.name}</b>{stop && <span className="pill you">Next stop</span>}{v.fog && <span className="pill">Fog</span>}</div>
    <dl className="rg-s">
      <div><dt>Open</dt><dd>{v.open}</dd></div>
      <div className={v.overdue ? "bad" : undefined}><dt>Overdue</dt><dd>{v.overdue}</dd></div>
      <div><dt>Due in 7 days</dt><dd>{v.dueSoon}</dd></div>
      <div><dt>Done, 28 days</dt><dd>{v.done28}{v.done28 > 0 && <small> · {v.onTime28} on time</small>}</dd></div>
    </dl>
    <p className="rg-g">Cleared ground, last {LAND_DAYS} days: {v.land.onTime} on time, {v.land.late} late, {v.land.undated} undated</p>
    {t ? <p className="rg-g"><b>{t.deadline.label}</b> <span className="mono">{fmtDate(t.deadline.date)} · {until(t.daysLeft)}</span>
      {t.total ? <> · <b className="mono">{t.pct}%</b> ground taken ({t.onTime} of {t.total} on time{t.late ? `, ${t.late} late` : ""})</> : " · no item due by then yet"}</p>
      : <p className="rg-g muted">No deadline ahead</p>}
    {v.review ? <div className="rg-r">{v.review.verdict && <span className={`verdict v-${v.review.verdict}`}>{v.review.verdict.replace("-", " ")}</span>}
      <span className="rg-hl">{v.review.headline || "Latest review has no headline"}</span></div>
      : <p className="rg-g muted">No project review yet</p>}
    {v.fog && <p className="rg-fog">{quiet}</p>}
  </>;
}

function PartCard({ v, k }: { v: Village; k: PartKey }) {
  const head = (title: string, what: string) => <div className="rg-h"><i className="dot" /><b className="rg-n">{title}</b><span className="vc-what">{what}</span></div>;
  switch (k) {
    case "hall": return <>
      {head(`${v.name} ${TIER[v.hall.tier]}`, "Checklist")}
      <p className="rg-g"><b className="mono">{v.onTimeAll}</b> items done on time in all{v.hall.next ? `: it grows at ${v.hall.next}` : ""} (hall at {HALL}, town hall at {TOWN_HALL})</p>
      <p className="rg-g">{n(v.open, "open item")} (crates on the square){v.overdue ? <>, <span className="bad">{v.overdue} overdue</span> (fire on the roof)</> : ""}, {v.dueSoon} due in {SOON_DAYS} days (lamp posts)</p>
      {v.review ? <div className="rg-r">{v.review.verdict && <span className={`verdict v-${v.review.verdict}`}>{v.review.verdict.replace("-", " ")}</span>}<span className="rg-hl">{v.review.headline || "Latest review has no headline"}</span></div>
        : <p className="rg-g muted">No project review yet: no flag</p>}
    </>;
    case "police": return <>
      {head(`${v.name} police station`, "Security")}
      {v.police.built ? <>
        <p className="rg-g">Light: <b>{LEVEL[v.police.level]}</b></p>
        <ul className="vc-list">{v.police.checks.map((c, i) => <li key={i}><span className="mono">{fmtDate(c.date)}</span> {c.type === "security" ? "Security audit" : "Screening"}{c.verdict ? <> · <span className={`verdict v-${c.verdict}`}>{c.verdict.replace("-", " ")}</span></> : null}{c.critical ? ` · ${c.critical} critical` : ""}{c.fail ? ` · ${c.fail} to fix` : ""}</li>)}</ul>
      </> : <p className="rg-g muted">Empty lot: no security audit or screening yet. Run one from Docs and reviews to build it.</p>}
    </>;
    case "bank": return <>
      {head(`${v.name} bank`, "Finances")}
      {v.bank.built ? <>
        <p className="rg-g">{costWords(v.bank).replace(/^c/, "C")}</p>
        <p className="rg-g">{revWords(v.bank).replace(/^./, (c) => c.toUpperCase())}{v.bank.coins ? ` · ${n(v.bank.coins, "coin")} on the step` : ""}</p>
        {v.bank.costSign && <p className="rg-g bad">Red sign: revenue doesn&apos;t cover the costs</p>}
      </> : <p className="rg-g muted">Empty lot: no recurring costs or revenue recorded yet.</p>}
    </>;
    case "shop": return <>
      {head(`${v.name} shop`, "Growth")}
      {v.shop.built ? <p className="rg-g">{METRIC[v.shop.metric] || v.shop.metric} <span className="mono">{fmtN(v.shop.first.value)}</span> ({fmtDate(v.shop.first.date)}) to <span className="mono">{fmtN(v.shop.last.value)}</span> ({fmtDate(v.shop.last.date)}): <b>{v.shop.trend === "up" ? "growing, awning lit" : v.shop.trend === "down" ? "declining, closed sign" : "flat, awning dim"}</b></p>
        : <p className="rg-g muted">Empty lot: no product metrics in the last {TREND_DAYS} days ({SHOP_METRICS.map((m) => METRIC[m].toLowerCase()).join(", ")}).</p>}
    </>;
    case "homes": return <>
      {head(`${v.name} houses`, "Customers")}
      {v.homes.built ? <p className="rg-g">{METRIC[v.homes.metric]} <b className="mono">{fmtN(v.homes.count)}</b>: {n(v.homes.houses, "house")} (one from 1, two from 10, three from 100, and so on)</p>
        : <p className="rg-g muted">Lots for sale: no user count recorded yet.</p>}
    </>;
    case "workshop": return <>
      {head(`${v.name} workshop`, "Claude's builds")}
      {v.workshop.built ? <>
        <p className="rg-g">{buildWords(v.workshop).replace(/^./, (c) => c.toUpperCase())}{v.workshop.prUrl ? ": opens the pull request" : ""}</p>
        {v.workshop.failed.length > 0 && <ul className="vc-list">{v.workshop.failed.slice(0, 3).map((f) => <li key={f.id}><span className="mono">{f.id}</span> {f.title}{f.note ? `: ${short(f.note, 90)}` : ""}</li>)}</ul>}
      </> : <p className="rg-g muted">Empty lot: no code repository found for this project, so Claude can&apos;t build here yet.</p>}
    </>;
  }
}

function Cards({ placed, stop, mode, W, H }: { placed: Placed[]; stop: string | null; mode: string; W: number; H: number }) {
  return <>{placed.flatMap(({ v, plan, k }) => [
    (() => { const c = cardPos(plan.ring, W, H); return <div key={`${k}-v`} className={`vcard ${c.side}${c.up ? " up" : ""}`} data-h={`${mode}-${k}-v`} data-c={v.color} style={c.style} aria-hidden="true"><VillageCard v={v} stop={v.id === stop} /></div>; })(),
    ...plan.parts.map((p) => { const c = cardPos(p.rect, W, H); return <div key={`${k}-${p.key}`} className={`vcard ${c.side}${c.up ? " up" : ""}`} data-h={`${mode}-${k}-${p.key}`} data-c={v.color} style={c.style} aria-hidden="true"><PartCard v={v} k={p.key} /></div>; }),
  ])}</>;
}

// ---- A world (the wide map, or one village's patch on a narrow screen). ----

function inputOf(v: Village): VillageInput {
  return { id: v.id, weight: v.land.weight, tier: v.hall.tier, houses: v.homes.built ? v.homes.houses : 0, deadline: !!v.trail,
    built: { police: v.police.built, bank: v.bank.built, shop: v.shop.built, workshop: v.workshop.built } };
}

function WorldSvg({ villages, stop, today, mode, cols, maxWeight, index = 0 }: { villages: Village[]; stop: string | null; today: string; mode: string; cols: number; maxWeight: number; index?: number }) {
  const narrow = cols === 1 && villages.length === 1;
  const busy = new Set(villages.filter((v) => v.workshop.built && v.workshop.running).map((v) => v.id));
  const world = buildWorld(villages.map(inputOf), { cols, central: narrow ? 0 : 3, river: !narrow, border: narrow ? 0 : 1, maxWeight, busy, seed: hash(villages.map((v) => v.id).join("|")) });
  const W = world.w * S, H = world.h * S;
  const placed: Placed[] = world.villages.map((plan, i) => ({ v: villages[i], plan, k: index + i }));
  const forest = world.forest.map((r) => `M${r.x * S} ${r.y * S}h${r.w * S}v${r.h * S}h${-r.w * S}Z`).join("");
  const vt = placed.map((p) => villageTiles(p, p.v.id === stop, today));
  const hover = placed.flatMap(({ plan, k }) => [`${k}-v`, ...plan.parts.map((p) => `${k}-${p.key}`)])
    .map((h) => `.vw-${mode}:has([data-h="${mode}-${h}"]:is(:hover,:focus-visible)) .vcard[data-h="${mode}-${h}"]`).join(",");
  return (
    <div className={`vw-l vw-${mode}`} style={{ maxWidth: `${W * 3}px` }}>
      <style>{`${hover}{display:flex}`}</style>
      <svg className="vw-svg" viewBox={`0 0 ${W} ${H}`} role="group" aria-label={narrow ? `${villages[0].name}: one village` : "Project map: one village per project"}>
        <g className="px" aria-hidden="true">
          <rect className="grass" x="0" y="0" width={W} height={H} />
          <path d={forest} fill="url(#vt-forest)" />
          {tilesOf(world.tiles)}
          {vt.map((x) => x.tiles)}
        </g>
        <g aria-hidden="true">
          {placed.map((p) => villageMarks(p, today))}
          {placed.map((p) => villageSky(p))}
        </g>
        {placed.map((p) => villageLinks(p, mode))}
      </svg>
      <Cards placed={placed} stop={stop} mode={mode} W={world.w} H={world.h} />
    </div>
  );
}

export default function Villages({ villages, stop, today, maxWeight }: { villages: Village[]; stop: string | null; today: string; maxWeight: number }) {
  return (
    <div className="vw">
      <VillageDefs keys={new Set(TILE_KEYS)} />
      <WorldSvg villages={villages} stop={stop} today={today} mode="wide" cols={colsFor(villages.length)} maxWeight={maxWeight} />
      <div className="vw-narrow">{villages.map((v, i) => <WorldSvg key={v.id} villages={[v]} stop={stop} today={today} mode={`n${i}`} cols={1} maxWeight={maxWeight} index={i} />)}</div>
    </div>
  );
}

// ---- The legend: every building and every mark, drawn small, with what drives it. ----

function Mini({ w, h, children }: { w: number; h: number; children: ReactNode }) {
  return <svg className="vk-i" width={w * 18} height={h * 18} viewBox={`0 0 ${w * S} ${h * S}`} aria-hidden="true">{children}</svg>;
}
const rows = (rs: string[][]) => rs.flatMap((r, j) => r.map((t, i) => <Sprite key={`${i}-${j}`} t={t} x={i} y={j} />));

export function VillageLegend() {
  return (
    <div className="vw-key">
      <ul className="vk" aria-label="What the buildings stand for">
        <li><Mini w={3} h={3}>{rows([["tt48", "tt51", "tt50"], ["tt60", "tt63", "tt62"], ["tt88", "tt89", "tt91"]])}</Mini><span><b>Town hall</b>: the checklist. Grows with items done on time (hall at {HALL}, town hall at {TOWN_HALL}); its flag is the latest review</span></li>
        <li><Mini w={2} h={2}>{rows([["tt48", "tt50"], ["tt88", "tt89"]])}{px(13, 0, [[0, 1, 6, 3, "sir sir-amber"]])}</Mini><span><b>Police station</b>: security audits and screenings. Light calm, amber or red</span></li>
        <li><Mini w={2} h={2}>{rows([["tt52", "tt54"], ["tt103", "tt79"]])}{px(0, 32, [[2, -4, 4, 3, "coin"], [7, -4, 4, 3, "coin"]])}</Mini><span><b>Bank</b>: costs and revenue. Coins grow with revenue; a red sign when it doesn&apos;t cover costs</span></li>
        <li><Mini w={2} h={2}>{rows([["tt52", "tt54"], ["tt84", "tt85"]])}{px(0, 16, Array.from({ length: 8 }, (_, i): Px => [i * 4, 0, 4, 4, `awn awn-on${i % 2 ? " alt" : ""}`]))}</Mini><span><b>Shop</b>: growth (visitors, signups, active users over {TREND_DAYS} days). Lit, dim or closed</span></li>
        <li><Mini w={3} h={2}>{rows([["tt67", "tt67", "tt67"], ["tt86", "tt86", "tt86"]])}</Mini><span><b>Houses</b>: customers. One house from 1 user, two from 10, three from 100</span></li>
        <li><Mini w={2} h={2}>{rows([["tt52", "tt55"], ["tt73", "tt86"]])}{px(1, 25, [[0, 0, 6, 6, "parcel"], [2.5, 0, 1, 6, "parcel-t"]])}</Mini><span><b>Workshop</b>: Claude&apos;s builds. Smoke while one runs, a parcel per pull request waiting, a cracked sign when one stopped</span></li>
        <li><Mini w={2} h={2}>{rows([["tt12", "tt14"], ["tt36", "tt38"]])}<Sprite t="tt83" x={0} y={0} /></Mini><span><b>Empty lot</b>: nothing recorded yet, not a failure</span></li>
      </ul>
      <ul className="vk" aria-label="What the marks mean">
        <li><Mini w={1} h={1}><Sprite t="tt0" x={0} y={0} /><Sprite t="tt107" x={0} y={0} /></Mini>Open item (+N: more than drawn)</li>
        <li><Mini w={1} h={1}>{px(0, 0, LAMP)}</Mini>Due in {SOON_DAYS} days</li>
        <li><Mini w={1} h={1.3}>{px(0, 9, FIRE)}</Mini>Overdue</li>
        <li><Mini w={1} h={1}>{px(4, 15, flag("fl v-on-track"))}</Mini>Latest review</li>
        <li><Mini w={2} h={1.6}>{px(2, 0, [...STORM, ...RAIN])}</Mini>Off track (a light cloud: at risk)</li>
        <li><Mini w={2} h={1}><g className="vt fogged"><Sprite t="tt0" x={0} y={0} /><Sprite t="tt0" x={1} y={0} /><Sprite t="tt16" x={0} y={0} /><Sprite t="tt104" x={1} y={0} /></g><rect className="fogbank" x={0} y={0} width={32} height={16} rx={3} /></Mini>Fog: nothing finished for {FOG_DAYS} days</li>
        <li><Mini w={3} h={1}><Sprite t="tt40" x={0} y={0} /><Sprite t="tt40" x={1} y={0} /><Sprite t="tt40" x={2} y={0} /><Stone p={{ x: 0, y: 0 }} state="on-time" /><Stone p={{ x: 0.7, y: 0 }} state="late" /><Stone p={{ x: 1.4, y: 0 }} state="open" />{px(40, 14, flag("fl dl"))}</Mini>Road to the next deadline: on time, late, open</li>
        <li><Mini w={1} h={1}><use href="#vt-tt57" x={2} y={2} width={12} height={12} /></Mini>Today</li>
        <li><Mini w={1} h={1}><Sprite t="td85" x={0} y={0} /></Mini>You: the next stop, the nearest deadline</li>
      </ul>
      <p className="vk-credit">Pixel tiles: Kenney (CC0)</p>
    </div>
  );
}
