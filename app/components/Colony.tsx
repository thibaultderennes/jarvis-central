// The colony map: every project a walled settlement on one frontier map (server-drawn SVG; ColonyStage adds the camera,
// selection and the command panel). What you see is driven by the same Village data as the other looks:
// town hall tier = items ever done on time, fields = items done on time in the last 28 days, villagers = recent activity,
// crates = open items (amber due this week, red overdue), fire = overdue, watchtower beacon = security, market = growth,
// vault = money, parcels = pull requests waiting, mist = nothing finished lately, stone ground and a shut gate = paused.
import type { ReactNode } from "react";
import { partChip, partHref, plotStatus, type Village } from "@/components/Villages";
import { Box, Roof, Tree, P, pts, TW, TH, ZH, PLOT, GAP, NAME, ORDER } from "@/components/iso";
import ColonyStage, { type StageVillage } from "@/components/ColonyStage";
import { hash, landmarkFor, rng, SHIPMENTS, type PartKey, type Season, type Slot } from "@/lib/villages";
import { fmtDate } from "@/lib/time";

type El = { depth: number; el: ReactNode };
const until = (d: number) => (d === 0 ? "today" : d === 1 ? "tomorrow" : `in ${d} days`);
const quad = (a: readonly [number, number], b: readonly [number, number], c: readonly [number, number], d: readonly [number, number]) => pts(a, b, c, d);

function Gable({ x, y, w, d, z, h, c }: { x: number; y: number; w: number; d: number; z: number; h: number; c: string }) {
  const o = 0.12;
  return (
    <g className={c}>
      <polygon className="f-r" points={pts(P(x + w + o, y - o, z), P(x + w + o, y + d + o, z), P(x + w + o, y + d / 2, z + h))} />
      <polygon className="f-t" points={quad(P(x - o, y + d + o, z), P(x + w + o, y + d + o, z), P(x + w + o, y + d / 2, z + h), P(x - o, y + d / 2, z + h))} />
    </g>
  );
}
const Shadow = ({ x, y, w, d, h }: { x: number; y: number; w: number; d: number; h: number }) => (
  <polygon className="shade" points={quad(P(x + h * 0.55, y + h * 0.2), P(x + w + h * 0.55, y + h * 0.2), P(x + w + h * 0.55, y + d + h * 0.2), P(x + h * 0.55, y + d + h * 0.2))} />
);
/** A window on the face looking left-front (side "l", along x) or right-front (side "r", along y). */
const Win = ({ x, y, u, z, side }: { x: number; y: number; u: number; z: number; side: "l" | "r" }) => (
  <polygon className="win" points={side === "l" ? quad(P(x + u, y, z + 0.45), P(x + u + 0.4, y, z + 0.45), P(x + u + 0.4, y, z), P(x + u, y, z)) : quad(P(x, y + u, z + 0.45), P(x, y + u + 0.4, z + 0.45), P(x, y + u + 0.4, z), P(x, y + u, z))} />
);
const Door = ({ x, y }: { x: number; y: number }) => <polygon className="door" points={quad(P(x - 0.28, y, 0.72), P(x + 0.28, y, 0.72), P(x + 0.28, y, 0), P(x - 0.28, y, 0))} />;
function Smoke({ x, y, z, busy }: { x: number; y: number; z: number; busy?: boolean }) {
  const [sx, sy] = P(x, y, z);
  return <g className={`smoke${busy ? " busy" : ""}`}>{[0, 1, 2].map((i) => <circle key={i} cx={sx} cy={sy} r={busy ? 5 : 3.5} style={{ animationDelay: `${-i * 1.3}s` }} />)}</g>;
}
function Fire({ x, y, z }: { x: number; y: number; z: number }) {
  const [sx, sy] = P(x, y, z);
  return <g className="fire"><polygon className="fl1" points={`${sx - 6},${sy} ${sx - 2},${sy - 16} ${sx + 1},${sy - 8} ${sx + 4},${sy - 20} ${sx + 7},${sy}`} /><polygon className="fl2" points={`${sx - 3},${sy} ${sx},${sy - 9} ${sx + 4},${sy}`} /></g>;
}
function Walker({ from, to, dur, delay, c, thought }: { from: readonly [number, number]; to: readonly [number, number]; dur: number; delay: number; c: string; thought: string }) {
  return (
    <g className="walker" data-tip={`“${thought}”`}>
      <animateMotion dur={`${dur}s`} begin={`${-delay}s`} repeatCount="indefinite" path={`M${from[0]} ${from[1]} L${to[0]} ${to[1]} L${from[0]} ${from[1]}`} />
      <ellipse className="shade" cx={0} cy={0} rx={3} ry={1.4} /><rect className={`body ${c}`} x={-1.8} y={-9} width={3.6} height={7} rx={1} /><circle className="head" cx={0} cy={-11} r={2.2} />
    </g>
  );
}

type V2 = readonly [number, number];
type Tone = "bad" | "warn" | "ok" | "none";
export const LENSES = ["deadlines", "activity", "money", "security", "growth"] as const;
export type Lens = (typeof LENSES)[number];
const Ln = ({ a, b, c }: { a: V2; b: V2; c: string }) => <line className={c} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} />;
/** Shingle rows on a gable's front slope, and its ridge. */
const shingles = (x: number, y: number, w: number, d: number, z: number, h: number) => [0.3, 0.6, 1].map((t) => <Ln key={`sg${t}`} c={t === 1 ? "ridge" : "shingle"} a={P(x - 0.12, y + d + 0.12 - (d / 2 + 0.12) * t, z + h * t)} b={P(x + w + 0.12, y + d + 0.12 - (d / 2 + 0.12) * t, z + h * t)} />);
/** A timber frame on the two faces you see: posts, a top beam and one brace. */
const timber = (x: number, y: number, w: number, d: number, z0: number, z1: number) => [
  <Ln key="tb1" c="timber" a={P(x, y + d, z1)} b={P(x + w, y + d, z1)} />, <Ln key="tb2" c="timber" a={P(x + w, y, z1)} b={P(x + w, y + d, z1)} />,
  ...[0.02, w / 3, (2 * w) / 3, w - 0.02].map((u) => <Ln key={`tl${u}`} c="timber" a={P(x + u, y + d, z0)} b={P(x + u, y + d, z1)} />),
  ...[d / 2].map((u) => <Ln key={`tr${u}`} c="timber" a={P(x + w, y + u, z0)} b={P(x + w, y + u, z1)} />),
  <Ln key="tbr" c="timber" a={P(x + w, y + d / 2, z0)} b={P(x + w, y + d - 0.05, z1)} />,
];
/** Plank seams on the left-front face. */
const planks = (x: number, y: number, w: number, z0: number, z1: number, n = 5) => Array.from({ length: n }, (_, i) => <Ln key={`pk${i}`} c="seam" a={P(x + ((i + 1) * w) / (n + 1), y, z0)} b={P(x + ((i + 1) * w) / (n + 1), y, z1)} />);
/** Mortar courses around a stone tower. */
const courses = (x: number, y: number, w: number, d: number, zs: number[]) => zs.flatMap((z) => [<Ln key={`ml${z}`} c="mortar" a={P(x, y + d, z)} b={P(x + w, y + d, z)} />, <Ln key={`mr${z}`} c="mortar" a={P(x + w, y, z)} b={P(x + w, y + d, z)} />]);
const Lamp = ({ x, y }: { x: number; y: number }) => { const a = P(x, y), b = P(x, y, 1.1); return <g className="lamp"><line className="pole" x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} /><circle className="glow" cx={b[0]} cy={b[1]} r={9} /><circle className="bulb" cx={b[0]} cy={b[1]} r={2.6} /></g>; };
const Barrel = ({ x, y }: { x: number; y: number }) => { const [sx, sy] = P(x, y); return <g className="barrel"><rect x={sx - 4} y={sy - 10} width={8} height={10} rx={2} /><ellipse cx={sx} cy={sy - 10} rx={4} ry={1.8} /><line x1={sx - 4} y1={sy - 6} x2={sx + 4} y2={sy - 6} /><line x1={sx - 4} y1={sy - 3} x2={sx + 4} y2={sy - 3} /></g>; };
function Wagon({ title, delay }: { title: string; delay: number }) {
  const a = P(-1.5, PLOT + 1.5), b = P(5, PLOT + 1.5), c = P(5, PLOT + 0.2), d = P(5, 7.7);
  return (
    <g className="wagon" data-part="hall" data-tip={`Just delivered: ${title}`}>
      <animateMotion dur="16s" begin={`${-delay}s`} repeatCount="indefinite" path={`M${a[0]} ${a[1]} L${b[0]} ${b[1]} L${c[0]} ${c[1]} L${d[0]} ${d[1]}`} keyTimes="0;0.45;0.6;1" keyPoints="0;0.55;0.68;1" calcMode="linear" />
      <animate attributeName="opacity" dur="16s" begin={`${-delay}s`} repeatCount="indefinite" values="0;1;1;0" keyTimes="0;0.06;0.9;1" />
      <ellipse className="shade" cx={2} cy={0} rx={12} ry={3} />
      <rect className="w-body" x={-8} y={-9} width={13} height={6} rx={1} /><rect className="w-cover" x={-7} y={-16} width={11} height={8} rx={4} />
      <circle className="w-wheel" cx={-5} cy={-2} r={2.8} /><circle className="w-wheel" cx={2} cy={-2} r={2.8} />
      <ellipse className="w-horse" cx={11} cy={-7} rx={4.5} ry={2.8} /><circle className="w-horse" cx={15.5} cy={-10} r={2} /><line className="w-leg" x1={9} y1={-5} x2={9} y2={-0.5} /><line className="w-leg" x1={13} y1={-5} x2={13} y2={-0.5} />
    </g>
  );
}
function Fireworks({ x, y, z }: { x: number; y: number; z: number }) {
  return <g className="fw" aria-hidden="true">{[0, 1, 2].map((j) => { const [sx, sy] = P(x + (j - 1) * 1.3, y, z + (j % 2) * 0.9); return (
    <g key={j} className={`burst b${j}`} style={{ animationDelay: `${j * 0.9}s`, transformOrigin: `${sx}px ${sy}px` }}>{Array.from({ length: 10 }, (_, i) => { const t = (i / 10) * Math.PI * 2; return <line key={i} x1={sx + Math.cos(t) * 4} y1={sy + Math.sin(t) * 4} x2={sx + Math.cos(t) * 15} y2={sy + Math.sin(t) * 15} />; })}</g>); })}</g>;
}

