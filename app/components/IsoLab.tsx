// Map lab: isometric looks for the project map, drawn as plain SVG from the same Village data as the tile map.
// Three looks share one scene builder: "islands" (a floating plot per project, in cards), "park" (one shared park with
// paths) and "colony" (one frontier map with palisades, a resource bar and objectives). No client code.
import type { ReactNode } from "react";
import { partChip, partHref, plotStatus, type Village } from "@/components/Villages";
import { hash, rng, type PartKey } from "@/lib/villages";
import { fmtDate } from "@/lib/time";
import Colony from "@/components/Colony";

export type Look = "islands" | "park" | "colony";
export const TW = 40, TH = 20, ZH = 20, PLOT = 10, GAP = 3;
type V2 = readonly [number, number];
export const P = (x: number, y: number, z = 0): V2 => [(x - y) * TW / 2, (x + y) * TH / 2 - z * ZH];
export const pts = (...a: V2[]) => a.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
export const NAME: Record<PartKey, string> = { hall: "Checklist", police: "Security", bank: "Money", shop: "Growth", homes: "Customers", workshop: "Builds" };
export const ORDER: PartKey[] = ["hall", "workshop", "police", "bank", "shop", "homes"];

export function Box({ x, y, w, d, h, z = 0, c }: { x: number; y: number; w: number; d: number; h: number; z?: number; c: string }) {
  const t = z + h;
  return (
    <g className={c}>
      <polygon className="f-r" points={pts(P(x + w, y, t), P(x + w, y + d, t), P(x + w, y + d, z), P(x + w, y, z))} />
      <polygon className="f-l" points={pts(P(x, y + d, t), P(x + w, y + d, t), P(x + w, y + d, z), P(x, y + d, z))} />
      <polygon className="f-t" points={pts(P(x, y, t), P(x + w, y, t), P(x + w, y + d, t), P(x, y + d, t))} />
    </g>
  );
}
export function Roof({ x, y, w, d, z, h, c }: { x: number; y: number; w: number; d: number; z: number; h: number; c: string }) {
  const a = P(x + w / 2, y + d / 2, z + h), o = 0.15;
  return (
    <g className={c}>
      <polygon className="f-r" points={pts(P(x + w + o, y - o, z), P(x + w + o, y + d + o, z), a)} />
      <polygon className="f-t" points={pts(P(x - o, y + d + o, z), P(x + w + o, y + d + o, z), a)} />
    </g>
  );
}
export function Tree({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  const [sx, sy] = P(x, y);
  return (
    <g className="c-tree">
      <rect className="trunk" x={sx - 1.5} y={sy - 6 * s} width={3} height={6 * s} />
      <polygon className="f-t" points={`${sx - 9 * s},${sy - 5 * s} ${sx},${sy - 34 * s} ${sx},${sy - 3 * s}`} />
      <polygon className="f-r" points={`${sx + 9 * s},${sy - 5 * s} ${sx},${sy - 34 * s} ${sx},${sy - 3 * s}`} />
    </g>
  );
}

type Spot = { k: PartKey; x: number; y: number; w: number; d: number; h: number; rh: number; roof: string };
const SPOTS: Spot[] = [
  { k: "workshop", x: 1, y: 1, w: 2, d: 2, h: 1, rh: 0.7, roof: "c-wood" },
  { k: "police", x: 7, y: 1, w: 2, d: 2, h: 1.2, rh: 0.6, roof: "c-blue" },
  { k: "hall", x: 3.5, y: 2.5, w: 3, d: 3, h: 1.4, rh: 1.3, roof: "c-pc" },
  { k: "bank", x: 1, y: 6.5, w: 2, d: 2, h: 1.2, rh: 0.5, roof: "c-gold" },
  { k: "shop", x: 7, y: 6.5, w: 2, d: 2, h: 1, rh: 0.6, roof: "c-red" },
];
const builtOf = (v: Village, k: PartKey) => k === "hall" || (k === "homes" ? v.homes.built : v[k].built);

/** Everything on one project's plot, back to front. `ox, oy` is the plot's corner on the world grid. */
function plot(v: Village, ox: number, oy: number, look: Look): { depth: number; el: ReactNode }[] {
  const out: { depth: number; el: ReactNode }[] = [];
  const key = (s: string) => `${v.id}-${s}`;
  const tierH = v.hall.tier === "town" ? 1.2 : v.hall.tier === "hall" ? 0.6 : 0;
  for (const s of SPOTS) {
    const x = ox + s.x, y = oy + s.y, h = s.h + (s.k === "hall" ? tierH : 0), chip = partChip(v, s.k), built = builtOf(v, s.k);
    const [mx, my] = P(x + s.w / 2, y + s.d / 2, built ? h + s.rh + 0.9 : 0.9);
    out.push({ depth: x + y + (s.w + s.d) / 2, el: (
      <a key={key(s.k)} href={partHref(v, s.k)} className="ib">
        <title>{`${v.name} · ${NAME[s.k]}: ${chip.text}`}</title>
        {built ? <>
          <Box x={x} y={y} w={s.w} d={s.d} h={h} c="c-wall" />
          <polygon className="door" points={pts(P(x + s.w / 2 - 0.3, y + s.d, 0.75), P(x + s.w / 2 + 0.3, y + s.d, 0.75), P(x + s.w / 2 + 0.3, y + s.d, 0), P(x + s.w / 2 - 0.3, y + s.d, 0))} />
          <Roof x={x} y={y} w={s.w} d={s.d} z={h} h={s.rh} c={s.roof} />
          {s.k === "hall" && <g><line className="pole" x1={P(x + 1.5, y + 1.5, h + s.rh)[0]} y1={P(x + 1.5, y + 1.5, h + s.rh)[1]} x2={P(x + 1.5, y + 1.5, h + s.rh + 1.2)[0]} y2={P(x + 1.5, y + 1.5, h + s.rh + 1.2)[1]} />
            <polygon className={`flag v-${v.review?.verdict || "none"}`} points={(() => { const [fx, fy] = P(x + 1.5, y + 1.5, h + s.rh + 1.2); return `${fx},${fy} ${fx + 14},${fy + 5} ${fx},${fy + 10}`; })()} /></g>}
          {s.k === "workshop" && v.workshop.built && v.workshop.running > 0 && <circle className="smoke" cx={P(x + 1, y + 1, h + 1.6)[0]} cy={P(x + 1, y + 1, h + 1.6)[1]} r={6} />}
        </> : <polygon className="lot" points={pts(P(x, y), P(x + s.w, y), P(x + s.w, y + s.d), P(x, y + s.d))} />}
        {(chip.tone === "bad" || chip.tone === "warn") && <g className={`mk t-${chip.tone}`}><circle cx={mx} cy={my} r={8} /><text x={mx} y={my + 4} textAnchor="middle">!</text></g>}
      </a>
    ) });
  }
  // Customers: one small house per step of users.
  const houses = v.homes.built ? Math.min(4, v.homes.houses) : 0;
  for (let i = 0; i < Math.max(1, houses); i++) {
    const x = ox + 3.6 + i * 1.3, y = oy + 8;
    out.push({ depth: x + y + 1, el: <a key={key(`home${i}`)} href={partHref(v, "homes")} className="ib"><title>{`${v.name} · Customers: ${partChip(v, "homes").text}`}</title>
      {houses ? <><Box x={x} y={y} w={1} d={1} h={0.6} c="c-wall" /><Roof x={x} y={y} w={1} d={1} z={0.6} h={0.5} c="c-clay" /></> : <polygon className="lot" points={pts(P(x, y), P(x + 3, y), P(x + 3, y + 1), P(x, y + 1))} />}</a> });
  }
  // Open items: crates on the square. Red = overdue, amber = due this week.
  const shown = Math.min(v.open, 8);
  for (let i = 0; i < shown; i++) {
    const x = ox + 3.3 + (i % 4) * 0.85, y = oy + 6 + Math.floor(i / 4) * 0.85;
    out.push({ depth: x + y + 0.5, el: <Box key={key(`crate${i}`)} x={x} y={y} w={0.55} d={0.55} h={0.45} c={i < v.overdue ? "c-bad" : i < v.overdue + v.dueSoon ? "c-warn" : "c-crate"} /> });
  }
  if (look === "colony") { // palisade
    for (let i = 0; i < PLOT; i++) for (const [x, y, w, d] of [[ox + i, oy - 0.2, 1, 0.2], [ox - 0.2, oy + i, 0.2, 1], [ox + PLOT, oy + i, 0.2, 1], [ox + i, oy + PLOT, 1, 0.2]] as const) {
      if ((y > oy + PLOT - 0.1) && (i === 4 || i === 5)) continue; // the gate
      out.push({ depth: x + y + (y < oy || x < ox ? -1 : 1), el: <Box key={key(`pal${i}-${x}-${y}`)} x={x} y={y} w={w} d={d} h={0.7} c="c-wood" /> });
    }
  }
  const r = rng(hash(v.id));
  for (let i = 0; i < 5; i++) { const x = ox + 0.4 + r() * 9.2, y = oy + (r() < 0.5 ? 4.2 + r() * 1.6 : 9.2 + r() * 0.5); if (x > ox + 3 && x < ox + 7 && y < oy + 9) continue; out.push({ depth: x + y, el: <Tree key={key(`t${i}`)} x={x} y={y} s={0.7} /> }); }
  return out;
}

function banner(v: Village, ox: number, oy: number) {
  const st = plotStatus(v), [bx, by] = P(ox + 5, oy + 4, 5.4), w = Math.max(v.name.length * 7.6, st.text.length * 6.2) + 20;
  return (
    <a key={`${v.id}-b`} href={v.href} className={`bn t-${st.tone}`} data-c={v.color}>
      <rect className="bn-bg" x={bx - w / 2} y={by - 34} width={w} height={36} rx={4} />
      <rect className="bn-c" x={bx - w / 2} y={by - 34} width={4} height={36} />
      <text className="bn-n" x={bx + 2} y={by - 19} textAnchor="middle">{v.name}</text>
      <text className="bn-s" x={bx + 2} y={by - 5} textAnchor="middle">{st.text}</text>
      <line className="pole" x1={bx} y1={by + 2} x2={bx} y2={by + 22} />
    </a>
  );
}

const ground = (v: Village, look: Look) => (v.paused ? "c-stone" : v.fog ? "c-dry" : look === "colony" ? "c-earth" : "c-grass");

function Island({ v }: { v: Village }) {
  const els = plot(v, 0, 0, "islands").sort((a, b) => a.depth - b.depth);
  const w = PLOT * TW, top = 7 * ZH;
  return (
    <svg className="iso-svg" viewBox={`${-w / 2 - 8} ${-top} ${w + 16} ${PLOT * TH + top + 2.2 * ZH}`} role="group" aria-label={`${v.name}: its village`}>
      <ellipse className="shadow" cx={0} cy={PLOT * TH / 2 + 1.9 * ZH} rx={w * 0.42} ry={12} />
      <g data-c={v.color}><Box x={0} y={0} w={PLOT} d={PLOT} h={1.2} z={-1.2} c={`${ground(v, "islands")} soil`} />{els.map((e) => e.el)}</g>
    </svg>
  );
}

function World({ villages, look }: { villages: Village[]; look: Look }) {
  const cols = villages.length <= 4 ? 2 : 3, rows = Math.ceil(villages.length / cols), step = PLOT + GAP;
  const X = cols * step + GAP, Y = rows * step + GAP;
  const at = (i: number) => [GAP + (i % cols) * step, GAP + Math.floor(i / cols) * step] as const;
  const els: { depth: number; el: ReactNode }[] = [];
  villages.forEach((v, i) => { const [ox, oy] = at(i); els.push(...plot(v, ox, oy, look)); });
  const r = rng(hash(villages.map((v) => v.id).join("|")));
  const inPlot = (x: number, y: number) => villages.some((_, i) => { const [ox, oy] = at(i); return x > ox - 0.6 && x < ox + PLOT + 0.6 && y > oy - 0.6 && y < oy + PLOT + 0.6; });
  const onPath = (x: number, y: number) => Math.abs(((x - GAP / 2) % step + step) % step) < 0.9 || Math.abs(((y - GAP / 2) % step + step) % step) < 0.9;
  for (let i = 0; i < (look === "colony" ? 140 : 90); i++) { const x = r() * X, y = r() * Y; if (inPlot(x, y) || onPath(x, y)) continue; els.push({ depth: x + y, el: <Tree key={`w${i}`} x={x} y={y} s={0.7 + r() * 0.5} /> }); }
  els.sort((a, b) => a.depth - b.depth);
  const paths: ReactNode[] = [];
  for (let c = 0; c <= cols; c++) paths.push(<Box key={`px${c}`} x={c * step + GAP / 2 - 0.5} y={0} w={1} d={Y} h={0.01} c="c-path" />);
  for (let c = 0; c <= rows; c++) paths.push(<Box key={`py${c}`} x={0} y={c * step + GAP / 2 - 0.5} w={X} d={1} h={0.01} c="c-path" />);
  return (
    <svg className="iso-svg" viewBox={`${-Y * TW / 2 - 10} ${-8 * ZH} ${(X + Y) * TW / 2 + 20} ${(X + Y) * TH / 2 + 10 * ZH}`} role="group" aria-label="Project map: one village per project">
      <Box x={0} y={0} w={X} d={Y} h={1} z={-1} c={`${look === "colony" ? "c-wild" : "c-lawn"} soil`} />
      {paths}
      {villages.map((v, i) => { const [ox, oy] = at(i); return <g key={`g${v.id}`} data-c={v.color}><Box x={ox} y={oy} w={PLOT} d={PLOT} h={0.02} c={ground(v, look)} /></g>; })}
      {villages.map((v) => null)}
      <g>{els.map((e) => e.el)}</g>
      {villages.map((v, i) => { const [ox, oy] = at(i); return banner(v, ox, oy); })}
    </svg>
  );
}

function Chips({ v }: { v: Village }) {
  return <ul className="vg-p" aria-label={`${v.name}: the parts of the project`}>{ORDER.map((k) => { const c = partChip(v, k); return <li key={k}><a href={partHref(v, k)} className={`t-${c.tone}`}><span className="vg-k">{NAME[k]}</span><span className="vg-v">{c.text}</span></a></li>; })}</ul>;
}
const until = (d: number) => (d === 0 ? "today" : d === 1 ? "tomorrow" : `in ${d} days`);

export default function IsoLab({ villages, look, today }: { villages: Village[]; look: Look; today: string }) {
  if (look === "islands") return (
    <div className="iso look-islands"><ul className="vg">{villages.map((v) => { const st = plotStatus(v), t = v.trail; return (
      <li key={v.id} className={`vg-c${v.paused ? " paused" : ""}`} data-c={v.color}>
        <div className="vg-h"><a className="vg-n" href={v.href}><i className="dot" aria-hidden="true" />{v.name}</a><span className={`vg-st t-${st.tone}`}>{st.text}</span></div>
        <p className="vg-d">{v.paused ? "Deadlines on hold while paused" : t ? <><b>{t.deadline.label}</b> <span className="mono">{fmtDate(t.deadline.date)} · {until(t.daysLeft)}</span></> : "No deadline ahead"}</p>
        <Island v={v} /><Chips v={v} />
      </li>); })}</ul></div>
  );
  if (look === "colony") return <Colony villages={villages} today={today} />;
  const sum = (f: (v: Village) => number) => villages.reduce((a, v) => a + f(v), 0);
  const next = villages.filter((v) => v.trail && !v.paused).sort((a, b) => a.trail!.daysLeft - b.trail!.daysLeft).slice(0, 4);
  return (
    <div className={`iso look-${look}`}>
      <div className="hud">
        <div className="hud-top">
          <span><b className="mono">{sum((v) => v.open)}</b> open</span>
          <span className={sum((v) => v.overdue) ? "bad" : undefined}><b className="mono">{sum((v) => v.overdue)}</b> overdue</span>
          <span><b className="mono">{sum((v) => v.dueSoon)}</b> due in 7 days</span>
          <span><b className="mono">{sum((v) => v.done28)}</b> done, 28 days</span>
        </div>
        <World villages={villages} look={look} />
        <div className="hud-bot">
          <div className="hud-p"><h3>Next deadlines</h3>
            {next.length ? <ol>{next.map((v) => <li key={v.id} data-c={v.color}><i className="dot" aria-hidden="true" /><a href={v.href}>{v.name}</a>: {v.trail!.deadline.label} <span className="mono">{until(v.trail!.daysLeft)}</span></li>)}</ol> : <p>No deadline ahead</p>}
          </div>
          <div className="hud-p"><h3>Needs you</h3>
            <ul>{villages.flatMap((v) => ORDER.map((k) => ({ v, k, c: partChip(v, k) }))).filter((x) => x.c.tone === "bad" || x.c.tone === "warn").slice(0, 6).map((x) => <li key={x.v.id + x.k} data-c={x.v.color}><i className="dot" aria-hidden="true" /><a href={partHref(x.v, x.k)}>{x.v.name} · {NAME[x.k]}</a>: <span className={`t-${x.c.tone}`}>{x.c.text}</span></li>)}</ul>
          </div>
        </div>
      </div>
    </div>
  );
}
