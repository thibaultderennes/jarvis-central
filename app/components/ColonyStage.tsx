"use client";
// The colony map's client side: the camera (drag to pan, pinch or ctrl+wheel and the buttons to zoom), selection with a
// command panel, a minimap, hover labels, day/night and pause. The scene itself is server-drawn SVG passed as children.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

type Tone = "bad" | "warn" | "ok" | "none";
export type StageVillage = {
  id: string; name: string; color: string; href: string; status: { text: string; tone: Tone }; col: number; row: number;
  deadline: string; progress: { onTime: number; late: number; total: number } | null; headline: string | null; verdict: string | null;
  stats: { open: number; overdue: number; dueSoon: number; done28: number };
  parts: { key: string; name: string; text: string; tone: Tone; href: string }[];
};
type View = { x: number; y: number; w: number; h: number };
type Cam = { cx: number; cy: number; w: number };

export default function ColonyStage({ villages, view, cols, rows, children }: { villages: StageVillage[]; view: View; cols: number; rows: number; children: ReactNode }) {
  const wrap = useRef<HTMLDivElement>(null), cam = useRef<Cam>({ cx: view.x + view.w / 2, cy: view.y + view.h / 2, w: view.w }), raf = useRef(0);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const [sel, setSel] = useState<string | null>(null), [part, setPart] = useState<string | null>(null);
  const [night, setNight] = useState(false), [still, setStill] = useState(false), [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const svg = () => wrap.current?.querySelector<SVGSVGElement>("svg.colony") || null;

  const apply = useCallback(() => {
    const s = svg(); if (!s) return;
    const r = s.getBoundingClientRect(); if (!r.width) return;
    const c = cam.current, h = c.w * r.height / r.width;
    s.setAttribute("viewBox", `${c.cx - c.w / 2} ${c.cy - h / 2} ${c.w} ${h}`);
  }, []);
  const fitW = useCallback(() => { const r = svg()?.getBoundingClientRect(); return r && r.width ? Math.max(view.w, view.h * r.width / r.height) : view.w; }, [view]);
  const fly = useCallback((to: Cam) => {
    cancelAnimationFrame(raf.current);
    const from = { ...cam.current }, t0 = performance.now(), ms = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 320;
    const tick = (now: number) => {
      const k = ms ? Math.min(1, (now - t0) / ms) : 1, e = 1 - (1 - k) ** 3;
      cam.current = { cx: from.cx + (to.cx - from.cx) * e, cy: from.cy + (to.cy - from.cy) * e, w: from.w + (to.w - from.w) * e };
      apply(); if (k < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  }, [apply]);
  const fit = useCallback(() => fly({ cx: view.x + view.w / 2, cy: view.y + view.h / 2, w: fitW() }), [fly, fitW, view]);
  const zoom = useCallback((f: number, px = 0.5, py = 0.5) => {
    const s = svg(); if (!s) return;
    const r = s.getBoundingClientRect(), c = cam.current, h = c.w * r.height / r.width, max = fitW() * 1.05;
    const w = Math.min(max, Math.max(view.w * 0.16, c.w * f)), nh = w * r.height / r.width;
    const wx = c.cx - c.w / 2 + px * c.w, wy = c.cy - h / 2 + py * h;
    cam.current = { cx: wx - (px - 0.5) * w, cy: wy - (py - 0.5) * nh, w }; apply();
  }, [apply, fitW, view]);
  const select = useCallback((id: string | null, p: string | null = null, move = true) => {
    setSel(id); setPart(p);
    const g = id ? wrap.current?.querySelector<SVGGElement>(`[data-vil="${CSS.escape(id)}"]`) : null;
    if (g && move) fly({ cx: Number(g.dataset.cx), cy: Number(g.dataset.cy) + 10, w: Math.min(cam.current.w, view.w * 0.5) });
  }, [fly, view]);

  useEffect(() => { fit(); const on = () => apply(); window.addEventListener("resize", on); return () => window.removeEventListener("resize", on); }, [fit, apply]);
  useEffect(() => { if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) setStill(true); if (window.matchMedia("(prefers-color-scheme: dark)").matches) setNight(true); }, []);
  useEffect(() => { const s = svg(); if (!s) return; if (still) s.pauseAnimations(); else s.unpauseAnimations(); }, [still]);
  useEffect(() => {
    wrap.current?.querySelectorAll(".vil.sel, .ib.sel").forEach((e) => e.classList.remove("sel"));
    if (!sel) return;
    const g = wrap.current?.querySelector(`[data-vil="${CSS.escape(sel)}"]`);
    g?.classList.add("sel"); if (part) g?.querySelectorAll(`[data-part="${part}"]`).forEach((e) => e.classList.add("sel"));
  }, [sel, part]);
  // Pinch and ctrl/cmd + wheel zoom at the cursor; a plain wheel keeps scrolling the page.
  useEffect(() => {
    const el = wrap.current; if (!el) return;
    const on = (e: WheelEvent) => { if (!e.ctrlKey && !e.metaKey) return; e.preventDefault(); const r = el.getBoundingClientRect(); zoom(Math.exp(e.deltaY * 0.01), (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height); };
    el.addEventListener("wheel", on, { passive: false }); return () => el.removeEventListener("wheel", on);
  }, [zoom]);

  const hit = (t: EventTarget | null) => { const el = t as Element | null; return { vil: el?.closest?.("[data-vil]")?.getAttribute("data-vil") || null, part: el?.closest?.("[data-part]")?.getAttribute("data-part") || null }; };
  const onDown = (e: React.PointerEvent) => { if (e.button !== 0) return; drag.current = { x: e.clientX, y: e.clientY, moved: false }; };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current, r = wrap.current!.getBoundingClientRect();
    if (d) {
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (!d.moved && Math.hypot(dx, dy) < 5) return;
      if (!d.moved) { d.moved = true; cancelAnimationFrame(raf.current); (e.currentTarget as Element).setPointerCapture(e.pointerId); setTip(null); }
      const k = cam.current.w / r.width; cam.current = { ...cam.current, cx: cam.current.cx - dx * k, cy: cam.current.cy - dy * k }; d.x = e.clientX; d.y = e.clientY; apply(); return;
    }
    const text = (e.target as Element).closest?.("[data-tip]")?.getAttribute("data-tip");
    setTip(text ? { x: e.clientX - r.left, y: e.clientY - r.top, text } : null);
  };
  const onUp = (e: React.PointerEvent) => { const d = drag.current; drag.current = null; if (d?.moved) return; const h = hit(e.target); select(h.vil, h.part, h.vil !== sel); };
  const onKey = (e: React.KeyboardEvent) => {
    const step = cam.current.w * 0.08, t = e.target as Element;
    if ((e.key === "Enter" || e.key === " ") && t.closest("[data-vil]")) { e.preventDefault(); const h = hit(t); select(h.vil, h.part); return; }
    if (e.key === "Escape") { select(null); fit(); return; }
    if (e.key === "+" || e.key === "=") return zoom(0.8);
    if (e.key === "-") return zoom(1.25);
    const pan: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (pan[e.key]) { e.preventDefault(); cam.current = { ...cam.current, cx: cam.current.cx + pan[e.key][0], cy: cam.current.cy + pan[e.key][1] }; apply(); return; }
    const n = Number(e.key); if (n >= 1 && n <= villages.length) select(villages[n - 1].id);
  };

  const cur = villages.find((v) => v.id === sel) || null;
  const sum = (f: (v: StageVillage) => number) => villages.reduce((a, v) => a + f(v.stats ? v : v), 0);
  const needs = villages.flatMap((v) => v.parts.filter((p) => p.tone === "bad" || p.tone === "warn").map((p) => ({ v, p }))).slice(0, 5);
  const mm = (c: number, r: number) => ({ left: `${50 + (c - r) * (50 / Math.max(cols, rows))}%`, top: `${(c + r + 1) * (100 / (cols + rows))}%` });
  return (
    <div className={`cs${night ? " night" : ""}${still ? " still" : ""}`}>
      <div className="cs-top">
        <span><b className="mono">{sum((v) => v.stats.open)}</b> open</span>
        <span className={sum((v) => v.stats.overdue) ? "bad" : undefined}><b className="mono">{sum((v) => v.stats.overdue)}</b> overdue</span>
        <span><b className="mono">{sum((v) => v.stats.dueSoon)}</b> due in 7 days</span>
        <span><b className="mono">{sum((v) => v.stats.done28)}</b> done, 28 days</span>
        <span className="cs-ctl">
          <button type="button" className="chip" aria-pressed={night} onClick={() => setNight(!night)}>Night</button>
          <button type="button" className="chip" aria-pressed={still} onClick={() => setStill(!still)}>Pause</button>
          <button type="button" className="chip" aria-label="Zoom out" onClick={() => zoom(1.3)}>−</button>
          <button type="button" className="chip" aria-label="Zoom in" onClick={() => zoom(0.75)}>+</button>
          <button type="button" className="chip" onClick={() => { select(null); fit(); }}>Whole map</button>
        </span>
      </div>
      <div ref={wrap} className="cs-view" tabIndex={0} aria-label="Colony map. Drag to move, pinch or use + and − to zoom, click a settlement to select it." onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={() => setTip(null)} onKeyDown={onKey}
        onDoubleClick={(e) => { const h = hit(e.target); const g = h.vil ? wrap.current?.querySelector<SVGGElement>(`[data-vil="${CSS.escape(h.vil)}"]`) : null; if (g) fly({ cx: Number(g.dataset.cx), cy: Number(g.dataset.cy) + 10, w: view.w * 0.3 }); }}>
        {children}
        {tip && <div className="cs-tip" style={{ left: tip.x, top: tip.y }}>{tip.text}</div>}
      </div>
      <div className="cs-panel" aria-live="polite">
        <div className="cs-mini" aria-label="Settlements">
          {villages.map((v, i) => <button key={v.id} type="button" className={`mm t-${v.status.tone}`} data-c={v.color} style={mm(v.col, v.row)} aria-pressed={sel === v.id} title={`${i + 1}. ${v.name}: ${v.status.text}`} aria-label={`${v.name}: ${v.status.text}`} onClick={() => select(v.id)} />)}
        </div>
        {cur ? <>
          <div className="cs-info" data-c={cur.color}>
            <div className="cs-h"><i className="dot" aria-hidden="true" /><b>{cur.name}</b><span className={`vg-st t-${cur.status.tone}`}>{cur.status.text}</span></div>
            <p className="cs-d">{cur.deadline}</p>
            {cur.progress && <div className="cs-bar" title={`${cur.progress.onTime} of ${cur.progress.total} done on time${cur.progress.late ? `, ${cur.progress.late} late` : ""}`}><i style={{ width: `${cur.progress.onTime / cur.progress.total * 100}%` }} /><i className="late" style={{ width: `${cur.progress.late / cur.progress.total * 100}%` }} /></div>}
            <dl className="cs-s"><div><dt>Open</dt><dd>{cur.stats.open}</dd></div><div className={cur.stats.overdue ? "bad" : undefined}><dt>Overdue</dt><dd>{cur.stats.overdue}</dd></div><div><dt>Due in 7 days</dt><dd>{cur.stats.dueSoon}</dd></div><div><dt>Done, 28 days</dt><dd>{cur.stats.done28}</dd></div></dl>
            {cur.headline && <p className="cs-r">{cur.verdict && <span className={`verdict v-${cur.verdict}`}>{cur.verdict.replace("-", " ")}</span>} {cur.headline}</p>}
            <a className="cs-go" href={cur.href}>Open {cur.name}</a>
          </div>
          <ul className="cs-parts">{cur.parts.map((p) => <li key={p.key}><a href={p.href} className={`t-${p.tone}${part === p.key ? " on" : ""}`} onMouseEnter={() => setPart(p.key)}><span className="vg-k">{p.name}</span><span className="vg-v">{p.text}</span></a></li>)}</ul>
        </> : <>
          <div className="cs-info">
            <div className="cs-h"><b>Your colony</b></div>
            <p className="cs-d">Click a settlement to select it, or press its number. Drag to move, pinch to zoom, double-click to go close.</p>
            <ol className="cs-list">{villages.map((v, i) => <li key={v.id} data-c={v.color}><button type="button" onClick={() => select(v.id)}><span className="mono">{i + 1}</span><i className="dot" aria-hidden="true" /><b>{v.name}</b><span className={`t-${v.status.tone}`}>{v.status.text}</span></button></li>)}</ol>
          </div>
          <div className="cs-info">
            <div className="cs-h"><b>Needs you</b></div>
            {needs.length ? <ul className="cs-list">{needs.map(({ v, p }) => <li key={v.id + p.key} data-c={v.color}><button type="button" onClick={() => select(v.id, p.key)}><i className="dot" aria-hidden="true" /><b>{v.name} · {p.name}</b><span className={`t-${p.tone}`}>{p.text}</span></button></li>)}</ul> : <p className="cs-d">Nothing is asking for you.</p>}
          </div>
        </>}
      </div>
    </div>
  );
}