type Spot = { k: PartKey; x: number; y: number; w: number; d: number };
const SPOT: Record<Exclude<PartKey, "homes">, Spot> = {
  workshop: { k: "workshop", x: 0.9, y: 0.9, w: 2.4, d: 2 },
  police: { k: "police", x: 7.6, y: 1.1, w: 1.4, d: 1.4 },
  hall: { k: "hall", x: 3.6, y: 2.2, w: 3, d: 2.8 },
  bank: { k: "bank", x: 0.9, y: 6.5, w: 2.1, d: 2 },
  shop: { k: "shop", x: 7, y: 6.2, w: 2, d: 1.7 },
};

function part(v: Village, k: PartKey, x: number, y: number, w: number, d: number, depth: number, body: ReactNode, top: number): El {
  const chip = partChip(v, k), [mx, my] = P(x + w / 2, y + d / 2, top + 0.9);
  return { depth, el: (
    <g key={`${v.id}-${k}-${x}`} className="ib" role="button" tabIndex={-1} data-part={k} data-tip={`${NAME[k]}: ${chip.text}`} aria-label={`${v.name}, ${NAME[k]}: ${chip.text}`}>
      {body}
      {(chip.tone === "bad" || chip.tone === "warn") && <g className={`mk t-${chip.tone}`}><circle cx={mx} cy={my} r={8} /><text x={mx} y={my + 4} textAnchor="middle">!</text></g>}
    </g>
  ) };
}
const lot = (x: number, y: number, w: number, d: number) => <><polygon className="lot" points={quad(P(x, y), P(x + w, y), P(x + w, y + d), P(x, y + d))} /><line className="pole" x1={P(x + w / 2, y + d / 2)[0]} y1={P(x + w / 2, y + d / 2)[1]} x2={P(x + w / 2, y + d / 2, 0.6)[0]} y2={P(x + w / 2, y + d / 2, 0.6)[1]} /><rect className="sign" x={P(x + w / 2, y + d / 2, 0.9)[0] - 6} y={P(x + w / 2, y + d / 2, 0.9)[1] - 3} width={12} height={7} /></>;

