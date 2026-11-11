// The colony map: every project a walled settlement on one frontier map (server-drawn SVG; ColonyStage adds the camera,
// selection and the command panel). What you see is driven by the same Village data as the other looks:
// town hall tier = items ever done on time, fields = items done on time in the last 28 days, villagers = recent activity,
// crates = open items (amber due this week, red overdue), fire = overdue, watchtower beacon = security, market = growth,
// vault = money, parcels = pull requests waiting, mist = nothing finished lately, stone ground and a shut gate = paused.
import type { ReactNode } from "react";
import { partChip, partHref, plotStatus, type Village } from "@/components/Villages";
import { Box, Roof, Tree, P, pts, TW, TH, ZH, PLOT, GAP, NAME, ORDER } from "@/components/IsoLab";
import ColonyStage, { type StageVillage } from "@/components/ColonyStage";
import { hash, rng, type PartKey } from "@/lib/villages";
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
function Walker({ from, to, dur, delay, c }: { from: readonly [number, number]; to: readonly [number, number]; dur: number; delay: number; c: string }) {
  return (
    <g className="walker">
      <animateMotion dur={`${dur}s`} begin={`${-delay}s`} repeatCount="indefinite" path={`M${from[0]} ${from[1]} L${to[0]} ${to[1]} L${from[0]} ${from[1]}`} />
      <ellipse className="shade" cx={0} cy={0} rx={3} ry={1.4} /><rect className={`body ${c}`} x={-1.8} y={-9} width={3.6} height={7} rx={1} /><circle className="head" cx={0} cy={-11} r={2.2} />
    </g>
  );
}

type Spot = { k: PartKey; x: number; y: number; w: number; d: number };
const SPOT: Record<Exclude<PartKey, "homes">, Spot> = {
  workshop: { k: "workshop", x: 1, y: 1, w: 2.2, d: 2 },
  police: { k: "police", x: 7.6, y: 1.2, w: 1.3, d: 1.3 },
  hall: { k: "hall", x: 3.6, y: 2.4, w: 3, d: 2.8 },
  bank: { k: "bank", x: 1, y: 6.6, w: 2, d: 2 },
  shop: { k: "shop", x: 7, y: 6.4, w: 2, d: 1.8 },
};

function part(v: Village, k: PartKey, x: number, y: number, w: number, d: number, depth: number, body: ReactNode, top: number): El {
  const chip = partChip(v, k), [mx, my] = P(x + w / 2, y + d / 2, top + 0.9);
  return { depth, el: (
    <g key={`${v.id}-${k}-${x}`} className="ib" role="button" tabIndex={0} data-part={k} data-tip={`${NAME[k]}: ${chip.text}`} aria-label={`${v.name}, ${NAME[k]}: ${chip.text}`}>
      {body}
      {(chip.tone === "bad" || chip.tone === "warn") && <g className={`mk t-${chip.tone}`}><circle cx={mx} cy={my} r={8} /><text x={mx} y={my + 4} textAnchor="middle">!</text></g>}
    </g>
  ) };
}
const lot = (x: number, y: number, w: number, d: number) => <><polygon className="lot" points={quad(P(x, y), P(x + w, y), P(x + w, y + d), P(x, y + d))} /><line className="pole" x1={P(x + w / 2, y + d / 2)[0]} y1={P(x + w / 2, y + d / 2)[1]} x2={P(x + w / 2, y + d / 2, 0.6)[0]} y2={P(x + w / 2, y + d / 2, 0.6)[1]} /><rect className="sign" x={P(x + w / 2, y + d / 2, 0.9)[0] - 6} y={P(x + w / 2, y + d / 2, 0.9)[1] - 3} width={12} height={7} /></>;

