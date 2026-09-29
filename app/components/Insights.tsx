"use client";
import { useRef, useState } from "react";
import type { Insight } from "@/lib/data";

const fmt = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("en-CA", { timeZone: "UTC", month: "short", day: "numeric" });
const addDays = (d: string, n: number) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const diff = (a: string, b: string) => Math.round((+new Date(b + "T12:00:00Z") - +new Date(a + "T12:00:00Z")) / 864e5);

/** Burn-up: scope vs done over time, with the current pace projected to the next deadline. One chart per project. */
export function BurnUp({ p, today }: { p: Insight; today: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const W = 360, H = 170, L = 26, R = 12, T = 14, B = 22;
  const end = [p.deadline?.date, p.projected && diff(today, p.projected) <= 70 ? p.projected : null, addDays(today, 14)].filter(Boolean).sort().pop()!;
  // Keep at least two weeks of axis behind today, even while the history is short.
  const x0 = [p.days[0], addDays(today, -13)].sort()[0], span = Math.max(1, diff(x0, end));
  const max = Math.max(4, ...p.scope) * 1.1;
  const x = (d: string) => L + ((W - L - R) * diff(x0, d)) / span;
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  const line = (vals: number[]) => vals.map((v, i) => `${i ? "L" : "M"}${x(p.days[i]).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const doneNow = p.done[p.done.length - 1], scopeNow = p.scope[p.scope.length - 1];
  const projEnd = p.projected && p.projected <= end ? p.projected : end;
  const projVal = p.ratePerWeek > 0 ? Math.min(scopeNow, doneNow + (p.ratePerWeek / 7) * diff(today, projEnd)) : doneNow;
  const late = p.deadline && (!p.projected || p.projected > p.deadline.date);
  const ticks = [x0, today, end].filter((v, i, a) => a.indexOf(v) === i);
  const onMove = (e: React.MouseEvent) => {
    const box = ref.current!.getBoundingClientRect(), px = ((e.clientX - box.left) / box.width) * W;
    const i = Math.round(((px - L) / (W - L - R)) * span);
    setHover(i >= 0 && i < p.days.length ? i : null);
  };
  return (
    <section className="panel burn" data-c={p.color}>
      <div className="ph">
        <i className="dot" /><h2 className="ph-t">{p.name}</h2><span className="sp" />
        <span className={`v ${late ? "bad" : "ok"}`}>
          {!p.projected ? "Nothing finished yet" : late ? `At this pace: ${fmt(p.projected)} · due ${fmt(p.deadline!.date)}` : `On pace: done by ${fmt(p.projected)}`}
        </span>
      </div>
      <div className="chart pb" ref={ref} onMouseMove={onMove} onMouseLeave={() => setHover(null)} style={{ paddingBottom: 6 }}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${p.name}: ${doneNow} of ${scopeNow} items done`}>
          <g className="grid">{[0, 0.5, 1].map((f) => <line key={f} x1={L} x2={W - R} y1={y(max * f / 1.1)} y2={y(max * f / 1.1)} />)}</g>
          <g className="axis">{[0, 0.5, 1].map((f) => <text key={f} x={L - 5} y={y(max * f / 1.1) + 3.5} textAnchor="end">{Math.round(max * f / 1.1)}</text>)}</g>
          {p.deadline && p.deadline.date <= end && (
            <g><line x1={x(p.deadline.date)} x2={x(p.deadline.date)} y1={T} y2={H - B} stroke="var(--ink-2)" strokeWidth={1} />
              <text x={x(p.deadline.date) - 4} y={T + 8} textAnchor="end" style={{ fill: "var(--ink-2)" }}>{p.deadline.label}</text></g>
          )}
          <path d={`${line(p.done)} L${x(today)},${y(0)} L${x(p.days[0])},${y(0)} Z`} style={{ fill: "var(--pc)", opacity: 0.1 }} />
          <path d={line(p.scope)} fill="none" stroke="var(--ink-3)" strokeWidth={2} strokeLinejoin="round" />
          <line x1={x(today)} y1={y(scopeNow)} x2={x(end)} y2={y(scopeNow)} stroke="var(--ink-3)" strokeWidth={1} />
          <path d={line(p.done)} fill="none" style={{ stroke: "var(--pc)" }} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          <line x1={x(today)} y1={y(doneNow)} x2={x(projEnd)} y2={y(projVal)} style={{ stroke: "var(--pc)" }} strokeWidth={2} strokeDasharray="4 4" strokeLinecap="round" />
          <circle cx={x(today)} cy={y(doneNow)} r={4} style={{ fill: "var(--pc)" }} stroke="var(--surface)" strokeWidth={2} />
          <text x={x(today) + 6} y={y(doneNow) + 12} style={{ fill: "var(--ink)" }}>{doneNow} done</text>
          <text x={x(today) + 6} y={y(scopeNow) - 5} style={{ fill: "var(--ink-2)" }}>{scopeNow} total</text>
          {hover !== null && <line x1={x(p.days[hover])} x2={x(p.days[hover])} y1={T} y2={H - B} stroke="var(--ink-3)" strokeWidth={1} />}
          <line className="base" x1={L} x2={W - R} y1={y(0)} y2={y(0)} />
          {ticks.map((d) => <text key={d} x={x(d)} y={H - 6} textAnchor={d === x0 ? "start" : d === end ? "end" : "middle"} style={d === today ? { fill: "var(--ink)", fontWeight: 600 } : undefined}>{d === today ? "today" : fmt(d)}</text>)}
        </svg>
        {hover !== null && (
          <div className="tip" style={{ left: `${(x(p.days[hover]) / W) * 100}%`, top: 20 }}>
            <div style={{ opacity: .8 }}>{fmt(p.days[hover])}</div>
            <div className="row"><i className="dot" />Done <b>{p.done[hover]}</b></div>
            <div className="row"><i className="dot" style={{ background: "var(--ink-3)" }} />Total <b>{p.scope[hover]}</b></div>
          </div>
        )}
      </div>
      <div className="legend">
        <span><i className="dot" />Done</span><span><i className="dot" style={{ background: "var(--ink-3)" }} />Total items</span>
        <span><svg width="18" height="6" aria-hidden="true"><line x1="1" y1="3" x2="17" y2="3" style={{ stroke: "var(--pc)" }} strokeWidth="2" strokeDasharray="4 4" /></svg>At current pace ({p.ratePerWeek.toFixed(1)}/wk)</span>
      </div>
    </section>
  );
}

