"use client";
import { useRef, useState } from "react";
import type { Economics, EconomicsData } from "@/lib/data";
import "./unit-economics.css";

// Unit economics of one project: a model file in the project folder, evaluated over a grid on the Mac
// (agent/economics.mjs) and stored as plain numbers. Every control here picks among those precomputed points.

const COLORS = ["p1", "p2", "p3", "p4", "p5", "p6", "p7"]; // categorical, fixed order: option i keeps COLORS[i]
const pct = (v: number) => `${Math.round(v * 100)}%`;
const fmtNum = (v: number, cur: string, digits = 0) => `${v < 0 ? "−" : ""}${Math.abs(v).toLocaleString("en-CA", { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${cur}`;
function niceStep(range: number) {
  const raw = range / 4, p = Math.pow(10, Math.floor(Math.log10(raw || 1))), n = raw / p;
  return ([1, 2, 2.5, 5, 10].find((s) => s >= n) || 10) * p;
}

export default function UnitEconomics({ economics }: { economics: Economics }) {
  const d = economics.data;
  if (!d) return <ModelError e={economics} />;
  return <Model d={d} e={economics} />;
}

function ModelError({ e }: { e: Economics }) {
  return (
    <section className="panel">
      <div className="ph"><h2 className="ph-t">Unit economics</h2><span className="sp" /><span className="hint">{e.file}</span></div>
      <div className="empty" role="alert">The model couldn&apos;t be evaluated: {e.error || "no result yet"}. Fix the file; the next hourly sync picks it up.</div>
    </section>
  );
}