/** One settlement, in its own coordinates (corner at 0,0). */
function settlement(v: Village): { ground: ReactNode; els: El[] } {
  const els: El[] = [], k = (s: string) => `${v.id}-${s}`, alive = !v.paused && v.done28 > 0, r = rng(hash(v.id));
  const shadows: ReactNode[] = [];
  const sh = (x: number, y: number, w: number, d: number, h: number) => shadows.push(<Shadow key={k(`sh${shadows.length}`)} x={x} y={y} w={w} d={d} h={h} />);

  // Town hall: grows with items ever done on time. Fire on the roof for overdue work, a flag for the latest review.
  { const s = SPOT.hall, tier = v.hall.tier, h = tier === "small" ? 1.3 : 1.7, x = s.x, y = s.y;
    sh(x, y, s.w, s.d, h + 1);
    const tower = tier !== "small", tx = x + s.w - 0.9, th = tier === "town" ? 3.6 : 2.7, top = tower ? th + 0.9 : h + 1.1;
    els.push(part(v, "hall", x, y, s.w, s.d, x + y + (s.w + s.d) / 2, <>
      <Box x={x - 0.15} y={y - 0.15} w={s.w + 0.3} d={s.d + 0.3} h={0.18} c="c-rock" />
      <Box x={x} y={y} w={s.w} d={s.d} h={h} z={0.18} c="c-wall" />
      <Win x={x} y={y + s.d} u={0.4} z={0.75} side="l" /><Win x={x} y={y + s.d} u={2.1} z={0.75} side="l" /><Win x={x + s.w} y={y} u={0.5} z={0.75} side="r" /><Win x={x + s.w} y={y} u={1.7} z={0.75} side="r" />
      <Door x={x + s.w / 2 - 0.1} y={y + s.d} />
      <Gable x={x} y={y} w={s.w} d={s.d} z={h + 0.18} h={1.05} c="c-pc" />
      {tower && <><Box x={tx} y={y + 0.2} w={0.9} d={0.9} h={th} c="c-wall" /><Win x={tx} y={y + 1.1} u={0.25} z={th - 0.8} side="l" /><Roof x={tx} y={y + 0.2} w={0.9} d={0.9} z={th} h={0.9} c="c-pc" />
        {tier === "town" && <circle className="clock" cx={P(tx + 0.45, y + 1.1, th - 1.5)[0]} cy={P(tx + 0.45, y + 1.1, th - 1.5)[1]} r={3.5} />}</>}
      {(() => { const fz = tower ? th + 0.9 : h + 1.2, fx = tower ? tx + 0.45 : x + s.w / 2, fy = tower ? y + 0.65 : y + s.d / 2, a = P(fx, fy, fz), b = P(fx, fy, fz + 1.1); return <g><line className="pole" x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} /><polygon className={`flag v-${v.review?.verdict || "none"}`} points={`${b[0]},${b[1]} ${b[0] + 15},${b[1] + 4} ${b[0]},${b[1] + 9}`} /></g>; })()}
      {alive && <Smoke x={x + 0.6} y={y + 0.8} z={h + 1.1} />}
      {Array.from({ length: Math.min(3, v.overdue) }, (_, i) => <Fire key={i} x={x + 0.6 + i * 0.9} y={y + s.d} z={h + 0.5} />)}
    </>, top));
  }
  // Workshop: Claude's builds. Smoke while one runs, a parcel per pull request waiting.
  { const s = SPOT.workshop, x = s.x, y = s.y, built = v.workshop.built;
    if (built) sh(x, y, s.w, s.d, 1.6);
    els.push(part(v, "workshop", x, y, s.w, s.d, x + y + (s.w + s.d) / 2, built ? <>
      <Box x={x} y={y} w={s.w} d={s.d} h={1} c="c-plank" /><Win x={x} y={y + s.d} u={0.3} z={0.4} side="l" /><Door x={x + 1.5} y={y + s.d} />
      <Gable x={x} y={y} w={s.w} d={s.d} z={1} h={0.75} c="c-wood" /><Box x={x + 0.3} y={y + 0.3} w={0.35} d={0.35} h={0.7} z={1.2} c="c-rock" />
      <Box x={x + s.w + 0.15} y={y + 0.2} w={0.5} d={1.2} h={0.3} c="c-wood" />
      {v.workshop.built && v.workshop.running > 0 && <Smoke x={x + 0.47} y={y + 0.47} z={2} busy />}
      {v.workshop.built && Array.from({ length: Math.min(4, v.workshop.waiting) }, (_, i) => <Box key={i} x={x + 0.2 + i * 0.5} y={y + s.d + 0.25} w={0.38} d={0.38} h={0.32} c="c-parcel" />)}
    </> : lot(x, y, s.w, s.d), 1.9));
  }
  // Watchtower: security. Its beacon is calm, amber or red.
  { const s = SPOT.police, x = s.x, y = s.y, built = v.police.built, lvl = v.police.built ? v.police.level : "calm";
    if (built) sh(x, y, s.w, s.d, 3);
    els.push(part(v, "police", x, y, s.w, s.d, x + y + (s.w + s.d) / 2, built ? <>
      <Box x={x + 0.15} y={y + 0.15} w={1} d={1} h={2.2} c="c-rock" /><Win x={x + 0.15} y={y + 1.15} u={0.3} z={1.2} side="l" /><Door x={x + 0.65} y={y + 1.15} />
      <Box x={x} y={y} w={s.w} d={s.d} h={0.35} z={2.2} c="c-plank" /><Roof x={x} y={y} w={s.w} d={s.d} z={2.9} h={0.7} c="c-blue" />
      <circle className={`beacon b-${lvl}`} cx={P(x + 0.65, y + 0.65, 2.75)[0]} cy={P(x + 0.65, y + 0.65, 2.75)[1]} r={4} />
    </> : lot(x, y, s.w, s.d), 3.5));
  }
  // Vault: money. Coins on the step when revenue is recorded.
  { const s = SPOT.bank, x = s.x, y = s.y, built = v.bank.built;
    if (built) sh(x, y, s.w, s.d, 1.8);
    els.push(part(v, "bank", x, y, s.w, s.d, x + y + (s.w + s.d) / 2, built ? <>
      <Box x={x - 0.1} y={y - 0.1} w={s.w + 0.2} d={s.d + 0.35} h={0.2} c="c-rock" /><Box x={x} y={y} w={s.w} d={s.d} h={1.2} z={0.2} c="c-wall" />
      {[0.2, 0.9, 1.6].map((u) => <Box key={u} x={x + u} y={y + s.d} w={0.18} d={0.18} h={1.15} z={0.2} c="c-rock" />)}<Door x={x + 0.65} y={y + s.d} />
      <Roof x={x} y={y} w={s.w} d={s.d + 0.2} z={1.4} h={0.6} c="c-gold" />
      {v.bank.built && Array.from({ length: v.bank.coins }, (_, i) => <ellipse key={i} className="coin" cx={P(x + 0.5 + i * 0.4, y + s.d + 0.55)[0]} cy={P(x + 0.5 + i * 0.4, y + s.d + 0.55)[1] - 2} rx={4} ry={2.4} />)}
    </> : lot(x, y, s.w, s.d), 2.1));
  }
  // Market: growth. Striped awning when numbers rise, shuttered when they fall.
  { const s = SPOT.shop, x = s.x, y = s.y, built = v.shop.built, down = v.shop.built && v.shop.trend === "down";
    if (built) sh(x, y, s.w, s.d, 1.4);
    els.push(part(v, "shop", x, y, s.w, s.d, x + y + (s.w + s.d) / 2, built ? <>
      <Box x={x} y={y} w={s.w} d={s.d} h={1} c="c-plank" />{!down && <Box x={x + 0.2} y={y + s.d + 0.1} w={1.6} d={0.4} h={0.4} c="c-crate" />}
      {[0, 1, 2, 3].map((i) => <polygon key={i} className={down ? "awn off" : `awn a${i % 2}`} points={quad(P(x + i * 0.5, y + s.d, 1.05), P(x + i * 0.5 + 0.5, y + s.d, 1.05), P(x + i * 0.5 + 0.5, y + s.d + 0.7, 0.7), P(x + i * 0.5, y + s.d + 0.7, 0.7))} />)}
      <Gable x={x} y={y} w={s.w} d={s.d} z={1} h={0.6} c="c-red" />
    </> : lot(x, y, s.w, s.d), 1.7));
  }
  // Homes: customers.
  { const n = v.homes.built ? Math.min(4, v.homes.houses) : 0, x0 = 3.5, y = 8.1;
    if (!n) els.push(part(v, "homes", x0, y, 3, 1, x0 + y + 2, lot(x0, y, 3, 1), 0.9));
    for (let i = 0; i < n; i++) { const x = x0 + i * 1.25; sh(x, y, 1, 1, 1);
      els.push(part(v, "homes", x, y, 1, 1, x + y + 1, <><Box x={x} y={y} w={1} d={1} h={0.6} c="c-wall" /><Win x={x} y={y + 1} u={0.15} z={0.15} side="l" /><Gable x={x} y={y} w={1} d={1} z={0.6} h={0.5} c="c-clay" /></>, 1.2)); }
  }
  // Open items: crates on the square. Red = overdue, amber = due this week.
  for (let i = 0; i < Math.min(v.open, 10); i++) { const x = 3.4 + (i % 5) * 0.62, y = 5.9 + Math.floor(i / 5) * 0.62;
    els.push({ depth: x + y + 0.4, el: <Box key={k(`crate${i}`)} x={x} y={y} w={0.45} d={0.45} h={0.4} c={i < v.overdue ? "c-bad" : i < v.overdue + v.dueSoon ? "c-warn" : "c-crate"} /> }); }
  if (v.open > 10) { const [tx, ty] = P(6.9, 6.6, 0.4); els.push({ depth: 14, el: <text key={k("more")} className="more" x={tx} y={ty}>+{v.open - 10}</text> }); }
  // Fields: one per two items done on time in the last 28 days.
  const fields: ReactNode[] = [];
  for (let i = 0; i < Math.min(4, Math.ceil(v.onTime28 / 2)); i++) { const x = 0.6 + (i % 2) * 1.2, y = 3.7 + Math.floor(i / 2) * 1.2;
    fields.push(<g key={k(`f${i}`)}><Box x={x} y={y} w={1.05} d={1.05} h={0.08} c="c-wheat" />{[0.25, 0.55, 0.85].map((u) => <line key={u} className="furrow" x1={P(x + u, y)[0]} y1={P(x + u, y)[1]} x2={P(x + u, y + 1.05)[0]} y2={P(x + u, y + 1.05)[1]} />)}</g>); }
  // A well, a few trees, and people when work is moving.
  els.push({ depth: 7.4 + 4.4 + 0.6, el: <g key={k("well")}><Box x={7.4} y={4.4} w={0.6} d={0.6} h={0.35} c="c-rock" /><Box x={7.45} y={4.65} w={0.5} d={0.08} h={0.5} z={0.35} c="c-wood" /></g> });
  for (let i = 0; i < 4; i++) { const x = 0.5 + r() * 9, y = r() < 0.5 ? 0.3 + r() * 0.5 : 9.2 + r() * 0.5; if (y > 9 && x > 3.6 && x < 6.4) continue; els.push({ depth: x + y, el: <Tree key={k(`t${i}`)} x={x} y={y} s={0.75} /> }); }
  const gate = P(5, 10.4), door = P(5, 5.4), ws = P(2.6, 3.3), mk = P(7.9, 8.5);
  const walkers = v.paused ? 0 : Math.min(4, Math.ceil(v.done28 / 4));
  const routes: [readonly [number, number], readonly [number, number]][] = [[gate, door], [door, ws], [door, mk], [gate, mk]];
  for (let i = 0; i < walkers; i++) els.push({ depth: 99, el: <Walker key={k(`w${i}`)} from={routes[i][0]} to={routes[i][1]} dur={9 + i * 3} delay={i * 2.5} c={i % 2 ? "c-pc" : "c-clay"} /> });
  // The palisade: back walls first, front walls and the gate last.
  els.push({ depth: -9, el: <g key={k("pal-b")}><Box x={0} y={-0.2} w={PLOT} d={0.2} h={0.8} c="c-wood" /><Box x={-0.2} y={0} w={0.2} d={PLOT} h={0.8} c="c-wood" /><Box x={-0.35} y={-0.35} w={0.6} d={0.6} h={1.3} c="c-wood" /></g> });
  els.push({ depth: 98, el: <g key={k("pal-f")}>
    <Box x={PLOT} y={0} w={0.2} d={PLOT} h={0.8} c="c-wood" /><Box x={0} y={PLOT} w={4} d={0.2} h={0.8} c="c-wood" /><Box x={6} y={PLOT} w={4} d={0.2} h={0.8} c="c-wood" />
    {[[PLOT - 0.25, -0.35], [-0.35, PLOT - 0.25], [PLOT - 0.25, PLOT - 0.25]].map(([x, y]) => <Box key={`${x}${y}`} x={x} y={y} w={0.6} d={0.6} h={1.3} c="c-wood" />)}
    <Box x={3.8} y={PLOT - 0.05} w={0.3} d={0.3} h={1.5} c="c-wood" /><Box x={5.9} y={PLOT - 0.05} w={0.3} d={0.3} h={1.5} c="c-wood" />
    <polygon className="pennant" points={quad(P(4.1, PLOT + 0.1, 1.5), P(5.9, PLOT + 0.1, 1.5), P(5.9, PLOT + 0.1, 1.15), P(4.1, PLOT + 0.1, 1.15))} />
    {v.paused && <Box x={4.1} y={PLOT} w={1.8} d={0.15} h={1} c="c-plank" />}
  </g> });
  // The road to the next deadline: a stone per item due before it, a flag at the end.
  const t = v.trail, steps = t ? t.steps.slice(0, 9) : [];
  const road = !v.paused && t ? <g key={k("road")}>
    {steps.map((s, i) => { const [sx, sy] = P(0.8 + i * 0.95, PLOT + 1.5); return <ellipse key={s.id} className={`stone s-${s.state}`} cx={sx} cy={sy} rx={5} ry={2.6} />; })}
    {(() => { const a = P(9.6, PLOT + 1.5), b = P(9.6, PLOT + 1.5, 1.4); return <g><line className="pole" x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} /><polygon className="flag dl" points={`${b[0]},${b[1]} ${b[0] + 14},${b[1] + 4} ${b[0]},${b[1] + 8}`} /><text className="dl-t" x={a[0] + 6} y={a[1] + 12}>{until(t.daysLeft)}</text></g>; })()}
  </g> : null;
  const ground = <>
    <Box x={-0.5} y={-0.5} w={PLOT + 1} d={PLOT + 1} h={0.3} z={-0.3} c={`${v.paused ? "c-stone" : v.fog ? "c-dry" : "c-earth"} soil`} />
    <polygon className="yard" points={quad(P(4.2, 5.2), P(5.8, 5.2), P(5.8, PLOT), P(4.2, PLOT))} /><polygon className="yard" points={quad(P(3, 5.6), P(7.2, 5.6), P(7.2, 7.4), P(3, 7.4))} />
    <polygon className="sel-ring" points={quad(P(-0.9, -0.9), P(PLOT + 0.9, -0.9), P(PLOT + 0.9, PLOT + 0.9), P(-0.9, PLOT + 0.9))} />
    {fields}{shadows}{road}
  </>;
  return { ground, els };
}