/** Bullet chart: finished per week (bar) vs needed per week to clear what's due by the next deadline (tick). */
export function PaceBullets({ rows }: { rows: Insight[] }) {
  const max = Math.max(2, ...rows.map((r) => Math.max(r.ratePerWeek, r.neededPerWeek))) * 1.15;
  return (
    <div className="pb">
      {rows.map((r) => (
        <div key={r.id} className="bullet" data-c={r.color} title={`${r.name}: ${r.ratePerWeek.toFixed(1)} finished per week; ${r.neededPerWeek.toFixed(1)} per week needed for ${r.dueByDeadline} items due by ${r.deadline?.label || "no deadline"}`}>
          <span style={{ display: "flex", gap: 7, alignItems: "center" }}><i className="dot" />{r.name}</span>
          <span className="track">
            <span className="fill" style={{ width: `${(r.ratePerWeek / max) * 100}%` }} />
            {r.deadline && <span className="need" style={{ left: `calc(${(r.neededPerWeek / max) * 100}% - 1px)` }} />}
          </span>
          <span className="v"><b>{r.ratePerWeek.toFixed(1)}</b> vs <b className={r.neededPerWeek > r.ratePerWeek ? "bad" : ""}>{r.neededPerWeek.toFixed(1)}</b>/wk{r.slips7 ? <><br />{r.slips7} due date{r.slips7 > 1 ? "s" : ""} pushed</> : null}</span>
        </div>
      ))}
      <div className="legend" style={{ padding: "10px 0 0" }}>
        <span><i className="dot" style={{ background: "var(--ink-3)" }} />Bar: finished per week (recent)</span>
        <span><i style={{ width: 3, height: 12, background: "var(--ink)", borderRadius: 2, display: "inline-block" }} />Tick: needed per week to clear what&apos;s due by the next deadline</span>
      </div>
    </div>
  );
}