/** One settlement, in its own coordinates (corner at 0,0). */
function settlement(v: Village, today: string): { ground: ReactNode; els: El[] } {
  const els: El[] = [], k = (s: string) => `${v.id}-${s}`, alive = !v.paused && v.done28 > 0, r = rng(hash(v.id));
  const shadows: ReactNode[] = [];
  const sh = (x: number, y: number, w: number, d: number, h: number) => shadows.push(<Shadow key={k(`sh${shadows.length}`)} x={x} y={y} w={w} d={d} h={h} />);
  const ev = v.events || [], fresh = ev.filter((e) => (e.kind === "done" || e.kind === "late") && Date.parse(e.at) > Date.now() - 48 * 3_600_000).slice(0, 3);
  const doneToday = ev.some((e) => e.kind === "done" && e.at.slice(0, 10) >= today), news = ev.find((e) => e.kind === "review");

  // Town hall: grows with items ever done on time. Fire on the roof for overdue work, a flag for the latest review.
  { const s = SPOT.hall, tier = v.hall.tier, h = tier === "small" ? 1.3 : 1.7, x = s.x, y = s.y, yF = y + s.d;
    sh(x, y, s.w, s.d, h + 1);
    const tower = tier !== "small", tx = x + s.w - 0.95, th = tier === "town" ? 3.7 : 2.8, top = tower ? th + 0.9 : h + 1.1;
    els.push(part(v, "hall", x, y, s.w, s.d, x + y + (s.w + s.d) / 2, <>
      <Box x={x - 0.18} y={y - 0.18} w={s.w + 0.36} d={s.d + 0.36} h={0.18} c="c-rock" />
      <Box x={x + 0.85} y={yF + 0.18} w={1.1} d={0.3} h={0.1} c="c-rock" />
      <Box x={x} y={y} w={s.w} d={s.d} h={h} z={0.18} c="c-wall" />
      {timber(x, y, s.w, s.d, 0.18, h + 0.18)}
      <Win x={x} y={yF} u={0.3} z={0.8} side="l" /><Win x={x} y={yF} u={2.25} z={0.8} side="l" /><Win x={x + s.w} y={y} u={0.45} z={0.8} side="r" /><Win x={x + s.w} y={y} u={1.85} z={0.8} side="r" />
      <polygon className="door" points={quad(P(x + 1, yF, 1.02), P(x + 1.8, yF, 1.02), P(x + 1.8, yF, 0.18), P(x + 1, yF, 0.18))} /><Ln c="seam" a={P(x + 1.4, yF, 1.02)} b={P(x + 1.4, yF, 0.18)} />
      <polygon className="pennant" points={quad(P(x + 0.72, yF, h), P(x + 0.95, yF, h), P(x + 0.95, yF, h - 0.6), P(x + 0.72, yF, h - 0.6))} />
      <Box x={x + 0.35} y={y + 0.45} w={0.36} d={0.36} h={1.1} z={h + 0.4} c="c-rock" />
      <Gable x={x} y={y} w={s.w} d={s.d} z={h + 0.18} h={1.05} c="c-pc" />{shingles(x, y, s.w, s.d, h + 0.18, 1.05)}
      {tower && <><Box x={tx} y={y + 0.15} w={0.95} d={0.95} h={th} c="c-wall" />{courses(tx, y + 0.15, 0.95, 0.95, [0.9, 1.8, th - 0.05])}
        <polygon className="door" points={quad(P(tx + 0.25, y + 1.1, th - 0.25), P(tx + 0.7, y + 1.1, th - 0.25), P(tx + 0.7, y + 1.1, th - 0.85), P(tx + 0.25, y + 1.1, th - 0.85))} />
        <circle className="coin" cx={P(tx + 0.475, y + 1.1, th - 0.6)[0]} cy={P(tx + 0.475, y + 1.1, th - 0.6)[1]} r={2.4} />
        <Roof x={tx} y={y + 0.15} w={0.95} d={0.95} z={th} h={0.95} c="c-pc" />
        {tier === "town" && <circle className="clock" cx={P(tx + 0.475, y + 1.1, th - 1.5)[0]} cy={P(tx + 0.475, y + 1.1, th - 1.5)[1]} r={3.8} />}</>}
      {(() => { const fz = tower ? th + 0.95 : h + 1.2, fx = tower ? tx + 0.475 : x + s.w / 2, fy = tower ? y + 0.62 : y + s.d / 2, a = P(fx, fy, fz), b = P(fx, fy, fz + 1.1); return <g><line className="pole" x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} /><polygon className={`flag v-${v.review?.verdict || "none"}`} points={`${b[0]},${b[1]} ${b[0] + 15},${b[1] + 4} ${b[0]},${b[1] + 9}`} /></g>; })()}
      {alive && <Smoke x={x + 0.53} y={y + 0.63} z={h + 1.55} />}
      {Array.from({ length: Math.min(3, v.overdue) }, (_, i) => <Fire key={i} x={x + 0.6 + i * 0.9} y={yF} z={h + 0.5} />)}
      {news && <g className="scroll" data-tip={`New review: ${news.text}`}>{(() => { const [sx, sy] = P(x - 0.2, yF, h + 0.9); return <><rect x={sx - 6} y={sy - 8} width={12} height={15} rx={2} /><line x1={sx - 3} y1={sy - 3} x2={sx + 3} y2={sy - 3} /><line x1={sx - 3} y1={sy} x2={sx + 3} y2={sy} /><line x1={sx - 3} y1={sy + 3} x2={sx + 1} y2={sy + 3} /></>; })()}</g>}
      {doneToday && <Fireworks x={x + s.w / 2} y={y + s.d / 2} z={top + 1.6} />}
    </>, top));
  }
  // Workshop: Claude's builds. Smoke and sparks while one runs, a parcel per pull request waiting.
  { const s = SPOT.workshop, x = s.x, y = s.y, yF = y + s.d, built = v.workshop.built, run = v.workshop.built && v.workshop.running > 0;
    if (built) sh(x, y, s.w, s.d, 1.6);
    els.push(part(v, "workshop", x, y, s.w, s.d, x + y + (s.w + s.d) / 2, built ? <>
      <Box x={x} y={y} w={s.w} d={s.d} h={1.05} c="c-plank" />{planks(x, yF, s.w, 0, 1.05, 6)}
      <polygon className="door" points={quad(P(x + 1.25, yF, 0.85), P(x + 2.15, yF, 0.85), P(x + 2.15, yF, 0), P(x + 1.25, yF, 0))} /><Win x={x} y={yF} u={0.3} z={0.4} side="l" /><Win x={x + s.w} y={y} u={0.8} z={0.4} side="r" />
      <Box x={x + 0.3} y={y + 0.3} w={0.4} d={0.4} h={1.15} z={1.05} c="c-clay" />
      <Gable x={x} y={y} w={s.w} d={s.d} z={1.05} h={0.8} c="c-wood" />{shingles(x, y, s.w, s.d, 1.05, 0.8)}
      {[0, 1, 2].map((i) => <Box key={`log${i}`} x={x + s.w + 0.2} y={y + 0.2 + (i === 2 ? 0.2 : i * 0.42)} w={1.1} d={0.36} h={0.3} z={i === 2 ? 0.3 : 0} c="c-wood" />)}
      <Box x={x + 0.4} y={yF + 0.35} w={0.5} d={0.3} h={0.32} c="c-iron" /><Box x={x + 0.3} y={yF + 0.3} w={0.7} d={0.4} h={0.1} z={0.32} c="c-iron" />
      {run && <><Smoke x={x + 0.5} y={y + 0.5} z={2.3} busy /><g className="sparks">{[0, 1, 2, 3].map((i) => <circle key={i} cx={P(x + 0.65, yF + 0.5, 0.5)[0]} cy={P(x + 0.65, yF + 0.5, 0.5)[1]} r={1.2} style={{ animationDelay: `${i * 0.22}s` }} className={`sp${i}`} />)}</g>
        {[0, 1.2, 2.4].map((u) => <Ln key={`sc${u}`} c="scaf" a={P(x + u, yF + 0.08, 0)} b={P(x + u, yF + 0.08, 1.7)} />)}<Ln c="scaf" a={P(x, yF + 0.08, 1.15)} b={P(x + 2.4, yF + 0.08, 1.15)} /><Ln c="scaf" a={P(x, yF + 0.08, 1.7)} b={P(x + 2.4, yF + 0.08, 1.7)} /></>}
      {v.workshop.built && Array.from({ length: Math.min(4, v.workshop.waiting) }, (_, i) => <g key={i}><Box x={x + 1.1 + i * 0.5} y={yF + 0.75} w={0.38} d={0.38} h={0.32} c="c-parcel" /><Ln c="seam" a={P(x + 1.29 + i * 0.5, yF + 0.75, 0.32)} b={P(x + 1.29 + i * 0.5, yF + 1.13, 0.32)} /></g>)}
    </> : lot(x, y, s.w, s.d), 2.2));
  }
  // Watchtower: security. Its beacon is calm, amber or red.
  { const s = SPOT.police, x = s.x, y = s.y, built = v.police.built, lvl = v.police.built ? v.police.level : "calm";
    if (built) sh(x, y, s.w, s.d, 3);
    const b = P(x + 0.7, y + 0.7, 2.95);
    els.push(part(v, "police", x, y, s.w, s.d, x + y + (s.w + s.d) / 2, built ? <>
      <Box x={x + 0.1} y={y + 0.1} w={1.2} d={1.2} h={0.25} c="c-rock" /><Box x={x + 0.2} y={y + 0.2} w={1} d={1} h={2.25} c="c-rock" />{courses(x + 0.2, y + 0.2, 1, 1, [0.6, 1.1, 1.6, 2.05])}
      <polygon className="door" points={quad(P(x + 0.5, y + 1.2, 0.75), P(x + 0.9, y + 1.2, 0.75), P(x + 0.9, y + 1.2, 0), P(x + 0.5, y + 1.2, 0))} />
      <polygon className="slit" points={quad(P(x + 0.64, y + 1.2, 1.75), P(x + 0.76, y + 1.2, 1.75), P(x + 0.76, y + 1.2, 1.25), P(x + 0.64, y + 1.2, 1.25))} /><polygon className="slit" points={quad(P(x + 1.2, y + 0.64, 1.75), P(x + 1.2, y + 0.76, 1.75), P(x + 1.2, y + 0.76, 1.25), P(x + 1.2, y + 0.64, 1.25))} />
      <Box x={x} y={y} w={s.w} d={s.d} h={0.22} z={2.25} c="c-plank" />
      {[[0, 0], [1.1, 0], [0, 1.1], [1.1, 1.1], [0.55, 1.1], [1.1, 0.55]].map(([u, w2]) => <Box key={`cr${u}${w2}`} x={x + u} y={y + w2} w={0.3} d={0.3} h={0.28} z={2.47} c="c-rock" />)}
      <circle className={`halo b-${lvl}`} cx={b[0]} cy={b[1]} r={11} /><circle className={`beacon b-${lvl}`} cx={b[0]} cy={b[1]} r={4} />
      {[0.42, 0.58].map((u) => <Ln key={`ld${u}`} c="timber" a={P(x + 0.2 + u * 0.5, y + 1.22, 0)} b={P(x + 0.2 + u * 0.5, y + 1.22, 2.25)} />)}
      <Box x={x + 0.25} y={y + 0.25} w={0.2} d={0.2} h={1.1} z={2.47} c="c-wood" /><Roof x={x + 0.1} y={y + 0.1} w={1.2} d={1.2} z={3.5} h={0.7} c="c-blue" />
    </> : lot(x, y, s.w, s.d), 4.2));
  }
  // Vault: money. Coin stacks on the steps when revenue is recorded.
  { const s = SPOT.bank, x = s.x, y = s.y, yF = y + s.d, built = v.bank.built;
    if (built) sh(x, y, s.w, s.d, 1.9);
    els.push(part(v, "bank", x, y, s.w, s.d, x + y + (s.w + s.d) / 2, built ? <>
      <Box x={x - 0.2} y={y - 0.1} w={s.w + 0.4} d={s.d + 0.75} h={0.12} c="c-rock" /><Box x={x - 0.1} y={y - 0.1} w={s.w + 0.2} d={s.d + 0.5} h={0.12} z={0.12} c="c-rock" />
      <Box x={x} y={y} w={s.w} d={s.d} h={1.3} z={0.24} c="c-wall" />{courses(x, y, s.w, s.d, [0.7, 1.15])}
      <polygon className="door vault" points={quad(P(x + 0.7, yF, 1.1), P(x + 1.4, yF, 1.1), P(x + 1.4, yF, 0.24), P(x + 0.7, yF, 0.24))} /><circle className="coin" cx={P(x + 1.05, yF, 0.68)[0]} cy={P(x + 1.05, yF, 0.68)[1]} r={2.2} />
      {[0.05, 0.6, 1.33, 1.88].map((u) => <g key={u}><Box x={x + u} y={yF + 0.12} w={0.17} d={0.17} h={1.2} z={0.24} c="c-snow" /><Box x={x + u - 0.04} y={yF + 0.08} w={0.25} d={0.25} h={0.1} z={1.44} c="c-rock" /></g>)}
      <polygon className="pedi" points={pts(P(x - 0.05, yF + 0.3, 1.54), P(x + s.w + 0.05, yF + 0.3, 1.54), P(x + s.w / 2, yF + 0.3, 2.15))} />
      <Gable x={x} y={y} w={s.w} d={s.d + 0.3} z={1.54} h={0.62} c="c-gold" />{shingles(x, y, s.w, s.d + 0.3, 1.54, 0.62)}
      {v.bank.built && Array.from({ length: v.bank.coins }, (_, i) => [0, 1, 2].slice(0, 1 + (i % 3)).map((j) => <ellipse key={`${i}${j}`} className="coin" cx={P(x + 0.3 + i * 0.42, yF + 0.95)[0]} cy={P(x + 0.3 + i * 0.42, yF + 0.95)[1] - 3 - j * 2.4} rx={4} ry={2.2} />))}
      {v.bank.built && v.bank.costSign && <g>{(() => { const [sx, sy] = P(x + s.w + 0.2, yF + 0.3, 0.9); return <><line className="pole" x1={sx} y1={sy} x2={sx} y2={sy + 16} /><rect className="redsign" x={sx - 7} y={sy - 6} width={14} height={8} rx={1} /></>; })()}</g>}
    </> : lot(x, y, s.w, s.d), 2.5));
  }
  // Market: growth. A stall with a striped awning and goods when numbers rise, shuttered when they fall.
  { const s = SPOT.shop, x = s.x, y = s.y, yF = y + s.d, built = v.shop.built, down = v.shop.built && v.shop.trend === "down";
    if (built) sh(x, y, s.w, s.d, 1.5);
    els.push(part(v, "shop", x, y, s.w, s.d, x + y + (s.w + s.d) / 2, built ? <>
      <Box x={x} y={y} w={s.w} d={s.d} h={1.05} c="c-wall" />{timber(x, y, s.w, s.d, 0, 1.05)}<Win x={x + s.w} y={y} u={0.6} z={0.4} side="r" />
      <Gable x={x} y={y} w={s.w} d={s.d} z={1.05} h={0.65} c="c-red" />{shingles(x, y, s.w, s.d, 1.05, 0.65)}
      {!down && <><Box x={x + 0.1} y={yF + 0.25} w={1.8} d={0.45} h={0.42} c="c-plank" />
        {["#d2452f", "#e8a21d", "#5d9c3a", "#d2452f", "#e8a21d", "#8a4fa0"].map((f, i) => <circle key={i} className="goods" fill={f} cx={P(x + 0.3 + i * 0.28, yF + 0.47, 0.5)[0]} cy={P(x + 0.3 + i * 0.28, yF + 0.47, 0.5)[1]} r={2.3} />)}</>}
      {[0.02, 1.98].map((u) => <Ln key={`po${u}`} c="timber" a={P(x + u, yF + 0.8, 0)} b={P(x + u, yF + 0.8, 0.75)} />)}
      {[0, 1, 2, 3, 4].map((i) => <polygon key={i} className={down ? "awn off" : `awn a${i % 2}`} points={quad(P(x + i * 0.4, yF, 1.05), P(x + i * 0.4 + 0.4, yF, 1.05), P(x + i * 0.4 + 0.4, yF + 0.8, 0.75), P(x + i * 0.4, yF + 0.8, 0.75))} />)}
      {!down && <><Barrel x={x + s.w + 0.3} y={yF - 0.1} /><Barrel x={x + s.w + 0.35} y={yF + 0.45} /></>}
    </> : lot(x, y, s.w, s.d), 1.8));
  }
  // Homes: customers. Each with a chimney and a small garden.
  { const n = v.homes.built ? Math.min(4, v.homes.houses) : 0, x0 = 3.4, y = 8.05, roofs = ["c-clay", "c-red", "c-blue", "c-clay"];
    if (!n) els.push(part(v, "homes", x0, y, 3, 1, x0 + y + 2, lot(x0, y, 3, 1), 0.9));
    for (let i = 0; i < n; i++) { const x = x0 + i * 1.3; sh(x, y, 1, 1, 1);
      els.push(part(v, "homes", x, y, 1, 1, x + y + 1, <>
        <polygon className="garden" points={quad(P(x - 0.05, y + 1.02), P(x + 1.05, y + 1.02), P(x + 1.05, y + 1.5), P(x - 0.05, y + 1.5))} />
        {[0.2, 0.5, 0.8].map((u, j) => <circle key={u} className="goods" fill={["#e8a21d", "#d2452f", "#fff"][j]} cx={P(x + u, y + 1.3)[0]} cy={P(x + u, y + 1.3)[1] - 1.5} r={1.3} />)}
        <Box x={x} y={y} w={1} d={1} h={0.62} c="c-wall" /><Win x={x} y={y + 1} u={0.1} z={0.14} side="l" /><Door x={x + 0.72} y={y + 1} />
        <Box x={x + 0.12} y={y + 0.2} w={0.2} d={0.2} h={0.6} z={0.72} c="c-rock" /><Gable x={x} y={y} w={1} d={1} z={0.62} h={0.5} c={roofs[i]} />{shingles(x, y, 1, 1, 0.62, 0.5)}
      </>, 1.2)); }
  }
  // Open items: one crate each, the most pressing first. Red = overdue, amber = due this week. Click one to act on it.
  const open = v.openItems || [];
  open.forEach((it, i) => { const x = 3.4 + (i % 5) * 0.62, y = 5.9 + Math.floor(i / 5) * 0.62;
    els.push({ depth: x + y + 0.4, el: <g key={k(`crate${it.id}`)} className="ib crate" role="button" tabIndex={-1} data-item={it.id} data-tip={`${it.title}${it.due ? ` · due ${fmtDate(it.due)}` : ""}`} aria-label={`${v.name}, open item: ${it.title}${it.due ? `, due ${fmtDate(it.due)}` : ""}`}>
      <Box x={x} y={y} w={0.45} d={0.45} h={0.4} c={it.tone === "bad" ? "c-bad" : it.tone === "warn" ? "c-warn" : "c-crate"} /></g> }); });
  if (v.open > open.length) { const [tx, ty] = P(6.9, 6.6, 0.4); els.push({ depth: 14, el: <text key={k("more")} className="more" x={tx} y={ty}>+{v.open - open.length}</text> }); }
  // Claude: at the anvil while a build runs, at the gate with a note when a pull request waits, puzzled when a build stopped.
  const cl = v.claude, clState = cl?.failed.length ? "stopped" : cl?.waiting.length ? "waiting" : cl?.working.length ? "building" : null;
  if (clState && !v.paused) { const at = clState === "building" ? P(2.0, 3.45) : clState === "waiting" ? P(5.9, 9.4) : P(3.6, 3.3);
    const text = clState === "building" ? `Claude is building: ${cl!.working[0]}` : clState === "waiting" ? `Claude has a pull request for you: ${cl!.waiting[0].title}` : `Claude's build stopped: ${cl!.failed[0]}`;
    els.push({ depth: 97, el: <g key={k("claude")} className={`ib claude cl-${clState}`} role="button" tabIndex={-1} data-part="workshop" data-tip={text} aria-label={`${v.name}: ${text}`} transform={`translate(${at[0]} ${at[1]})`}>
      <ellipse className="shade" cx={0} cy={0} rx={5} ry={2.2} /><g className="cl-fig"><rect className="cl-body" x={-3} y={-13} width={6} height={10} rx={2} /><circle className="cl-head" cx={0} cy={-16} r={3.4} />
        <path className="cl-spark" d="M0 -27 l1.3 3 3 1.3 -3 1.3 -1.3 3 -1.3 -3 -3 -1.3 3 -1.3z" />{clState === "building" && <line className="cl-tool" x1={3} y1={-10} x2={8} y2={-15} />}</g>
      {clState !== "building" && <g className="bubble"><rect x={6} y={-36} width={clState === "waiting" ? 24 : 14} height={15} rx={4} /><text x={clState === "waiting" ? 18 : 13} y={-25} textAnchor="middle">{clState === "waiting" ? (cl!.waiting.length > 1 ? `${cl!.waiting.length} PR` : "PR") : "?"}</text></g>}
    </g> }); }
  // A courier at the gate when a reply or a decision waits for you in the inbox.
  if (v.mail?.count && !v.paused) { const at = P(4.2, 9.45), text = `${v.mail.count} message${v.mail.count === 1 ? "" : "s"} waiting for you${v.mail.needs ? ` (${v.mail.needs} need${v.mail.needs === 1 ? "s" : ""} a decision)` : ""}: ${v.mail.first}`;
    els.push({ depth: 97, el: <g key={k("courier")} className={`ib courier${v.mail.needs ? " urgent" : ""}`} role="button" tabIndex={-1} data-mail="1" data-tip={text} aria-label={`${v.name}: ${text}`} transform={`translate(${at[0]} ${at[1]})`}>
      <ellipse className="shade" cx={0} cy={0} rx={5} ry={2.2} /><rect className="co-body" x={-3} y={-13} width={6} height={10} rx={2} /><circle className="cl-head" cx={0} cy={-16} r={3.2} /><path className="co-hat" d="M-4 -18h8l-4 -5z" />
      <g className="letter"><rect x={5} y={-30} width={13} height={9} rx={1.5} /><path d="M5 -30l6.5 5 6.5 -5" /></g>
    </g> }); }
  // The landmark: this project's own, behind the hall. It rises with every deadline behind you.
  { const kind = v.choices?.landmark || landmarkFor(v.id), m = Math.min(6, v.milestones || 0), x = 4.5, y = 0.45, h = 2.6 + m * 0.35, tip = `${v.name}'s ${kind}: ${m ? `${v.milestones} deadline${v.milestones === 1 ? "" : "s"} behind you` : "it rises with every deadline behind you"}`;
    const topP = P(x + 0.6, y + 0.6, h);
    els.push({ depth: x + y + 1.2, el: <g key={k("landmark")} className={`landmark lm-${kind}`} data-tip={tip}>
      {kind === "windmill" && <><Box x={x + 0.15} y={y + 0.15} w={0.9} d={0.9} h={h - 0.5} c="c-wall" /><Roof x={x + 0.15} y={y + 0.15} w={0.9} d={0.9} z={h - 0.5} h={0.7} c="c-wood" />
        <g className="blades" style={{ transformOrigin: `${P(x + 0.6, y + 1.1, h - 0.7)[0]}px ${P(x + 0.6, y + 1.1, h - 0.7)[1]}px` }}>{[0, 90, 180, 270].map((d) => <rect key={d} x={P(x + 0.6, y + 1.1, h - 0.7)[0] - 2} y={P(x + 0.6, y + 1.1, h - 0.7)[1] - 26} width={4} height={26} transform={`rotate(${d} ${P(x + 0.6, y + 1.1, h - 0.7)[0]} ${P(x + 0.6, y + 1.1, h - 0.7)[1]})`} />)}</g></>}
      {kind === "lighthouse" && <>{Array.from({ length: Math.ceil(h / 0.6) }, (_, i) => <Box key={i} x={x + 0.25} y={y + 0.25} w={0.7} d={0.7} h={Math.min(0.6, h - i * 0.6)} z={i * 0.6} c={i % 2 ? "c-red" : "c-snow"} />)}
        <Box x={x + 0.15} y={y + 0.15} w={0.9} d={0.9} h={0.12} z={h} c="c-iron" /><circle className="lh-glow" cx={topP[0]} cy={topP[1] - 8} r={13} /><circle className="lh-lamp" cx={topP[0]} cy={topP[1] - 8} r={4} /><Roof x={x + 0.3} y={y + 0.3} w={0.6} d={0.6} z={h + 0.7} h={0.4} c="c-iron" /></>}
      {kind === "obelisk" && <><Box x={x} y={y} w={1.2} d={1.2} h={0.25} c="c-rock" /><Box x={x + 0.35} y={y + 0.35} w={0.5} d={0.5} h={h - 0.2} z={0.25} c="c-snow" /><Roof x={x + 0.35} y={y + 0.35} w={0.5} d={0.5} z={h + 0.05} h={0.5} c="c-gold" /></>}
      {kind === "oak" && <><rect className="trunk" x={P(x + 0.6, y + 0.6)[0] - 4} y={P(x + 0.6, y + 0.6, h * 0.55)[1]} width={8} height={h * 0.55 * ZH} />
        {[[0, 0, 26], [-16, 8, 18], [16, 8, 18], [0, -14, 20]].map(([dx, dy, rr], i) => <circle key={i} className={`oak o${i % 2}`} cx={topP[0] + dx} cy={topP[1] + dy + 12} r={rr * (0.7 + m * 0.06)} />)}</>}
      {Array.from({ length: m }, (_, i) => { const a = P(x + 1.25, y + 1.25, 0.5 + i * 0.32); return <polygon key={i} className="pennant" points={`${a[0]},${a[1]} ${a[0] + 9},${a[1] + 3} ${a[0]},${a[1] + 6}`} />; })}
    </g> }); }
  // Fields: one per two items done on time in the last 28 days.
  const fields: ReactNode[] = [];
  for (let i = 0; i < Math.min(4, Math.ceil(v.onTime28 / 2)); i++) { const x = 0.6 + (i % 2) * 1.2, y = 3.7 + Math.floor(i / 2) * 1.2;
    fields.push(<g key={k(`f${i}`)}><Box x={x} y={y} w={1.05} d={1.05} h={0.08} c="c-wheat" />{[0.25, 0.55, 0.85].map((u) => <line key={u} className="furrow" x1={P(x + u, y)[0]} y1={P(x + u, y)[1]} x2={P(x + u, y + 1.05)[0]} y2={P(x + u, y + 1.05)[1]} />)}</g>); }
  // A well, a few trees, and people when work is moving.
  els.push({ depth: 7.4 + 4.4 + 0.6, el: <g key={k("well")}><Box x={7.4} y={4.4} w={0.7} d={0.7} h={0.35} c="c-rock" /><ellipse className="water" cx={P(7.75, 4.75, 0.35)[0]} cy={P(7.75, 4.75, 0.35)[1]} rx={7} ry={3.5} />
    <Ln c="timber" a={P(7.42, 5.08, 0.35)} b={P(7.42, 5.08, 1.1)} /><Ln c="timber" a={P(8.08, 4.42, 0.35)} b={P(8.08, 4.42, 1.1)} /><Gable x={7.3} y={4.3} w={0.9} d={0.9} z={1.05} h={0.35} c="c-clay" /></g> });
  for (const [x, y] of [[3.9, 9.6], [6.1, 9.6], [3.2, 5.5], [7, 5.5]]) els.push({ depth: x + y, el: <Lamp key={k(`lamp${x}${y}`)} x={x} y={y} /> });
  if (v.onTime28 > 0) { els.push({ depth: 3 + 4.6, el: <g key={k("hay")}><Box x={2.95} y={4} w={0.4} d={0.55} h={0.35} c="c-wheat" /><Box x={2.95} y={4.65} w={0.4} d={0.55} h={0.35} c="c-wheat" /></g> });
    const a = P(0.4, 3.5), b = P(0.4, 3.5, 1); els.push({ depth: 3.9, el: <g key={k("crow")} className="crow"><line className="pole" x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} /><line className="pole" x1={b[0] - 6} y1={b[1] + 5} x2={b[0] + 6} y2={b[1] + 5} /><circle cx={b[0]} cy={b[1]} r={2.6} /></g> }); }
  { const sq = v.choices?.square || (v.hall.tier !== "small" ? "fountain" : null), c = P(5, 7.7, 0.22);
    if (sq) els.push({ depth: 5 + 7.7 + 0.5, el: <g key={k("square")} className="square" data-tip={`The square: ${sq}`}>
      {sq === "fountain" && <><Box x={4.65} y={7.35} w={0.7} d={0.7} h={0.22} c="c-rock" /><ellipse className="water" cx={c[0]} cy={c[1]} rx={7.5} ry={3.7} /><Box x={4.92} y={7.62} w={0.16} d={0.16} h={0.6} z={0.22} c="c-snow" /><circle className="jet" cx={P(5, 7.7, 0.95)[0]} cy={P(5, 7.7, 0.95)[1]} r={2.5} /></>}
      {sq === "statue" && <><Box x={4.7} y={7.4} w={0.6} d={0.6} h={0.5} c="c-rock" /><Box x={4.88} y={7.58} w={0.24} d={0.24} h={0.8} z={0.5} c="c-gold" /><circle className="coin" cx={P(5, 7.7, 1.5)[0]} cy={P(5, 7.7, 1.5)[1]} r={3} /></>}
      {sq === "bandstand" && <><Box x={4.5} y={7.2} w={1} d={1} h={0.2} c="c-plank" />{[[4.5, 7.2], [5.4, 7.2], [4.5, 8.1], [5.4, 8.1]].map(([x, y]) => <Box key={`${x}${y}`} x={x} y={y} w={0.1} d={0.1} h={0.8} z={0.2} c="c-wood" />)}<Roof x={4.45} y={7.15} w={1.1} d={1.1} z={1} h={0.5} c="c-pc" /></>}
      {sq === "garden" && <><polygon className="garden" points={quad(P(4.4, 7.1), P(5.6, 7.1), P(5.6, 8.3), P(4.4, 8.3))} />{[[4.6, 7.3], [5.3, 7.4], [4.8, 7.9], [5.35, 8.05], [5, 7.6]].map(([x, y], i) => <circle key={i} className="goods" fill={["#e8a21d", "#d2452f", "#fff", "#8a4fa0", "#e8a7c0"][i]} cx={P(x, y)[0]} cy={P(x, y)[1] - 2} r={2} />)}<Tree x={5} y={7.75} s={0.55} /></>}
    </g> }); }
  for (let i = 0; i < 5; i++) { const x = 0.5 + r() * 9, y = 0.4 + r() * 9; if ((x > 0.6 && x < 9.2 && y > 0.7 && y < 9.3) && !(y > 4.3 && y < 5.3 && x > 8.3)) continue; const [sx, sy] = P(x, y); els.push({ depth: x + y, el: <ellipse key={k(`bush${i}`)} className="bush" cx={sx} cy={sy - 3} rx={6} ry={4} /> }); }
  fresh.forEach((e, i) => els.push({ depth: 99.5, el: <Wagon key={k(`wagon${e.id}`)} title={e.text} delay={i * 5.3} /> }));
  for (let i = 0; i < 4; i++) { const x = 0.5 + r() * 9, y = r() < 0.5 ? 0.3 + r() * 0.5 : 9.2 + r() * 0.5; if (y > 9 && x > 3.6 && x < 6.4) continue; els.push({ depth: x + y, el: <Tree key={k(`t${i}`)} x={x} y={y} s={0.75} /> }); }
  const gate = P(5, 10.4), door = P(5, 5.4), ws = P(2.6, 3.3), mk = P(7.9, 8.5);
  const walkers = v.paused ? 0 : Math.min(4, Math.ceil(v.done28 / 4));
  const routes: [readonly [number, number], readonly [number, number]][] = [[gate, door], [door, ws], [door, mk], [gate, mk]];
  // What the villagers say when you point at them: the reasons behind the picture, from the project's own data.
  const first = (v.openItems || [])[0], thoughts = [
    v.overdue ? `${v.overdue} thing${v.overdue === 1 ? " is" : "s are"} past the date we promised` : null,
    first?.due ? `Next up: ${first.title}, due ${fmtDate(first.due)}` : first ? `Next up: ${first.title}` : null,
    v.claude?.waiting.length ? "Claude left a pull request at the gate for you" : null,
    v.claude?.failed.length ? "Claude's build stopped. Someone should look" : null,
    v.review?.headline ? `The last review said: ${v.review.headline}` : null,
    `${v.done28} thing${v.done28 === 1 ? "" : "s"} finished in the last 28 days`,
    !v.shop.built ? "Nobody has counted the visitors at the market yet" : null,
  ].filter((x): x is string => !!x);
  for (let i = 0; i < walkers; i++) els.push({ depth: 99, el: <Walker key={k(`w${i}`)} thought={thoughts[i % thoughts.length]} from={routes[i][0]} to={routes[i][1]} dur={9 + i * 3} delay={i * 2.5} c={i % 2 ? "c-pc" : "c-clay"} /> });
  // The palisade: back walls first, front walls and the gate last.
  els.push({ depth: -9, el: <g key={k("pal-b")}><Box x={0} y={-0.2} w={PLOT} d={0.2} h={0.8} c="c-wood" /><Box x={-0.2} y={0} w={0.2} d={PLOT} h={0.8} c="c-wood" /><Box x={-0.35} y={-0.35} w={0.6} d={0.6} h={1.3} c="c-wood" /></g> });
  els.push({ depth: 98, el: <g key={k("pal-f")}>
    <Box x={PLOT} y={0} w={0.2} d={PLOT} h={0.8} c="c-wood" /><Box x={0} y={PLOT} w={4} d={0.2} h={0.8} c="c-wood" /><Box x={6} y={PLOT} w={4} d={0.2} h={0.8} c="c-wood" />
    {[[PLOT - 0.25, -0.35], [-0.35, PLOT - 0.25], [PLOT - 0.25, PLOT - 0.25]].map(([x, y]) => <Box key={`${x}${y}`} x={x} y={y} w={0.6} d={0.6} h={1.3} c="c-wood" />)}
    <Box x={3.8} y={PLOT - 0.05} w={0.3} d={0.3} h={1.5} c="c-wood" /><Box x={5.9} y={PLOT - 0.05} w={0.3} d={0.3} h={1.5} c="c-wood" />
    <polygon className="pennant" points={quad(P(4.1, PLOT + 0.1, 1.5), P(5.9, PLOT + 0.1, 1.5), P(5.9, PLOT + 0.1, 1.15), P(4.1, PLOT + 0.1, 1.15))} />
    {v.choices?.banner === "striped" && [4.4, 5, 5.6].map((u) => <polygon key={u} className="pen-stripe" points={quad(P(u, PLOT + 0.1, 1.5), P(u + 0.3, PLOT + 0.1, 1.5), P(u + 0.3, PLOT + 0.1, 1.15), P(u, PLOT + 0.1, 1.15))} />)}
    {v.choices?.banner === "gold" && <polygon className="pen-gold" points={quad(P(4.1, PLOT + 0.1, 1.22), P(5.9, PLOT + 0.1, 1.22), P(5.9, PLOT + 0.1, 1.15), P(4.1, PLOT + 0.1, 1.15))} />}
    {v.choices?.banner && [0.5, 2.5, 7.5, 9.5].map((u) => { const a = P(u, PLOT + 0.1, 0.8), b = P(u, PLOT + 0.1, 1.5); return <g key={`wb${u}`}><line className="pole" x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} /><polygon className="flag pennant" points={`${b[0]},${b[1]} ${b[0] + 10},${b[1] + 3} ${b[0]},${b[1] + 6}`} /></g>; })}
    {v.paused && <Box x={4.1} y={PLOT} w={1.8} d={0.15} h={1} c="c-plank" />}
  </g> });
  // The road to the next deadline: a stone per item due before it, a flag at the end.
  const t = v.trail, steps = t ? t.steps.slice(0, 9) : [];
  const road = !v.paused && t ? <g key={k("road")}>
    {steps.map((s, i) => { const [sx, sy] = P(0.8 + i * 0.95, PLOT + 1.5); return <ellipse key={s.id} className={`stone s-${s.state}`} cx={sx} cy={sy} rx={5} ry={2.6} />; })}
    {(() => { const a = P(9.6, PLOT + 1.5), b = P(9.6, PLOT + 1.5, 1.4); return <g><line className="pole" x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} /><polygon className="flag dl" points={`${b[0]},${b[1]} ${b[0] + 14},${b[1] + 4} ${b[0]},${b[1] + 8}`} /><text className="dl-t" x={a[0] + 6} y={a[1] + 12}>{until(t.daysLeft)}</text></g>; })()}
  </g> : null;
  const ground = <>
    <g className="terrace"><Box x={-0.5} y={-0.5} w={PLOT + 1} d={PLOT + 1} h={0.3} z={-0.3} c={`${v.paused ? "c-stone" : v.fog ? "c-dry" : "c-earth"} soil`} /></g>
    <polygon className="yard" points={quad(P(4.2, 5.2), P(5.8, 5.2), P(5.8, PLOT), P(4.2, PLOT))} /><polygon className="yard" points={quad(P(3, 5.6), P(7.2, 5.6), P(7.2, 7.4), P(3, 7.4))} />
    {[0.6, 1.2].map((u) => <Ln key={`pv${u}`} c="pave" a={P(3, 5.6 + u)} b={P(7.2, 5.6 + u)} />)}{[1.05, 2.1, 3.15].map((u) => <Ln key={`pw${u}`} c="pave" a={P(3 + u, 5.6)} b={P(3 + u, 7.4)} />)}
    <polygon className="sel-ring" points={quad(P(-0.9, -0.9), P(PLOT + 0.9, -0.9), P(PLOT + 0.9, PLOT + 0.9), P(-0.9, PLOT + 0.9))} />
    {fields}{shadows}{road}
  </>;
  return { ground, els };
}