function banner(v: Village) {
  const st = plotStatus(v), [bx, by] = P(5, 4, 6.2), w = Math.max(v.name.length * 7.6, st.text.length * 6.2) + 20;
  return <g className={`bn t-${st.tone}`}><rect className="bn-bg" x={bx - w / 2} y={by - 34} width={w} height={36} rx={4} /><rect className="bn-c" x={bx - w / 2} y={by - 34} width={4} height={36} />
    <text className="bn-n" x={bx + 2} y={by - 19} textAnchor="middle">{v.name}</text><text className="bn-s" x={bx + 2} y={by - 5} textAnchor="middle">{st.text}</text></g>;
}

export default function Colony({ villages }: { villages: Village[] }) {
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
  for (let i = 0; i < 170; i++) { const x = 0.4 + r() * (X - 0.8), y = 0.4 + r() * (Y - 0.8); if (inCell(x, y) || nearPath(x, y)) continue; groups.push({ depth: x + y, el: <g key={`tr${i}`}><ellipse className="shade" cx={P(x + 0.3, y + 0.1)[0]} cy={P(x + 0.3, y + 0.1)[1]} rx={7} ry={3} /><Tree x={x} y={y} s={0.7 + r() * 0.6} /></g> }); }
  for (let i = 0; i < X + Y; i += 1.7) { const onX = i < X, x = onX ? i : -0.2 + r() * 0.5, y = onX ? -0.2 + r() * 0.5 : i - X, w = 1.6 + r() * 1.4, h = 1.8 + r() * 2.6;
    groups.push({ depth: x + y - 3, el: <g key={`mt${i}`}><Roof x={x - w / 2} y={y - w / 2} w={w} d={w} z={0} h={h} c="c-rock" /><Roof x={x - w * 0.16} y={y - w * 0.16} w={w * 0.32} d={w * 0.32} z={h * 0.68} h={h * 0.32} c="c-snow" /></g> }); }
  // Empty cells: a lake, or free land with a signpost.
  cells.slice(villages.length).forEach((i, n) => { const [ox, oy] = at(i);
    groups.push({ depth: ox + oy + PLOT, el: n % 2 === 0
      ? <g key={`free${i}`}><polygon className="lot" points={quad(P(ox + 1, oy + 1), P(ox + 9, oy + 1), P(ox + 9, oy + 9), P(ox + 1, oy + 9))} /><Box x={ox + 4.9} y={oy + 4.9} w={0.2} d={0.2} h={1.2} c="c-wood" /><Box x={ox + 4.2} y={oy + 4.95} w={1.6} d={0.1} h={0.5} z={0.7} c="c-plank" /><text className="free-t" x={P(ox + 5, oy + 5, -0.6)[0]} y={P(ox + 5, oy + 5, -0.6)[1]} textAnchor="middle">Free land: a new project settles here</text></g>
      : <g key={`lake${i}`}><ellipse className="bank" cx={P(ox + 5, oy + 5)[0]} cy={P(ox + 5, oy + 5)[1]} rx={4.4 * TW / 1.6} ry={4.4 * TH / 1.6} /><ellipse className="water" cx={P(ox + 5, oy + 5)[0]} cy={P(ox + 5, oy + 5)[1]} rx={4 * TW / 1.6} ry={4 * TH / 1.6} />
          {[-1, 0, 1].map((j) => <line key={j} className="ripple" x1={P(ox + 5, oy + 5)[0] - 30 + j * 22} y1={P(ox + 5, oy + 5)[1] + j * 9} x2={P(ox + 5, oy + 5)[0] - 8 + j * 22} y2={P(ox + 5, oy + 5)[1] + j * 9} style={{ animationDelay: `${j}s` }} />)}
          <Box x={ox + 6.6} y={oy + 7.4} w={0.5} d={1.6} h={0.12} c="c-plank" /></g> }); });
  villages.forEach((v, i) => { const [ox, oy] = at(i), o = P(ox, oy), c = P(ox + 5, oy + 5), s = settlement(v);
    groups.push({ depth: ox + oy + PLOT, el: (
      <g key={v.id} className={`vil${v.paused ? " paused" : ""}${v.fog && !v.paused ? " quiet" : ""}`} data-vil={v.id} data-c={v.color} data-cx={c[0]} data-cy={c[1] - lift} transform={`translate(${o[0]} ${o[1] - lift})`}>
        {s.ground}{s.els.sort((a, b) => a.depth - b.depth).map((e) => e.el)}
        {v.fog && !v.paused && <g className="mist">{[0, 1, 2].map((j) => <ellipse key={j} cx={P(3 + j * 2.2, 4 + j)[0]} cy={P(3 + j * 2.2, 4 + j, 0.8)[1]} rx={70} ry={16} style={{ animationDelay: `${-j * 4}s` }} />)}</g>}
        {banner(v)}
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
      parts: ORDER.map((p) => ({ key: p, name: NAME[p], ...partChip(v, p), href: partHref(v, p) })) }; });
  return (
    <div className="iso look-colony">
      <ColonyStage villages={stage} view={view} cols={cols} rows={rows}>
        <svg className="iso-svg colony" viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`} role="group" aria-label="Colony map: one settlement per project">
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