/** 100% stacked bars: who the open items are waiting on. */
export function OwnerBars({ rows }: { rows: Insight[] }) {
  const seg = [["you", "You", "var(--own-you)"], ["claude", "Claude", "var(--own-claude)"], ["both", "Both", "var(--own-both)"]] as const;
  return (
    <div className="pb">
      {rows.map((r) => {
        const n = r.owners.you + r.owners.claude + r.owners.both || 1;
        return (
          <div key={r.id} className="stack100" data-c={r.color}>
            <span style={{ display: "flex", gap: 7, alignItems: "center" }}><i className="dot" />{r.name}</span>
            <span className="bars" role="img" aria-label={`${r.name}: ${r.owners.you} on you, ${r.owners.claude} on Claude, ${r.owners.both} on both`}>
              {seg.map(([k, label, c]) => r.owners[k] > 0 && (
                <span key={k} title={`${label}: ${r.owners[k]}`} style={{ width: `${(r.owners[k] / n) * 100}%`, background: c }}>{r.owners[k] / n > 0.12 ? r.owners[k] : ""}</span>
              ))}
            </span>
            <span className="due" style={{ textAlign: "right" }}>{Math.round((r.owners.you / n) * 100)}%</span>
          </div>
        );
      })}
      <div className="legend" style={{ padding: "8px 0 0" }}>
        {seg.map(([k, label, c]) => <span key={k}><i className="dot" style={{ background: c }} />{label}</span>)}
        <span>· % = share waiting on you</span>
      </div>
    </div>
  );
}

/** Calendar heatmap, last 4 weeks: things finished per day (checklist items + todos + messages). Single hue, 5 steps. */
export function Heatmap({ days, today }: { days: { date: string; done: number; todos: number; msgs: number }[]; today: string }) {
  const [tip, setTip] = useState<string | null>(null);
  const tot = (d: (typeof days)[number]) => d.done + d.todos + d.msgs;
  const max = Math.max(1, ...days.map(tot));
  const step = (v: number) => (v === 0 ? 0 : Math.min(4, Math.ceil((v / max) * 4)));
  const shade = ["var(--line-2)", "color-mix(in srgb, var(--heat) 28%, var(--surface))", "color-mix(in srgb, var(--heat) 50%, var(--surface))", "color-mix(in srgb, var(--heat) 75%, var(--surface))", "var(--heat)"];
  const lead = (new Date(days[0].date + "T12:00:00Z").getUTCDay() + 6) % 7;
  const cells: ((typeof days)[number] | null)[] = [...Array(lead).fill(null), ...days];
  const weeks = Array.from({ length: Math.ceil(cells.length / 7) }, (_, i) => cells.slice(i * 7, i * 7 + 7));
  const best = [...days].sort((a, b) => tot(b) - tot(a))[0];
  return (
    <div className="pb">
      <div className="heatgrid">
        <span />{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <span key={d} className="wd">{d}</span>)}
        {weeks.map((w, i) => [
          <span key={`w${i}`} className="wk">{w.find(Boolean) ? fmt(w.find(Boolean)!.date) : ""}</span>,
          ...Array.from({ length: 7 }, (_, j) => {
            const d = w[j];
            if (!d) return <span key={`e${i}${j}`} />;
            const label = `${fmt(d.date)}: ${d.done} checklist items, ${d.todos} todos, ${d.msgs} messages`;
            return <span key={d.date} className={`cell${d.date === today ? " today" : ""}`} tabIndex={0} aria-label={label} title={label}
              onMouseEnter={() => setTip(label)} onFocus={() => setTip(label)} onMouseLeave={() => setTip(null)} style={{ background: d.date > today ? "transparent" : shade[step(tot(d))] }} />;
          }),
        ])}
      </div>
      <div className="legend" style={{ padding: "10px 0 0", justifyContent: "space-between" }}>
        <span className="ramp">Less {shade.map((c, i) => <i key={i} style={{ background: c }} />)} More</span>
        <span>{tip || (tot(best) ? `Busiest: ${fmt(best.date)} (${tot(best)})` : "Nothing logged yet")}</span>
      </div>
    </div>
  );
}
