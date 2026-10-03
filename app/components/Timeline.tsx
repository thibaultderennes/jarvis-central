"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { TimelineData, TItem, TLane } from "@/lib/timeline";
import { moveItemsDue, moveMilestone } from "@/lib/actions";
import "./timeline.css";

// Date helpers on YYYY-MM-DD strings (noon UTC, so no timezone drift): the server already resolved "today".
const P = (d: string) => new Date(d + "T12:00:00Z");
const addDays = (d: string, n: number) => { const x = P(d); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const diff = (a: string, b: string) => Math.round((P(b).getTime() - P(a).getTime()) / 864e5);
const fmt = (d: string, o: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }) => P(d).toLocaleDateString("en-CA", { timeZone: "UTC", ...o });
const hm = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${String(m % 60).padStart(2, "0")}` : ""}` : `${m} min`);
const short = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

type Tip = { x: number; y: number; title: string; rows: { text: string; tone?: "bad" | "warn" }[] } | null;
/** A draggable pin: a milestone diamond, or one day's tick (every open item due that day in the lane). */
type Pin = { key: string; project_id: string; date: string; top: number; color: string } & ({ kind: "ms"; label: string; prd: string | null } | { kind: "items"; items: TItem[] });
type Move = { pin: Pin; to: string; clamped: boolean; pick: string[]; kb: boolean; phase: "drag" | "confirm" | "saving" | "saved" };

const HEAD = 38, LANE = 50, CAL = 30, POP = 280;
const sign = (k: number) => `${k > 0 ? "+" : "−"}${Math.abs(k)} d`;

/**
 * Multi-week timeline: one lane per project (or per section on a project page). Milestones are diamonds, open items
 * are due-date ticks clustered per day (taller = more; red = overdue, amber = critical), Sunday-plan blocks are bars
 * along the top of the lane, the signal line is today. Lane labels stay put; the chart scrolls sideways on phones.
 * Pins move: drag one (or focus it and use ←/→, Shift = a week, then Enter) and confirm in the popover; nothing saves before.
 */
