"use client";
import { useRef, useState } from "react";

export type Series = { key: string; label: string; color: string /* data-c token */ };
type Tip = { x: number; y: number; title: string; rows: { color: string; label: string; v: number }[] } | null;

function niceMax(v: number) {
  if (v <= 4) return 4;
  const p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p;
  return ([1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((s) => s >= n) || 10) * p;
}

/**
 * Stacked columns: one column per x, one segment per series, 2px surface gap between segments,
 * rounded data-end on the top segment. Optional `marker[x]`: a hollow tick on the same axis (e.g. "planned").
 */
export function StackedColumns({ xs, xLabels, series, values, marker, markerLabel, unit, highlight }: {
  xs: string[]; xLabels: string[]; series: Series[]; values: number[][]; marker?: number[]; markerLabel?: string; unit: string; highlight?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip>(null);
  const W = 560, H = 190, L = 28, R = 6, T = 16, B = 22;
  const totals = values.map((r) => r.reduce((a, b) => a + b, 0));
  const max = niceMax(Math.max(1, ...totals, ...(marker || [])));
  const band = (W - L - R) / xs.length, bw = Math.min(24, band * 0.62);
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  const ticks = [0, max / 2, max];
  const every = xs.length > 10 ? 2 : 1; // thin the axis labels on long series; the tooltip and table keep every value
  const show = (i: number, e: React.MouseEvent | React.FocusEvent) => {
    const box = ref.current!.getBoundingClientRect();
    const cx = "clientX" in e ? e.clientX - box.left : ((L + band * i + band / 2) / W) * box.width;
    const rows = series.map((s, k) => ({ color: s.color, label: s.label, v: values[i][k] })).filter((r) => r.v > 0);
    if (marker) rows.push({ color: "", label: markerLabel || "Planned", v: marker[i] });
    setTip({ x: cx, y: (y(Math.max(totals[i], marker?.[i] || 0)) / H) * box.height, title: xLabels[i], rows });
  };
  return (
    <div className="chart" ref={ref} onMouseLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${unit} per ${xLabels.length} periods`}>
        <g className="grid">{ticks.map((t) => <line key={t} x1={L} x2={W - R} y1={y(t)} y2={y(t)} />)}</g>
        <g className="axis">{ticks.map((t) => <text key={t} x={L - 6} y={y(t) + 3.5} textAnchor="end">{Math.round(t)}</text>)}</g>
        {xs.map((x, i) => {
          const cx = L + band * i + band / 2;
          let acc = 0;
          const segs = series.map((s, k) => ({ s, v: values[i][k] })).filter((z) => z.v > 0);
          return (
            <g key={x} tabIndex={0} onMouseMove={(e) => show(i, e)} onFocus={(e) => show(i, e)} onBlur={() => setTip(null)} style={{ outline: "none" }}>
              <rect x={L + band * i} y={T} width={band} height={H - T - B} fill="transparent" />
              {segs.map(({ s, v }, j) => {
                const y0 = y(acc), y1 = y(acc + v); acc += v;
                const top = j === segs.length - 1, h = Math.max(0, y0 - y1 - (j > 0 ? 2 : 0));
                const yTop = y1, r = top ? Math.min(4, h) : 0;
                const path = `M${cx - bw / 2},${yTop + h} V${yTop + r} Q${cx - bw / 2},${yTop} ${cx - bw / 2 + r},${yTop} H${cx + bw / 2 - r} Q${cx + bw / 2},${yTop} ${cx + bw / 2},${yTop + r} V${yTop + h} Z`;
                return <path key={s.key} d={path} data-c={s.color} style={{ fill: "var(--pc)" }} />;
              })}
              {marker && marker[i] > 0 && <line x1={cx - bw / 2 - 3} x2={cx + bw / 2 + 3} y1={y(marker[i])} y2={y(marker[i])} stroke="var(--ink-2)" strokeWidth={2} strokeLinecap="round" />}
              {highlight === i && totals[i] > 0 && <text className="tot" x={cx} y={y(Math.max(totals[i], marker?.[i] || 0)) - 5} textAnchor="middle">{totals[i]}</text>}
              {(highlight === i || (xs.length - 1 - i) % every === 0) && <text x={cx} y={H - 6} textAnchor="middle" style={highlight === i ? { fill: "var(--ink)", fontWeight: 600 } : undefined}>{xLabels[i]}</text>}
            </g>
          );
        })}
        <line className="base" x1={L} x2={W - R} y1={y(0)} y2={y(0)} />
      </svg>
      {tip && (
        <div className="tip" style={{ left: tip.x, top: tip.y }}>
          <div style={{ marginBottom: 3, opacity: .8 }}>{tip.title}</div>
          {tip.rows.length ? tip.rows.map((r) => (
            <div className="row" key={r.label}>{r.color ? <i className="dot" data-c={r.color} /> : <i className="dot" style={{ background: "transparent", border: "1.5px solid currentColor" }} />}{r.label} <b>{r.v}</b></div>
          )) : <div>Nothing</div>}
        </div>
      )}
      <div className="legend">
        {series.map((s) => <span key={s.key}><i className="dot" data-c={s.color} />{s.label}</span>)}
        {marker && <span><i className="ring" />{markerLabel || "Planned"}</span>}
      </div>
      <details className="tabletoggle">
        <summary>Show as a table</summary>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead><tr><th></th>{series.map((s) => <th key={s.key}>{s.label}</th>)}{marker && <th>{markerLabel || "Planned"}</th>}</tr></thead>
            <tbody>{xs.map((x, i) => <tr key={x}><td>{xLabels[i]}</td>{values[i].map((v, k) => <td key={k}>{v}</td>)}{marker && <td>{marker[i]}</td>}</tr>)}</tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

/** Horizontal bars, one per entity, value at the tip. Single measure, so no legend: the title names it. */
const FORMATS = {
  minutes: (v: number) => (v >= 60 ? `${Math.floor(v / 60)}h ${String(v % 60).padStart(2, "0")}` : `${v} min`),
  count: (v: number) => String(v),
};
// `format` is a name, not a function: this is a Client Component and server pages can't pass functions to it.
export function HBars({ rows, format = "count" }: { rows: { key: string; label: string; color: string; v: number; hint?: string }[]; format?: keyof typeof FORMATS }) {
  const fmt = FORMATS[format];
  const max = Math.max(1, ...rows.map((r) => r.v));
  return (
    <div className="pb" role="list">
      {rows.map((r) => (
        <div className="hbar" key={r.key} role="listitem" data-c={r.color} title={r.hint || `${r.label}: ${fmt(r.v)}`}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}</span>
          <span className="track"><span className="fill" style={{ width: `${(r.v / max) * 100}%` }} /></span>
          <span className="v">{fmt(r.v)}</span>
        </div>
      ))}
    </div>
  );
}