function Model({ d, e }: { d: EconomicsData; e: Economics }) {
  const idx = <T,>(list: T[], f: (x: T) => boolean) => Math.max(0, list.findIndex(f));
  const [o, setO] = useState(() => idx(d.options, (x) => x.id === d.defaults.option));
  const [m, setM] = useState(() => idx(d.mixes, (x) => x.id === d.defaults.mix));
  const [u, setU] = useState(() => idx(d.usage, (x) => x === d.defaults.usage));
  const [dv, setDv] = useState(() => (d.driver ? idx(d.driver.values, (x) => x === d.defaults.driver) : 0));
  const [pl, setPl] = useState(() => idx(d.plans, (x) => x.id === d.defaults.plan));
  const [n, setN] = useState(() => idx(d.users, (x) => x === d.defaults.users));
  const cur = d.currency;
  const rows = (oi: number, ui = u) => d.grid[`${oi}.${m}.${ui}.${dv}`] || [];
  const net = (r: number[] | undefined) => (r ? r[0] - r[1] : 0);
  const here = rows(o)[n];
  const breakEven = d.users.find((x, i) => x > 0 && net(rows(o)[i]) >= 0);
  const plansHere = d.planGrid[`${o}.${u}.${dv}`] || [];

  return (
    <div className="ue">
      <section className="panel">
        <div className="ph">
          <h2 className="ph-t">{d.title}</h2><span className="sp" />
          <span className="hint" title={e.sha ? `sha ${e.sha.slice(0, 12)}` : undefined}>{e.file}{e.synced_at ? ` · synced ${e.synced_at.slice(0, 10)}` : ""}</span>
        </div>
        {e.error && <div className="due late ue-err" role="alert">The last sync failed ({e.error}); showing the previous result.</div>}
        <div className="ue-controls" role="group" aria-label="Model inputs">
          {d.options.length > 1 && <Pick label="Vendor option" value={o} set={setO} opts={d.options.map((x) => x.label)} />}
          {d.mixes.length > 1 && <Pick label="Plan mix" value={m} set={setM} opts={d.mixes.map((x) => x.label)} />}
          {d.usage.length > 1 && <Pick label="Usage" value={u} set={setU} opts={d.usage.map(pct)} />}
          {d.driver && d.driver.values.length > 1 && <Pick label={d.driver.label} value={dv} set={setDv} opts={d.driver.values.map((v) => `${v}${d.driver!.unit ? ` ${d.driver!.unit}` : ""}`)} />}
          {d.plans.length > 1 && <Pick label="Plan" value={pl} set={setPl} opts={d.plans.map((x) => x.label)} />}
          <Pick label="Users" value={n} set={setN} opts={d.users.map(String)} />
        </div>
        {d.note && <p className="ue-note">{d.note}</p>}
      </section>

      <div className="cost-tiles ue-tiles">
        <div className="panel ctile"><span className="lbl">Profit at {d.users[n]} users</span><span className={`v${net(here) < 0 ? " neg" : " pos"}`}>{fmtNum(net(here), cur)}</span><span className="s">per month · {d.options[o].label}</span></div>
        <div className="panel ctile"><span className="lbl">Revenue · cost</span><span className="v">{fmtNum(here?.[0] || 0, cur)}</span><span className="s">cost {fmtNum(here?.[1] || 0, cur)}{d.users[n] ? ` · ${fmtNum((here?.[1] || 0) / d.users[n], cur, 2)} per user` : ""}</span></div>
        <div className="panel ctile"><span className="lbl">Break-even</span><span className="v">{breakEven !== undefined ? `${breakEven} users` : "—"}</span><span className="s">{breakEven !== undefined ? "first grid point in profit" : `not within ${d.users[d.users.length - 1]} users`}</span></div>
      </div>

      <section className="panel">
        <div className="ph"><h2 className="ph-t">Monthly profit by users</h2><span className="sp" /><span className="hint">{d.mixes[m].label} · {pct(d.usage[u])} usage{d.driver ? ` · ${d.driver.label.toLowerCase()} ${d.driver.values[dv]}` : ""}</span></div>
        <ProfitLines d={d} series={d.options.map((x, i) => ({ label: x.label, color: COLORS[i % COLORS.length], v: rows(i).map(net) }))} />
      </section>

      <div className="grid2">
        <section className="panel">
          <div className="ph"><h2 className="ph-t">Profit grid</h2><span className="sp" /><span className="hint">{d.options[o].label} · users × usage</span></div>
          <div className="ue-scroll">
            <table className="ue-grid">
              <thead><tr><th scope="col">Users</th>{d.usage.map((x, i) => <th scope="col" key={x} className={i === u ? "sel" : undefined}>{pct(x)}</th>)}</tr></thead>
              <tbody>
                {d.users.map((x, i) => (
                  <tr key={x} className={i === n ? "sel" : undefined}>
                    <th scope="row">{x}</th>
                    {d.usage.map((_, j) => { const v = net(rows(o, j)[i]); return <td key={j} className={v < 0 ? "neg" : v > 0 ? "pos" : undefined} title={`${x} users at ${pct(d.usage[j])}: ${fmtNum(v, cur)}`}>{fmtNum(v, "")}</td>; })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="ue-note">Monthly profit in {cur}; red is a loss.</p>
        </section>

        {d.plans.length > 0 && plansHere.length > 0 && (
          <section className="panel">
            <div className="ph"><h2 className="ph-t">Margin per subscriber</h2><span className="sp" /><span className="hint">{d.options[o].label} · {pct(d.usage[u])} usage</span></div>
            <div className="ue-scroll">
              <table className="ue-grid ue-plans">
                <thead>
                  <tr><th rowSpan={2} scope="col">Plan</th><th colSpan={2} scope="colgroup">Monthly</th><th colSpan={2} scope="colgroup">Yearly (per month)</th></tr>
                  <tr><th scope="col">Margin</th><th scope="col">%</th><th scope="col">Margin</th><th scope="col">%</th></tr>
                </thead>
                <tbody>
                  {d.plans.map((p, i) => {
                    const [mr, mc, yr, yc] = plansHere[i] || [];
                    const cell = (r: number | null | undefined, c: number | null | undefined) => {
                      if (r == null || c == null) return <><td>—</td><td>—</td></>;
                      const mg = r - c;
                      return <><td className={mg < 0 ? "neg" : "pos"} title={`revenue ${fmtNum(r, cur, 2)}, cost ${fmtNum(c, cur, 2)}`}>{fmtNum(mg, "", 2)}</td><td>{r ? pct(mg / r) : "—"}</td></>;
                    };
                    return <tr key={p.id} className={i === pl ? "sel" : undefined}><th scope="row">{p.label}<small>{fmtNum(p.price, cur, 2)}{p.yearly != null ? ` · ${fmtNum(p.yearly, "", 2)}/yr` : ""}</small></th>{cell(mr, mc)}{cell(yr, yc)}</tr>;
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>

      <CostLines d={d} row={here} users={d.users[n]} />
    </div>
  );
}

function Pick({ label, value, set, opts }: { label: string; value: number; set: (v: number) => void; opts: string[] }) {
  return (
    <label className="ue-pick">
      <span className="lbl">{label}</span>
      <select className="select" value={value} onChange={(e) => set(Number(e.target.value))}>
        {opts.map((x, i) => <option key={i} value={i}>{x}</option>)}
      </select>
    </label>
  );
}

/** One line per vendor option on a linear users axis, zero baseline, a dashed marker at each decision threshold. */
function ProfitLines({ d, series }: { d: EconomicsData; series: { label: string; color: string; v: number[] }[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const W = 560, H = 210, L = 44, R = 12, T = 18, B = 22;
  const xs = d.users, xmax = Math.max(1, xs[xs.length - 1]), xmin = xs[0];
  const all = series.flatMap((s) => s.v);
  const step = niceStep(Math.max(1, Math.max(0, ...all) - Math.min(0, ...all)));
  const lo = Math.floor(Math.min(0, ...all) / step) * step, hi = Math.ceil(Math.max(0, ...all) / step) * step || step;
  const x = (v: number) => L + ((v - xmin) / (xmax - xmin || 1)) * (W - L - R);
  const y = (v: number) => T + (H - T - B) * (1 - (v - lo) / (hi - lo || 1));
  const ticks: number[] = []; for (let t = lo; t <= hi + step / 2; t += step) ticks.push(t);
  const short = (v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v / 100) / 10}k` : String(Math.round(v)));
  const move = (e: React.MouseEvent) => {
    const box = ref.current!.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    let best = 0; xs.forEach((v, i) => { if (Math.abs(x(v) - px) < Math.abs(x(xs[best]) - px)) best = i; });
    setHover(best);
  };
  const tipLeft = hover === null ? 0 : (x(xs[hover]) / W) * 100;
  return (
    <div className="chart" ref={ref} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Monthly profit from ${xmin} to ${xmax} users, one line per option`} onMouseMove={move}>
        <g className="grid">{ticks.map((t) => <line key={t} x1={L} x2={W - R} y1={y(t)} y2={y(t)} />)}</g>
        <g className="axis">{ticks.map((t) => <text key={t} x={L - 6} y={y(t) + 3.5} textAnchor="end">{short(t)}</text>)}</g>
        <g className="axis">{xs.map((v, i) => (xs.length <= 8 || i % 2 === 0 || i === xs.length - 1) && <text key={v} x={x(v)} y={H - 6} textAnchor="middle">{v}</text>)}</g>
        <line className="base" x1={L} x2={W - R} y1={y(0)} y2={y(0)} style={{ stroke: "var(--ink-3)" }} />
        {d.thresholds.filter((t) => t.users >= xmin && t.users <= xmax).map((t) => (
          <g key={t.users} className="ue-thr">
            <line x1={x(t.users)} x2={x(t.users)} y1={T - 4} y2={H - B} />
            {x(t.users) > W * 0.65 ? <text x={x(t.users) - 4} y={T + 6} textAnchor="end">{t.label}</text> : <text x={x(t.users) + 4} y={T + 6}>{t.label}</text>}
          </g>
        ))}
        {hover !== null && <line x1={x(xs[hover])} x2={x(xs[hover])} y1={T} y2={H - B} stroke="var(--line)" strokeWidth={1} />}
        {series.map((s) => (
          <g key={s.label} data-c={s.color}>
            <path d={s.v.map((v, i) => `${i ? "L" : "M"}${x(xs[i]).toFixed(1)},${y(v).toFixed(1)}`).join(" ")} fill="none" stroke="var(--pc)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {hover !== null && <circle cx={x(xs[hover])} cy={y(s.v[hover])} r={4} fill="var(--pc)" stroke="var(--surface)" strokeWidth={2} />}
          </g>
        ))}
      </svg>
      {hover !== null && (
        <div className="tip" style={{ left: `${tipLeft}%`, top: 10 }}>
          <div style={{ marginBottom: 3, opacity: .8 }}>{xs[hover]} users</div>
          {series.map((s) => <div className="row" key={s.label}><i className="dot" data-c={s.color} />{s.label} <b>{fmtNum(s.v[hover], d.currency)}</b></div>)}
        </div>
      )}
      <div className="legend">
        {series.map((s) => <span key={s.label}><i className="dot" data-c={s.color} />{s.label}</span>)}
        {d.thresholds.length > 0 && <span><i className="ue-dash" />Decision threshold</span>}
      </div>
      <details className="tabletoggle">
        <summary>Show as a table</summary>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead><tr><th>Users</th>{series.map((s) => <th key={s.label}>{s.label}</th>)}</tr></thead>
            <tbody>{xs.map((v, i) => <tr key={v}><td>{v}</td>{series.map((s) => <td key={s.label}>{Math.round(s.v[i])}</td>)}</tr>)}</tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

/** The cost lines at the chosen point, split into fixed and those that grow with users. */
function CostLines({ d, row, users }: { d: EconomicsData; row: number[] | undefined; users: number }) {
  if (!row || !d.lines.length) return null;
  const items = d.lines.map((l, i) => ({ ...l, v: row[2 + i] || 0 })).filter((l) => l.v > 0);
  const max = Math.max(1, ...items.map((l) => l.v));
  const group = (fixed: boolean) => items.filter((l) => l.fixed === fixed).sort((a, b) => b.v - a.v);
  const sum = (l: { v: number }[]) => l.reduce((a, b) => a + b.v, 0);
  return (
    <section className="panel">
      <div className="ph"><h2 className="ph-t">Cost lines at {users} users</h2><span className="sp" /><span className="hint">Monthly, {d.currency}</span></div>
      <div className="ue-lines">
        {[true, false].map((fixed) => {
          const g = group(fixed);
          return (
            <div key={String(fixed)}>
              <div className="lbl ue-lh"><span>{fixed ? "Fixed" : "Grows with users"}</span><span>{fmtNum(sum(g), d.currency, 2)}{!fixed && users ? ` · ${fmtNum(sum(g) / users, d.currency, 2)}/user` : ""}</span></div>
              {g.length ? (
                <div role="list">
                  {g.map((l) => (
                    <div className="hbar" key={l.id} role="listitem" data-c={fixed ? "other" : "p1"}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.label}</span>
                      <span className="track"><span className="fill" style={{ width: `${(l.v / max) * 100}%` }} /></span>
                      <span className="v">{fmtNum(l.v, "", 2)}</span>
                    </div>
                  ))}
                </div>
              ) : <div className="empty" style={{ padding: "6px 0" }}>None at this point.</div>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