/** What each lens says about a project: a few words and how loud. */
function lensOf(v: Village): Record<Lens, { text: string; tone: Tone }> {
  const t = v.trail, n = (c: number, w: string) => `${c} ${w}${c === 1 ? "" : "s"}`;
  return {
    deadlines: v.paused ? { text: "On hold", tone: "none" } : v.overdue ? { text: `${v.overdue} overdue`, tone: "bad" } : t ? { text: `Deadline ${until(t.daysLeft)}`, tone: t.daysLeft <= 7 ? "warn" : "ok" } : { text: "No deadline ahead", tone: "none" },
    activity: v.done28 ? { text: `${v.done28} done in 28 days`, tone: v.fog ? "warn" : "ok" } : { text: v.quietDays === null ? "Nothing finished yet" : `Quiet for ${n(v.quietDays, "day")}`, tone: "none" },
    money: partChip(v, "bank"), security: partChip(v, "police"), growth: partChip(v, "shop"),
  };
}

function banner(v: Village, lens: Record<Lens, { text: string; tone: Tone }>) {
  const st = plotStatus(v), [bx, by] = P(5, 4, 6.6), w = Math.max(v.name.length * 7.6, st.text.length * 6.2, ...LENSES.map((l) => lens[l].text.length * 6.2)) + 20;
  return <g className="bn"><rect className="bn-bg" x={bx - w / 2} y={by - 34} width={w} height={36} rx={4} /><rect className="bn-c" x={bx - w / 2} y={by - 34} width={4} height={36} />
    <text className="bn-n" x={bx + 2} y={by - 19} textAnchor="middle">{v.name}</text><text className={`bn-s l-none t-${st.tone}`} x={bx + 2} y={by - 5} textAnchor="middle">{st.text}</text>
    {LENSES.map((l) => <text key={l} className={`bn-s l-${l} t-${lens[l].tone}`} x={bx + 2} y={by - 5} textAnchor="middle">{lens[l].text}</text>)}</g>;
}