export default function Timeline({ data }: { data: TimelineData }) {
  const { from, to, today: t, lanes, calendar, guides } = data;
  const n = diff(from, to) + 1;
  const days = Array.from({ length: n }, (_, i) => addDays(from, i));
  const box = useRef<HTMLDivElement>(null);
  const [dw, setDw] = useState(16);
  const [tip, setTip] = useState<Tip>(null);
  useEffect(() => {
    const el = box.current; if (!el) return;
    const fit = () => setDw(Math.max(13, Math.floor(el.clientWidth / n)));
    fit();
    const ro = new ResizeObserver(fit); ro.observe(el);
    return () => ro.disconnect();
  }, [n]);
  // Start scrolled so the previous week stays visible but today is near the left on narrow screens.
  useEffect(() => { const el = box.current; if (el && el.scrollWidth > el.clientWidth) el.scrollLeft = Math.max(0, (diff(from, t) - 5) * dw); }, [from, t, dw]);

  const W = n * dw;
  const x = (d: string) => diff(from, d) * dw;
  const rows: { kind: "cal" | "lane"; lane?: TLane; y: number; h: number }[] = [];
  let y = HEAD;
  if (calendar) { rows.push({ kind: "cal", y, h: CAL }); y += CAL; }
  for (const l of lanes) { rows.push({ kind: "lane", lane: l, y, h: LANE }); y += LANE; }
  const H = y + 4;

  const show = (cx: number, cy: number, title: string, r: NonNullable<Tip>["rows"]) => { if (!mvRef.current) setTip({ x: Math.min(Math.max(cx, 90), W - 90), y: cy, title, rows: r }); };
  const hide = () => setTip(null);
  const hit = (cx: number, cy: number, title: string, r: NonNullable<Tip>["rows"]) => ({
    tabIndex: 0, onMouseEnter: () => show(cx, cy, title, r), onFocus: () => show(cx, cy, title, r), onMouseLeave: hide, onBlur: hide,
    onClick: () => { if (Date.now() - dropped.current > 400) show(cx, cy, title, r); },
  });

  /* ---- moving pins: drag or arrow keys → ghost + live label → confirm popover → save ---- */
  const svg = useRef<SVGSVGElement>(null);
  const pinEl = useRef<SVGGElement | null>(null);
  const dropped = useRef(0); // when the last drag ended: the click that follows it doesn't open the tooltip
  const [mv, setMvState] = useState<Move | null>(null);
  const mvRef = useRef<Move | null>(null);
  const setMv = (m: Move | null) => { mvRef.current = m; setMvState(m); };
  const [pop, setPop] = useState<{ left: number; top: number; below: boolean } | null>(null);
  const [ack, setAck] = useState<{ x: number; y: number; text: string; bad?: boolean } | null>(null);
  const clampD = (d: string) => (d < from ? from : d > to ? to : d);
  // No moving into the past: before today snaps to today (and the label says so).
  const snap = (d: string) => (clampD(d) < t ? { to: t, clamped: true } : { to: clampD(d), clamped: false });
  const titleOf = (m: Move) => m.pin.kind === "ms" ? m.pin.label : m.pick.length === 1 ? m.pin.items.find((i) => i.id === m.pick[0])?.title || "1 item" : `${m.pick.length} items`;
  const anchor = () => {
    const m = mvRef.current, r = svg.current?.getBoundingClientRect();
    if (!m || !r) return;
    const gx = r.left + diff(from, m.to) * dw + dw / 2, gy = r.top + m.pin.top + (m.pin.kind === "ms" ? 22 : 36), half = Math.min(POP, innerWidth - 16) / 2;
    const below = gy < 230;
    setPop({ left: Math.min(Math.max(gx, half + 8), innerWidth - half - 8), top: below ? gy + 18 : gy - 18, below });
  };
  const openConfirm = (m: Move) => {
    if (m.to === m.pin.date) { cancel(); return; }
    setMv({ ...m, phase: "confirm" }); anchor();
  };
  const cancel = () => { const kb = mvRef.current?.kb; setMv(null); setPop(null); if (kb) pinEl.current?.focus(); };
  const confirm = async () => {
    const m = mvRef.current;
    if (!m || m.phase !== "confirm" || (m.pin.kind === "items" && !m.pick.length)) return;
    setMv({ ...m, phase: "saving" }); setPop(null);
    const at = (d: string) => ({ x: Math.min(Math.max(x(d) + dw / 2, 60), W - 60), y: m.pin.top + 8 });
    let error: string | undefined;
    try { ({ error } = m.pin.kind === "ms" ? await moveMilestone(m.pin.project_id, m.pin.label, m.pin.date, m.to) : await moveItemsDue(m.pin.project_id, m.pick, m.to)); }
    catch { error = "the save didn't reach the server. Check your connection."; }
    if (error) { setMv(null); setAck({ ...at(m.pin.date), text: `Not moved: ${error}`, bad: true }); }
    else { setMv(mvRef.current?.pin.key === m.pin.key ? { ...m, phase: "saved" } : mvRef.current); setAck({ ...at(m.to), text: `Moved to ${fmt(m.to, { weekday: "short", month: "short", day: "numeric" })}` }); }
    if (m.kb) pinEl.current?.focus();
  };
  // Fresh data from the server replaces the optimistic ghost; the acknowledgement fades on its own.
  useEffect(() => { if (mvRef.current?.phase === "saved") setMv(null); }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!ack) return; const k = setTimeout(() => { setAck(null); if (mvRef.current?.phase === "saved") setMv(null); }, ack.bad ? 6000 : 2500); return () => clearTimeout(k); }, [ack]);
  useEffect(() => {
    if (mv?.phase !== "confirm") return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); cancel(); }
      else if (e.key === "Enter" && !(e.target as Element | null)?.closest?.("button")) { e.preventDefault(); confirm(); }
    };
    const away = (e: PointerEvent) => { if (!(e.target as Element | null)?.closest?.(".tl-pop")) cancel(); };
    const re = () => anchor();
    document.addEventListener("keydown", key); document.addEventListener("pointerdown", away, true);
    addEventListener("scroll", re, true); addEventListener("resize", re);
    return () => { document.removeEventListener("keydown", key); document.removeEventListener("pointerdown", away, true); removeEventListener("scroll", re, true); removeEventListener("resize", re); };
  }, [mv?.phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const begin = (pin: Pin, el: SVGGElement, kb: boolean, d: string) => {
    hide(); pinEl.current = el;
    setMv({ pin, ...snap(d), pick: pin.kind === "items" ? pin.items.map((i) => i.id) : [], kb, phase: "drag" });
  };
  const grab = (pin: Pin) => (e: React.PointerEvent<SVGGElement>) => {
    if (e.button !== 0 || mvRef.current) return;
    const el = e.currentTarget, id = e.pointerId, sx = e.clientX, sl = box.current?.scrollLeft || 0;
    let started = false, lastX = sx, raf = 0;
    const at = () => addDays(pin.date, Math.round((lastX - sx + (box.current?.scrollLeft || 0) - sl) / dw));
    const upd = () => { const m = mvRef.current; if (!m) return; const s = snap(at()); if (s.to !== m.to || s.clamped !== m.clamped) setMv({ ...m, ...s }); };
    // Near an edge of the scrolling chart, scroll it (faster the closer to the edge) and keep the ghost under the pointer.
    const tick = () => {
      const b = box.current;
      if (b && b.scrollWidth > b.clientWidth) {
        const r = b.getBoundingClientRect(), E = 40;
        const v = lastX < r.left + E ? -Math.ceil((r.left + E - lastX) / 3) : lastX > r.right - E ? Math.ceil((lastX - r.right + E) / 3) : 0;
        if (v) { b.scrollLeft += v; upd(); }
      }
      raf = requestAnimationFrame(tick);
    };
    const start = () => { if (started) return; started = true; clearTimeout(hold); begin(pin, el, false, pin.date); upd(); raf = requestAnimationFrame(tick); };
    // Mouse/pen: a few px of movement picks the pin up. Touch: a short hold does (a swipe still scrolls the chart).
    const touch = e.pointerType === "touch", hold = touch ? setTimeout(start, 280) : undefined;
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      lastX = ev.clientX;
      if (!started && !touch && Math.abs(lastX - sx) > 4) start();
      if (started) { ev.preventDefault(); upd(); }
    };
    const stopPan = (ev: TouchEvent) => { if (started) ev.preventDefault(); };
    const end = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      clearTimeout(hold); cancelAnimationFrame(raf);
      removeEventListener("pointermove", move); removeEventListener("pointerup", end); removeEventListener("pointercancel", end); removeEventListener("touchmove", stopPan);
      if (!started) return;
      dropped.current = Date.now();
      const m = mvRef.current;
      if (!m || ev.type === "pointercancel") cancel(); else openConfirm(m);
    };
    addEventListener("pointermove", move, { passive: false }); addEventListener("pointerup", end); addEventListener("pointercancel", end); addEventListener("touchmove", stopPan, { passive: false });
  };
  const keys = (pin: Pin) => (e: React.KeyboardEvent<SVGGElement>) => {
    const m = mvRef.current, mine = m?.pin.key === pin.key;
    if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && (!m || (mine && m.phase === "drag"))) {
      e.preventDefault();
      const d = addDays(mine ? m!.to : pin.date, (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 7 : 1));
      if (mine) setMv({ ...m!, ...snap(d) }); else begin(pin, e.currentTarget, true, d);
      const b = box.current, gx = diff(from, snap(d).to) * dw;
      if (b && (gx < b.scrollLeft + dw || gx > b.scrollLeft + b.clientWidth - 2 * dw)) b.scrollLeft = gx - b.clientWidth / 2;
    } else if (e.key === "Enter" && mine && m!.phase === "drag") e.preventDefault(); // opens on keyup: the same keystroke mustn't also press Confirm
    else if (e.key === "Escape" && mine && m!.phase === "drag") { e.preventDefault(); cancel(); }
  };
  const drag = (pin: Pin) => ({
    onPointerDown: grab(pin), onKeyDown: keys(pin), "data-pin": pin.key, role: "button", onContextMenu: (e: React.MouseEvent) => e.preventDefault(), // long press
    onKeyUp: (e: React.KeyboardEvent) => { const m = mvRef.current; if (e.key === "Enter" && m?.pin.key === pin.key && m.phase === "drag") openConfirm(m); },
    "aria-keyshortcuts": "ArrowLeft ArrowRight Shift+ArrowLeft Shift+ArrowRight Enter Escape",
    className: `tl-hit tl-pin${mv?.pin.key === pin.key && mv.phase !== "saved" ? " tl-moving" : ""}${mv?.pin.key === pin.key && mv.phase === "saved" && (pin.kind === "ms" || mv.pick.length === pin.items.length) ? " tl-gone" : ""}`,
  });
  const itemRows = (its: TItem[]) => its.slice(0, 8).map((i) => ({ text: `${i.title}${i.critical ? " · critical" : ""}${i.late ? " · overdue" : ""}${i.status === "doing" ? " · in progress" : ""}`, tone: i.late ? "bad" as const : i.critical ? "warn" as const : undefined }))
    .concat(its.length > 8 ? [{ text: `+${its.length - 8} more`, tone: undefined }] : []);
  const tone = (its: TItem[]) => (its.some((i) => i.late) ? "late" : its.some((i) => i.critical) ? "crit" : "");

  if (!lanes.length && !calendar?.length) return <div className="empty">Nothing dated between {fmt(from)} and {fmt(to)}: no milestones, no due dates, no planned blocks.</div>;

  return (
    <div className="tl">
      <div className="tl-grid">
        <div className="tl-labels" style={{ height: H }}>
          <div style={{ height: HEAD }} />
          {rows.map((r) => r.kind === "cal"
            ? <div key="cal" className="tl-lab" style={{ height: r.h }}><span><b>Calendar</b></span></div>
            : (
              <div key={r.lane!.key} className="tl-lab" style={{ height: r.h }} data-c={r.lane!.color}>
                {r.lane!.href ? <Link href={r.lane!.href}><i className="dot" /><b>{r.lane!.label}</b></Link> : <span><i className="dot" /><b>{r.lane!.label}</b></span>}
                <small>{r.lane!.sub}</small>
              </div>
            ))}
        </div>
        <div className="tl-scroll" ref={box} onScroll={hide}>
          <div className="tl-in" style={{ width: W, height: H }}>
            <svg ref={svg} width={W} height={H} role="group" aria-label={`Timeline from ${fmt(from)} to ${fmt(to)}: ${lanes.length} lanes`}>
              {/* weekends and week separators */}
              {days.map((d, i) => {
                const wd = (P(d).getUTCDay() + 6) % 7;
                return (
                  <g key={d}>
                    {wd >= 5 && <rect className="tl-we" x={i * dw} y={HEAD} width={dw} height={H - HEAD} />}
                    {wd === 0 && <line className="tl-wk" x1={i * dw} x2={i * dw} y1={14} y2={H} />}
                    {wd === 0 && <text className="tl-ax" x={i * dw + 3} y={HEAD - 8}>{fmt(d)}</text>}
                    {(d.endsWith("-01") || i === 0) && <text className="tl-mo" x={i * dw + 3} y={11}>{fmt(d, { month: "long" })}</text>}
                  </g>
                );
              })}
              {rows.map((r) => <line key={r.y} className="tl-row" x1={0} x2={W} y1={r.y} y2={r.y} />)}
              {guides.map((g) => <line key={"g" + g.date + g.label} className="tl-guide" x1={x(g.date) + dw / 2} x2={x(g.date) + dw / 2} y1={HEAD} y2={H} />)}

              {rows.map((r) => {
                if (r.kind === "cal") return (
                  <g key="cal">
                    {(calendar || []).map((c) => {
                      const cx = x(c.date) + dw / 2, k = c.events.length;
                      return (
                        <g key={c.date} className="tl-hit" {...hit(cx, r.y + 6, `${fmt(c.date, { weekday: "short", month: "short", day: "numeric" })} · ${k} event${k === 1 ? "" : "s"}`, c.events.slice(0, 8).map((e) => ({ text: `${e.allDay ? "all day" : e.time || ""} ${e.title}`.trim() })))}>
                          <rect x={x(c.date)} y={r.y} width={dw} height={r.h} fill="transparent" />
                          <circle className="tl-ev" cx={cx} cy={r.y + r.h / 2} r={Math.min(dw / 2 - 1.5, 2.5 + Math.min(k, 5))} />
                        </g>
                      );
                    })}
                  </g>
                );
                const l = r.lane!, top = r.y;
                return (
                  <g key={l.key} data-c={l.color}>
                    {/* Sunday-plan blocks: a bar per planned day; consecutive days join into a sprint bar */}
                    {l.plan.map((p) => (
                      <g key={p.date} className="tl-hit" {...hit(x(p.date) + dw / 2, top + 6, `Planned ${fmt(p.date, { weekday: "short", month: "short", day: "numeric" })} · ${hm(p.minutes)}`, p.blocks.map((b) => ({ text: `${b.start}–${b.end} ${b.title}` })))}>
                        <rect x={x(p.date)} y={top + 3} width={dw} height={12} fill="transparent" />
                        <rect className="tl-plan" x={x(p.date)} y={top + 5} width={dw - (l.plan.some((q) => q.date === addDays(p.date, 1)) ? 0 : 1.5)} height={7} style={{ opacity: Math.min(1, 0.45 + p.minutes / 360) }} />
                      </g>
                    ))}
                    {/* overdue before the range, and count after it */}
                    {l.before.length > 0 && (
                      <g className="tl-hit" {...hit(dw, top + 30, `${l.before.length} overdue before ${fmt(from)}`, itemRows(l.before))}>
                        <rect x={0} y={top + 20} width={dw * 2} height={26} fill="transparent" />
                        <text className="tl-late" x={2} y={top + 42}>‹{l.before.length}</text>
                      </g>
                    )}
                    {l.later > 0 && <text className="tl-ax" x={W - 3} y={top + 42} textAnchor="end">{l.later} later ›</text>}
                    {/* item ticks: one per day, height by count */}
                    {l.days.map((d) => {
                      const k = d.items.length, h = 7 + 3 * Math.min(k, 4), cx = x(d.date) + dw / 2, w = Math.max(4, Math.min(8, dw - 6));
                      const tn = tone(d.items);
                      const pin: Pin = { kind: "items", key: `i:${l.key}:${d.date}`, project_id: d.items[0].project_id, date: d.date, top, color: l.color, items: d.items };
                      return (
                        <g key={d.date} {...hit(cx, top + 44 - h, `${fmt(d.date, { weekday: "short", month: "short", day: "numeric" })} · ${k} due${d.date < t ? " (overdue)" : ""}`, itemRows(d.items))} {...drag(pin)}
                          aria-label={`${k} item${k === 1 ? "" : "s"} due ${fmt(d.date)}. Drag, or press arrow keys then Enter, to move.`}>
                          <rect x={x(d.date)} y={top + 26} width={dw} height={20} fill="transparent" />
                          <rect className={`tl-tick ${tn}`} x={cx - w / 2} y={top + 45 - h} width={w} height={h} rx={2} />
                        </g>
                      );
                    })}
                    {/* milestones: diamond + short label */}
                    {l.milestones.map((m, j) => {
                      const cx = x(m.date) + dw / 2, cy = top + 22, past = m.date < t;
                      const room = (l.milestones[j + 1] ? x(l.milestones[j + 1].date) - x(m.date) : W - x(m.date)) - 16;
                      const chars = Math.floor(room / 6.2);
                      const pin: Pin = { kind: "ms", key: `m:${l.key}:${m.project_id}:${m.date}:${m.label}`, project_id: m.project_id, date: m.date, top, color: l.color, label: m.label, prd: m.prd };
                      return (
                        <g key={m.date + m.label} {...hit(cx, cy - 8, `${m.label} · ${fmt(m.date, { weekday: "short", month: "short", day: "numeric" })}`, [
                          { text: past ? `${-diff(t, m.date)} days ago` : m.date === t ? "today" : `in ${diff(t, m.date)} days` },
                          { text: `${m.openBefore} open item${m.openBefore === 1 ? "" : "s"} due by then${m.criticalBefore ? ` · ${m.criticalBefore} critical` : ""}`, tone: m.lateBefore ? "bad" : undefined },
                          ...(m.prd ? [{ text: `PRD.md still says ${fmt(m.prd)}: the Mac writes the new date in on its next pass`, tone: "warn" as const }] : []),
                        ])} {...drag(pin)} aria-label={`Milestone ${m.label}, ${fmt(m.date)}. Drag, or press arrow keys then Enter, to move.`}>
                          <rect x={cx - 9} y={cy - 9} width={18} height={18} fill="transparent" />
                          <path className={`tl-ms${past ? " past" : ""}`} d={`M${cx},${cy - 7} L${cx + 7},${cy} L${cx},${cy + 7} L${cx - 7},${cy} Z`} />
                          {chars >= 4 && <text className="tl-mlab" x={cx + 10} y={cy + 4}>{short(m.label, chars)}</text>}
                        </g>
                      );
                    })}
                  </g>
                );
              })}
              {t >= from && t <= to && (
                <g>
                  <line className="tl-today" x1={x(t) + dw / 2} x2={x(t) + dw / 2} y1={HEAD - 4} y2={H} />
                  <text className="tl-todayl" x={x(t) + dw / 2} y={HEAD - 8} textAnchor="middle">Today</text>
                </g>
              )}
              {mv && (() => {
                const p = mv.pin, gx = x(mv.to) + dw / 2, k = mv.pick.length, h = 7 + 3 * Math.min(k, 4), w = Math.max(4, Math.min(8, dw - 6));
                return (
                  <g data-c={p.color} className={`tl-ghost${mv.phase === "saving" || mv.phase === "saved" ? " solid" : ""}`} pointerEvents="none">
                    <line className="tl-gline" x1={gx} x2={gx} y1={p.top + 2} y2={p.top + LANE - 2} />
                    {p.kind === "ms"
                      ? <path className="tl-ms" d={`M${gx},${p.top + 15} L${gx + 7},${p.top + 22} L${gx},${p.top + 29} L${gx - 7},${p.top + 22} Z`} />
                      : <rect className={`tl-tick${p.items.some((i) => i.critical && mv.pick.includes(i.id)) ? " crit" : ""}`} x={gx - w / 2} y={p.top + 45 - h} width={w} height={h} rx={2} />}
                  </g>
                );
              })()}
            </svg>
            {tip && (
              <div className={`tip tl-tip${tip.y < 110 ? " below" : ""}`} style={{ left: tip.x, top: tip.y }}>
                <div style={{ marginBottom: 3, fontWeight: 600 }}>{tip.title}</div>
                {tip.rows.map((r, i) => <div key={i} className={r.tone ? `tl-t-${r.tone}` : undefined}>{r.text}</div>)}
              </div>
            )}
            {mv && (mv.phase === "drag" || mv.phase === "confirm") && (
              <div className="tl-dlab" style={{ left: Math.min(Math.max(x(mv.to) + dw / 2, 70), W - 70), top: mv.pin.top + (mv.pin.kind === "ms" ? 13 : 42 - 3 * Math.min(mv.pick.length, 4) - 7) }} aria-live="polite">
                {mv.to === mv.pin.date ? fmt(mv.to) : <>{fmt(mv.pin.date)} → <b>{fmt(mv.to)}</b> ({sign(diff(mv.pin.date, mv.to))})</>}{mv.clamped ? " · not before today" : ""}
              </div>
            )}
            {ack && <div className={`tip tl-ack${ack.bad ? " bad" : ""}`} style={{ left: ack.x, top: ack.y }} role="status">{ack.text}</div>}
          </div>
        </div>
      </div>
      {mv?.phase === "confirm" && pop && (() => {
        const p = mv.pin, many = p.kind === "items" && p.items.length > 1;
        return (
          <div className={`tl-pop${pop.below ? " below" : ""}`} style={{ left: pop.left, top: pop.top }} role="dialog" aria-label="Confirm the move">
            <p>Move <b>{many ? `${mv.pick.length} item${mv.pick.length === 1 ? "" : "s"}` : titleOf(mv)}</b> to {fmt(mv.to, { weekday: "short", month: "short", day: "numeric" })}?</p>
            <small>{fmt(p.date)} → {fmt(mv.to)} ({sign(diff(p.date, mv.to))}){mv.clamped ? " · not before today, so today" : ""}</small>
            {many && p.kind === "items" && (
              <div className="tl-pick">
                {p.items.map((i) => (
                  <label key={i.id}><input type="checkbox" checked={mv.pick.includes(i.id)} onChange={(e) => setMv({ ...mv, pick: e.target.checked ? [...mv.pick, i.id] : mv.pick.filter((x) => x !== i.id) })} /><span>{i.title}</span></label>
                ))}
              </div>
            )}
            <small>{p.kind === "ms" ? "The project deadline moves now; the Mac also writes the new date into PRD.md's milestones table on its next pass." : mv.to > p.date ? "Changes the due date. Logged: the Monday review counts a later date as a slip." : "Changes the due date (logged in the item's history)."}</small>
            <div className="tl-pop-b">
              <button className="btn sm" autoFocus onClick={confirm} disabled={!!many && !mv.pick.length}>Confirm</button>
              <button className="btn sm ghost" onClick={cancel}>Cancel</button>
            </div>
          </div>
        );
      })()}
      <div className="legend" style={{ paddingTop: 10 }}>
        <span><svg width="12" height="12" aria-hidden="true"><path className="tl-ms" d="M6,0 L12,6 L6,12 L0,6 Z" /></svg>Milestone</span>
        <span><i className="tl-k" />Items due (taller = more)</span>
        <span><i className="tl-k crit" />Critical</span>
        <span><i className="tl-k late" />Overdue</span>
        <span><i className="tl-k plan" />Planned work (Sunday plan)</span>
        {calendar && <span><i className="tl-k cal" />Calendar events</span>}
        <span><i className="tl-k today" />Today</span>
        <span className="tl-howto">Drag a diamond or tick to move it (or focus it, ←/→, Enter); you confirm before it saves</span>
      </div>
      <details className="tabletoggle">
        <summary>Show as a list</summary>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead><tr><th>Date</th><th>Lane</th><th>What</th></tr></thead>
            <tbody>
              {lanes.flatMap((l) => [
                ...l.milestones.map((m) => ({ d: m.date, l: l.label, w: `Milestone: ${m.label}` })),
                ...l.days.map((d) => ({ d: d.date, l: l.label, w: `${d.items.length} due: ${d.items.map((i) => i.title).join("; ")}` })),
                ...l.plan.map((p) => ({ d: p.date, l: l.label, w: `Planned ${hm(p.minutes)}` })),
              ]).sort((a, b) => a.d.localeCompare(b.d)).map((r, i) => <tr key={i}><td>{fmt(r.d)}</td><td>{r.l}</td><td style={{ textAlign: "left" }}>{r.w}</td></tr>)}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

/** Upcoming milestones with days left and the open work due before each. */
export function MilestoneList({ data, showProject = true }: { data: TimelineData; showProject?: boolean }) {
  const t = data.today;
  if (!data.upcoming.length) return <div className="empty">No upcoming milestones. Add a dated Milestones table to a project&apos;s PRD.md and run the project sync.</div>;
  return (
    <div className="tl-ms-list">
      {data.upcoming.map((m) => {
        const n = diff(t, m.date);
        return (
          <div key={m.project_id + m.date + m.label} className="tl-msr" data-c={m.color}>
            <span className={`tl-days${n < 0 ? " past" : n <= 7 ? " soon" : ""}`}><b>{n < 0 ? -n : n}</b><small>{n < 0 ? "days ago" : n === 0 ? "today" : n === 1 ? "day left" : "days left"}</small></span>
            <span className="tl-mst">
              <span>{m.label}</span>
              <small>{showProject && <><i className="dot" /> <Link href={`/p/${m.project_id}?v=timeline`}>{m.name}</Link> · </>}{fmt(m.date, { weekday: "short", month: "short", day: "numeric", year: m.date.slice(0, 4) === t.slice(0, 4) ? undefined : "numeric" })}</small>
            </span>
            <span className={`due${m.lateBefore ? " late" : ""}`} title="Open checklist items due on or before this milestone">{m.openBefore} open{m.criticalBefore ? ` · ${m.criticalBefore} critical` : ""}{m.lateBefore ? ` · ${m.lateBefore} overdue` : ""}</span>
          </div>
        );
      })}
    </div>
  );
}