/** Weather over a settlement, from the latest review: a storm when off track, a grey cloud when at risk. */
function weather(v: Village) {
  const verdict = v.review?.verdict; if (v.paused || (verdict !== "off-track" && verdict !== "at-risk")) return null;
  const [cx, cy] = P(8, 2.5, 7.2), storm = verdict === "off-track";
  return <g className={`wx${storm ? " storm" : ""}`} data-tip={`Latest review: ${verdict.replace("-", " ")}`}>
    <ellipse cx={cx - 14} cy={cy + 3} rx={16} ry={9} /><ellipse cx={cx + 6} cy={cy} rx={20} ry={12} /><ellipse cx={cx + 24} cy={cy + 4} rx={13} ry={8} />
    {storm && <>{[0, 1, 2, 3, 4].map((i) => <line key={i} className="rain" x1={cx - 18 + i * 10} y1={cy + 12} x2={cx - 22 + i * 10} y2={cy + 24} style={{ animationDelay: `${i * 0.17}s` }} />)}<polygon className="bolt" points={`${cx + 2},${cy + 10} ${cx - 4},${cy + 24} ${cx + 1},${cy + 24} ${cx - 3},${cy + 36} ${cx + 8},${cy + 19} ${cx + 3},${cy + 19}`} /></>}
  </g>;
}

export default function Colony({ villages, today, now, season, seasonSouth, past, full, weeks }: { villages: Village[]; today: string; now: string; season: Season; seasonSouth: Season; past: boolean; full: boolean; weeks: number }) {
  const cols = villages.length <= 4 ? 2 : 3, rows = Math.ceil(villages.length / cols), step = PLOT + GAP;
  const X = cols * step + GAP, Y = rows * step + GAP, lift = 0.3 * ZH;
  const at = (i: number) => [GAP + (i % cols) * step, GAP + Math.floor(i / cols) * step] as const;
  const r = rng(hash(villages.map((v) => v.id).join("|")));
  const riverX = step + GAP / 2 - 0.2, bend = (y: number) => Math.sin(y * 0.55) * 0.35;
  const cells = Array.from({ length: cols * rows }, (_, i) => i);
  const inCell = (x: number, y: number) => cells.some((i) => { const [ox, oy] = at(i); return x > ox - 0.9 && x < ox + PLOT + 0.9 && y > oy - 0.9 && y < oy + PLOT + 2.2; });
  const nearPath = (x: number, y: number) => Math.abs(((y - GAP / 2) % step + step) % step) < 0.9 || Math.abs(((x - GAP / 2) % step + step) % step) < 1.3;
  const groups: El[] = [];
  // Forest between the settlements, mountains along the far edges.
  for (let i = 0; i < 170; i++) { const x = 0.4 + r() * (X - 0.8), y = 0.4 + r() * (Y - 0.8); if (inCell(x, y) || nearPath(x, y)) continue; groups.push({ depth: x + y, el: <g key={`tr${i}`}><ellipse className="shade" cx={P(x + 0.3, y + 0.1)[0]} cy={P(x + 0.3, y + 0.1)[1]} rx={7} ry={3} /><Tree x={x} y={y} s={0.7 + r() * 0.6} v={i} /></g> }); }
  for (let i = 0; i < X + Y; i += 1.7) { const onX = i < X, x = onX ? i : -0.2 + r() * 0.5, y = onX ? -0.2 + r() * 0.5 : i - X, w = 1.6 + r() * 1.4, h = 1.8 + r() * 2.6;
    groups.push({ depth: x + y - 3, el: <g key={`mt${i}`}><Roof x={x - w / 2} y={y - w / 2} w={w} d={w} z={0} h={h} c="c-rock" /><Roof x={x - w * 0.16} y={y - w * 0.16} w={w * 0.32} d={w * 0.32} z={h * 0.68} h={h * 0.32} c="c-snow" /></g> }); }
  // Empty cells: a lake, or free land with a signpost.
  cells.slice(villages.length).forEach((i, n) => { const [ox, oy] = at(i);
    groups.push({ depth: ox + oy + PLOT, el: n % 2 === 0
      ? <g key={`free${i}`} className="free" data-free="1" role="button" tabIndex={0} data-tip="Free land: add a project in Admin" aria-label="Free land: add a project in Admin"><polygon className="lot" points={quad(P(ox + 1, oy + 1), P(ox + 9, oy + 1), P(ox + 9, oy + 9), P(ox + 1, oy + 9))} /><Box x={ox + 4.9} y={oy + 4.9} w={0.2} d={0.2} h={1.2} c="c-wood" /><Box x={ox + 4.2} y={oy + 4.95} w={1.6} d={0.1} h={0.5} z={0.7} c="c-plank" /><text className="free-t" x={P(ox + 5, oy + 5, -0.6)[0]} y={P(ox + 5, oy + 5, -0.6)[1]} textAnchor="middle">Free land: a new project settles here</text></g>
      : <g key={`lake${i}`}><ellipse className="bank" cx={P(ox + 5, oy + 5)[0]} cy={P(ox + 5, oy + 5)[1]} rx={4.4 * TW / 1.6} ry={4.4 * TH / 1.6} /><ellipse className="water" cx={P(ox + 5, oy + 5)[0]} cy={P(ox + 5, oy + 5)[1]} rx={4 * TW / 1.6} ry={4 * TH / 1.6} />
          {[-1, 0, 1].map((j) => <line key={j} className="ripple" x1={P(ox + 5, oy + 5)[0] - 30 + j * 22} y1={P(ox + 5, oy + 5)[1] + j * 9} x2={P(ox + 5, oy + 5)[0] - 8 + j * 22} y2={P(ox + 5, oy + 5)[1] + j * 9} style={{ animationDelay: `${j}s` }} />)}
          <Box x={ox + 6.6} y={oy + 7.4} w={0.5} d={1.6} h={0.12} c="c-plank" /></g> }); });
  villages.forEach((v, i) => { const [ox, oy] = at(i), o = P(ox, oy), c = P(ox + 5, oy + 5), s = settlement(v, today), lz = lensOf(v);
    groups.push({ depth: ox + oy + PLOT, el: (
      <g key={v.id} role="button" tabIndex={0} aria-label={`${v.name}: ${plotStatus(v).text}. ${v.open} open, ${v.overdue} overdue.`} className={`vil${v.paused ? " paused" : ""}${v.fog && !v.paused ? " quiet" : ""}`} data-vil={v.id} data-c={v.color} data-cx={c[0]} data-cy={c[1] - lift} {...Object.fromEntries(LENSES.map((l) => [`data-lz-${l}`, lz[l].tone]))} transform={`translate(${o[0]} ${o[1] - lift})`}>
        {s.ground}{s.els.sort((a, b) => a.depth - b.depth).map((e) => e.el)}
        {v.fog && !v.paused && <g className="mist" data-tip={v.quietDays === null ? "Mist: nothing finished here yet" : `Mist: nothing finished here for ${v.quietDays} days`}>{[0, 1, 2].map((j) => <ellipse key={j} cx={P(3 + j * 2.2, 4 + j)[0]} cy={P(3 + j * 2.2, 4 + j, 0.8)[1]} rx={95} ry={22} fill="url(#mist-g)" style={{ animationDelay: `${-j * 4}s` }} />)}</g>}
        {weather(v)}{banner(v, lz)}
      </g>
    ) }); });
  groups.sort((a, b) => a.depth - b.depth);
  const river: (readonly [number, number])[] = [], riverB: (readonly [number, number])[] = [];
  for (let y = 0; y <= Y; y += 0.5) { river.push(P(riverX + bend(y), y)); riverB.push(P(riverX + 1.5 + bend(y), y)); }
  const water = pts(...river, ...riverB.reverse());
  const view = { x: -Y * TW / 2 - 20, y: -7 * ZH, w: (X + Y) * TW / 2 + 40, h: (X + Y) * TH / 2 + 10 * ZH };
  const stage: StageVillage[] = villages.map((v, i) => { const st = plotStatus(v), t = v.trail;
    return { id: v.id, name: v.name, color: v.color, href: v.href, status: st, col: i % cols, row: Math.floor(i / cols),
      deadline: v.paused ? "Deadlines on hold while paused" : t ? `${t.deadline.label} · ${fmtDate(t.deadline.date)} · ${until(t.daysLeft)}` : "No deadline ahead",
      progress: t && t.total ? { onTime: t.onTime, late: t.late, total: t.total } : null,
      headline: v.review?.headline || null, verdict: v.review?.verdict || null,
      stats: { open: v.open, overdue: v.overdue, dueSoon: v.dueSoon, done28: v.done28 },
      items: (v.openItems || []).map((it) => ({ id: it.id, title: it.title, due: it.due ? fmtDate(it.due) : null, tone: it.tone, owner: it.owner })),
      claude: v.claude && (v.claude.working.length || v.claude.waiting.length || v.claude.failed.length) ? v.claude : null,
      series: v.series || [], landmark: `${landmarkFor(v.id)}, ${v.milestones || 0} deadline${v.milestones === 1 ? "" : "s"} behind you`,
      lens: lensOf(v), mail: v.mail?.count ? v.mail : null, weeks: v.earnedWeeks || 0, paused: !!v.paused,
      slots: (Object.keys(SHIPMENTS) as Slot[]).map((sl) => ({ key: sl, label: SHIPMENTS[sl].label, at: SHIPMENTS[sl].at, options: [...SHIPMENTS[sl].options], value: v.choices?.[sl] || (sl === "landmark" ? landmarkFor(v.id) : "") })),
      numbers: !v.shop.built || !v.homes.built,
      events: (v.events || []).slice(0, 6).map((e) => ({ id: e.id, kind: e.kind, text: e.text, ago: e.ago, part: e.part, at: e.at })),
      parts: ORDER.map((p) => ({ key: p, name: NAME[p], ...partChip(v, p), href: partHref(v, p) })) }; });
  return (
    <div className="iso look-colony">
      <ColonyStage villages={stage} view={view} cols={cols} rows={rows} season={season} seasonSouth={seasonSouth} today={today} now={now} past={past} full={full} weeks={weeks}>
        <svg className="iso-svg colony" viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`} role="group" aria-label="Colony map: one settlement per project">
          <defs><radialGradient id="mist-g"><stop offset="0" stopColor="#fff" stopOpacity=".75" /><stop offset=".6" stopColor="#fff" stopOpacity=".35" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></radialGradient></defs>
          <Box x={0} y={0} w={X} d={Y} h={1.6} z={-1.6} c="c-wild soil" />
          {Array.from({ length: 46 }, (_, i) => { const x = r() * (X - 2), y = r() * (Y - 2), w = 0.8 + r() * 1.6; return <polygon key={`pt${i}`} className={`patch p${i % 3}`} points={quad(P(x, y), P(x + w, y), P(x + w, y + w), P(x, y + w))} />; })}
          {Array.from({ length: rows + 1 }, (_, c) => <Box key={`py${c}`} x={0} y={c * step + GAP / 2 - 0.45} w={X} d={0.9} h={0.01} c="c-path" />)}
          {Array.from({ length: cols + 1 }, (_, c) => c === 1 ? null : <Box key={`px${c}`} x={c * step + GAP / 2 - 0.45} y={0} w={0.9} d={Y} h={0.01} c="c-path" />)}
          {villages.map((_, i) => { const [ox, oy] = at(i); return <Box key={`lane${i}`} x={ox + 4.3} y={oy + PLOT} w={1.4} d={GAP / 2 + 0.4} h={0.012} c="c-path" />; })}
          <polygon className="bank" points={pts(...river.map(([x, y]) => [x - 5, y] as const), ...riverB.map(([x, y]) => [x + 5, y] as const))} />
          <polygon className="water" points={water} />
          {Array.from({ length: Math.floor(Y / 2) }, (_, i) => { const [x, y] = P(riverX + 0.75 + bend(i * 2 + 1), i * 2 + 1); return <line key={`rp${i}`} className="ripple" x1={x - 7} y1={y} x2={x + 7} y2={y} style={{ animationDelay: `${-(i % 5) * 0.7}s` }} />; })}
          {Array.from({ length: rows + 1 }, (_, c) => { const y = c * step + GAP / 2 - 0.6; return <g key={`br${c}`}><Box x={riverX - 0.5} y={y} w={2.5} d={1.2} h={0.16} c="c-plank" /><Box x={riverX - 0.5} y={y} w={2.5} d={0.08} h={0.3} z={0.16} c="c-wood" /><Box x={riverX - 0.5} y={y + 1.12} w={2.5} d={0.08} h={0.3} z={0.16} c="c-wood" /></g>; })}
          {groups.map((g) => g.el)}
          <g className="clouds" aria-hidden="true">{[0, 1, 2].map((i) => <ellipse key={i} cx={view.x + view.w * (0.2 + i * 0.3)} cy={view.y + view.h * (0.35 + i * 0.2)} rx={150} ry={46} style={{ animationDelay: `${-i * 23}s` }} />)}</g>
          <g className="compass" transform={`translate(${view.x + 70} ${view.y + view.h - 70})`} aria-hidden="true"><circle r={30} /><polygon points="0,-26 6,0 0,26 -6,0" /><polygon className="ew" points="-26,0 0,-6 26,0 0,6" /><text y={-34} textAnchor="middle">N</text></g>
        </svg>
      </ColonyStage>
    </div>
  );
}
