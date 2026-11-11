"use client";
// The colony map's client side: the camera (drag to pan, pinch or ctrl+wheel and the buttons to zoom), selection with a
// command panel, a minimap, hover labels, day/night and pause. The scene itself is server-drawn SVG passed as children.
import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { setItemStatus, triageOverdue } from "@/lib/actions";

const LENS: [string, string][] = [["none", "Overview"], ["deadlines", "Deadlines"], ["activity", "Activity"], ["money", "Money"], ["security", "Security"], ["growth", "Growth"]];
const LENS_PART: Record<string, string[]> = { deadlines: ["hall"], activity: ["hall"], money: ["bank"], security: ["police"], growth: ["shop", "homes"] };
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

const KIND: Record<string, string> = { done: "Done on time", late: "Done late", review: "New review", audit: "New audit", pr: "Pull request waiting", failed: "Build stopped", building: "Build started" };

type Tone = "bad" | "warn" | "ok" | "none";
export type StageVillage = {
  id: string; name: string; color: string; href: string; status: { text: string; tone: Tone }; col: number; row: number;
  deadline: string; progress: { onTime: number; late: number; total: number } | null; headline: string | null; verdict: string | null;
  stats: { open: number; overdue: number; dueSoon: number; done28: number };
  items: { id: string; title: string; due: string | null; tone: "bad" | "warn" | "ok"; owner: string | null }[];
  claude: { working: string[]; waiting: { title: string; url: string | null }[]; failed: string[] } | null;
  series: { date: string; open: number; done: number }[]; landmark: string;
  lens: Record<string, { text: string; tone: Tone }>;
  events: { id: string; kind: string; text: string; ago: string; part: string; at: string }[];
  parts: { key: string; name: string; text: string; tone: Tone; href: string }[];
};
type View = { x: number; y: number; w: number; h: number };
type Cam = { cx: number; cy: number; w: number };

/** Open items and items finished, week by week: bars for finished, a line for open. */
function Trend({ series }: { series: StageVillage["series"] }) {
  if (series.length < 2) return null;
  const W = 160, H = 36, max = Math.max(1, ...series.map((p) => Math.max(p.open, p.done))), step = W / (series.length - 1);
  const y = (v: number) => H - 2 - (v / max) * (H - 6), last = series[series.length - 1], first = series[0];
  return (
    <div className="cs-trend">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Open items went from ${first.open} to ${last.open} over ${series.length} weeks; ${series.reduce((a, p) => a + p.done, 0)} finished`}>
        {series.map((p, i) => <rect key={p.date} className="tr-done" x={Math.max(0, i * step - 4)} y={y(p.done)} width={8} height={H - 2 - y(p.done)} />)}
        <polyline className="tr-open" points={series.map((p, i) => `${i * step},${y(p.open)}`).join(" ")} />
      </svg>
      <span>Open <b className="mono">{first.open}</b> to <b className="mono">{last.open}</b> in {series.length} weeks · <b className="mono">{series.reduce((a, p) => a + p.done, 0)}</b> finished</span>
    </div>
  );
}

export default function ColonyStage({ villages, view, cols, rows, season, today, now, past, full, weeks, children }: { villages: StageVillage[]; view: View; cols: number; rows: number; season: string; today: string; now: string; past: boolean; full: boolean; weeks: number; children: ReactNode }) {
  const wrap = useRef<HTMLDivElement>(null), cam = useRef<Cam>({ cx: view.x + view.w / 2, cy: view.y + view.h / 2, w: view.w }), raf = useRef(0);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const [sel, setSel] = useState<string | null>(null), [part, setPart] = useState<string | null>(null);
  const [night, setNight] = useState(false), [still, setStill] = useState(false), [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const [log, setLog] = useState(true), [fresh, setFresh] = useState<Set<string>>(new Set());
  const router = useRouter(), path = usePathname(), seen = useRef<Set<string> | null>(null);
  const [lens, setLens] = useState("none"), [item, setItem] = useState<string | null>(null), [busy, start] = useTransition(), [err, setErr] = useState<string | null>(null);
  const [due, setDue] = useState(""), [playing, setPlaying] = useState(false);
  const back = Math.round((Date.parse(now) - Date.parse(today)) / (7 * 86_400_000));
  const goto = useCallback((w: number) => start(() => router.replace(w <= 0 ? path : `${path}?at=${addDays(now, -7 * w)}`, { scroll: false })), [router, path, now]);
  // Replay: step forward one week each time the previous one has loaded.
  useEffect(() => { if (!playing || busy) return; if (back <= 0) { setPlaying(false); return; } const t = setTimeout(() => goto(back - 1), 900); return () => clearTimeout(t); }, [playing, busy, back, goto]);
  // The lens tints each settlement and dims the buildings it isn't about.
  useEffect(() => {
    wrap.current?.querySelectorAll<SVGGElement>(".vil").forEach((g) => { if (lens === "none") g.removeAttribute("data-lz"); else g.setAttribute("data-lz", g.getAttribute(`data-lz-${lens}`) || "none"); });
  }, [lens, villages]);
  const feed = useMemo(() => villages.flatMap((v) => v.events.map((e) => ({ ...e, v }))).sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 6), [villages]);
  // The map stays live: it asks the server again every minute while the tab is visible, and new events light up.
  useEffect(() => { const t = setInterval(() => { if (document.visibilityState === "visible" && !drag.current && !past) router.refresh(); }, 60_000); return () => clearInterval(t); }, [router]);
  useEffect(() => {
    const ids = villages.flatMap((v) => v.events.map((e) => `${v.id}|${e.id}`));
    if (seen.current) { const now = ids.filter((i) => !seen.current!.has(i)); if (now.length) setFresh(new Set(now)); }
    seen.current = new Set(ids);
  }, [villages]);
  const svg = () => wrap.current?.querySelector<SVGSVGElement>("svg.colony") || null;

  const apply = useCallback(() => {
    const s = svg(); if (!s) return;
    const r = s.getBoundingClientRect(); if (!r.width) return;
    const c = cam.current, h = c.w * r.height / r.width;
    s.setAttribute("viewBox", `${c.cx - c.w / 2} ${c.cy - h / 2} ${c.w} ${h}`);
    const far = c.w / view.w > 0.72, el = wrap.current; if (el && el.hasAttribute("data-far") !== far) el.toggleAttribute("data-far", far);
    s.style.setProperty("--bz", String(Math.min(1, Math.max(0.42, c.w / view.w))));
  }, [view.w]);
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
    setSel(id); setPart(p); setItem(null); setErr(null);
    const g = id ? wrap.current?.querySelector<SVGGElement>(`[data-vil="${CSS.escape(id)}"]`) : null;
    if (g && move) fly({ cx: Number(g.dataset.cx), cy: Number(g.dataset.cy) + 10, w: Math.min(cam.current.w, view.w * 0.5) });
  }, [fly, view]);

  useEffect(() => { fit(); const on = () => apply(); window.addEventListener("resize", on); return () => window.removeEventListener("resize", on); }, [fit, apply]);
  useEffect(() => { if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) setStill(true); const h = new Date().getHours(); if (h < 7 || h >= 19) setNight(true); }, []);
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

  // "Next": jump to the next settlement that needs you, like a strategy game's idle-worker button.
  const needy = villages.filter((v) => v.status.tone === "bad" || v.status.tone === "warn");
  const nextNeed = () => { if (!needy.length) return; const i = needy.findIndex((v) => v.id === sel); select(needy[(i + 1) % needy.length].id); };
  const hit = (t: EventTarget | null) => { const el = t as Element | null; return { vil: el?.closest?.("[data-vil]")?.getAttribute("data-vil") || null, part: el?.closest?.("[data-part]")?.getAttribute("data-part") || null, item: el?.closest?.("[data-item]")?.getAttribute("data-item") || null, free: !!el?.closest?.("[data-free]") }; };
  const pick = (h: ReturnType<typeof hit>) => { if (h.free) { router.push("/admin"); return; } select(h.vil, h.item ? "hall" : h.part, h.vil !== sel); if (h.item) { setItem(h.item); setDue(""); } };
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
  const onUp = (e: React.PointerEvent) => { const d = drag.current; drag.current = null; if (d?.moved) return; setTip(null); pick(hit(e.target)); };
  const onKey = (e: React.KeyboardEvent) => {
    const step = cam.current.w * 0.08, t = e.target as Element;
    if ((e.key === "Enter" || e.key === " ") && t.closest("[data-vil], [data-free]")) { e.preventDefault(); pick(hit(t)); return; }
    if (e.key === "Escape") { select(null); fit(); return; }
    if (e.key === "+" || e.key === "=") return zoom(0.8);
    if (e.key === "-") return zoom(1.25);
    const pan: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (pan[e.key]) { e.preventDefault(); cam.current = { ...cam.current, cx: cam.current.cx + pan[e.key][0], cy: cam.current.cy + pan[e.key][1] }; apply(); return; }
    if (e.key === "n" || e.key === "N") return nextNeed();
    const n = Number(e.key); if (n >= 1 && n <= villages.length) select(villages[n - 1].id);
  };

  const cur = villages.find((v) => v.id === sel) || null, curItem = cur?.items.find((i) => i.id === item) || null;
  const act = (fn: () => Promise<{ error?: string } | void>) => { setErr(null); start(async () => { const res = await fn(); if (res && res.error) setErr(res.error); else { setItem(null); router.refresh(); } }); };
  const sum = (f: (v: StageVillage) => number) => villages.reduce((a, v) => a + f(v.stats ? v : v), 0);
  const needs = villages.flatMap((v) => v.parts.filter((p) => p.tone === "bad" || p.tone === "warn").map((p) => ({ v, p }))).slice(0, 5);
  const mm = (c: number, r: number) => ({ left: `${50 + (c - r) * (50 / Math.max(cols, rows))}%`, top: `${(c + r + 1) * (100 / (cols + rows))}%` });
  return (
    <div className={`cs season-${season}${night ? " night" : ""}${still ? " still" : ""}${past ? " past" : ""}`} data-lens={lens}>
      <div className="cs-top">
        <span><b className="mono">{sum((v) => v.stats.open)}</b> open</span>
        <span className={sum((v) => v.stats.overdue) ? "bad" : undefined}><b className="mono">{sum((v) => v.stats.overdue)}</b> overdue</span>
        <span><b className="mono">{sum((v) => v.stats.dueSoon)}</b> due in 7 days</span>
        <span><b className="mono">{sum((v) => v.stats.done28)}</b> done, 28 days</span>
        <span className="cs-ctl">
          <button type="button" className="chip next" disabled={!needy.length} onClick={nextNeed} title="Jump to the next settlement that needs you (N)">Next that needs you{needy.length ? ` · ${needy.length}` : ""}</button>
          <button type="button" className="chip" aria-pressed={log} onClick={() => setLog(!log)}>Chronicle</button>
          <button type="button" className="chip" aria-pressed={night} onClick={() => setNight(!night)}>Night</button>
          <button type="button" className="chip" aria-pressed={still} onClick={() => setStill(!still)}>Pause</button>
          <button type="button" className="chip" aria-label="Zoom out" onClick={() => zoom(1.3)}>−</button>
          <button type="button" className="chip" aria-label="Zoom in" onClick={() => zoom(0.75)}>+</button>
          <button type="button" className="chip" onClick={() => { select(null); fit(); }}>Whole map</button>
        </span>
      </div>
      <div className="cs-bar2">
        <div className="chips" role="group" aria-label="Lens: colour every settlement by one question">{LENS.map(([id, label]) => <button key={id} type="button" className="chip" aria-pressed={lens === id} onClick={() => { setLens(id); if (sel) setPart(LENS_PART[id]?.[0] || null); }}>{label}</button>)}</div>
        {full && <div className="cs-time">
          <button type="button" className="chip" aria-pressed={playing} disabled={back <= 0 && !playing} onClick={() => setPlaying(!playing)}>{playing ? "Stop" : "Replay"}</button>
          <label><span className="sr">Weeks back</span><input type="range" min={0} max={weeks} step={1} value={weeks - back} onChange={(e) => { setPlaying(false); goto(weeks - Number(e.target.value)); }} aria-valuetext={back ? `${back} week${back === 1 ? "" : "s"} ago` : "Today"} /></label>
          <span className="mono">{back ? `${back} week${back === 1 ? "" : "s"} ago` : "Today"}{busy ? " …" : ""}</span>
          {past && <button type="button" className="chip" onClick={() => { setPlaying(false); goto(0); }}>Back to today</button>}
        </div>}
      </div>
      {past && <p className="cs-past">The colony as it stood on {today}, rebuilt from item dates. Due dates are today&apos;s, builds aren&apos;t replayed, and nothing can be changed here.</p>}
      <div ref={wrap} className="cs-view" tabIndex={0} aria-label="Colony map. Drag to move, pinch or use + and − to zoom, click a settlement to select it." onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={() => setTip(null)} onKeyDown={onKey}
        onDoubleClick={(e) => { const h = hit(e.target); const g = h.vil ? wrap.current?.querySelector<SVGGElement>(`[data-vil="${CSS.escape(h.vil)}"]`) : null; if (g) fly({ cx: Number(g.dataset.cx), cy: Number(g.dataset.cy) + 10, w: view.w * 0.3 }); }}>
        {children}
        {log && !sel && feed.length > 0 && (
          <ol className="cs-log" aria-label="Chronicle: what happened lately" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
            {feed.map((e, i) => <li key={e.v.id + e.id} data-c={e.v.color} className={`k-${e.kind}${fresh.has(`${e.v.id}|${e.id}`) ? " new" : ""}`} style={{ animationDelay: `${i * 90}ms` }}>
              <button type="button" onClick={() => select(e.v.id, e.part)}><i className="dot" aria-hidden="true" /><span className="cs-lt"><b>{e.v.name}</b> · {KIND[e.kind] || e.kind}<small>{e.text}</small></span><span className="cs-ago">{e.ago}</span></button>
            </li>)}
          </ol>
        )}
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
            <Trend series={cur.series} />
            {cur.claude && <p className="cs-cl"><b>Claude</b> {cur.claude.failed.length ? <span className="t-bad">build stopped: {cur.claude.failed[0]}</span> : cur.claude.waiting.length ? <>has {cur.claude.waiting.length === 1 ? "a pull request" : `${cur.claude.waiting.length} pull requests`} for you: {cur.claude.waiting[0].url ? <a href={cur.claude.waiting[0].url}>{cur.claude.waiting[0].title}</a> : cur.claude.waiting[0].title}</> : <>is building: {cur.claude.working[0]}</>}</p>}
            {cur.events.length > 0 && <ul className="cs-ev" aria-label="Lately">{cur.events.slice(0, 3).map((e) => <li key={e.id} className={`k-${e.kind}`}><b>{KIND[e.kind] || e.kind}</b> {e.text} <span className="cs-ago">{e.ago}</span></li>)}</ul>}
            <a className="cs-go" href={cur.href}>Open {cur.name}</a>
          </div>
          <div className="cs-right">
          {curItem ? (
            <div className={`cs-item t-${curItem.tone}`}>
              <div className="vg-k">Open item{curItem.due ? ` · due ${curItem.due}` : " · no due date"}{curItem.owner === "claude" ? " · Claude's" : ""}</div>
              <b>{curItem.title}</b>
              {past ? <p className="cs-d">Go back to today to change it.</p> : <div className="cs-acts">
                <button type="button" className="btn" disabled={busy} onClick={() => act(() => setItemStatus(cur.id, curItem.id, "done"))}>Mark done</button>
                <label><span className="sr">New due date</span><input type="date" min={now} value={due} onChange={(e) => setDue(e.target.value)} /></label>
                <button type="button" className="btn" disabled={busy || !due} onClick={() => act(() => triageOverdue([`${cur.id}/${curItem.id}`], "due", due, "/"))}>Move date</button>
                {curItem.owner !== "claude" && <button type="button" className="btn" disabled={busy} onClick={() => act(() => triageOverdue([`${cur.id}/${curItem.id}`], "claude", null, "/"))}>Give to Claude</button>}
                <a className="cs-go" href={`/p/${encodeURIComponent(cur.id)}?v=checklist#${encodeURIComponent(curItem.id)}`}>Open it</a>
                <button type="button" className="chip" onClick={() => setItem(null)}>Close</button>
              </div>}
              {err && <p className="cs-err" role="alert">{err}</p>}
            </div>
          ) : cur.items.length > 0 && <ul className="cs-crates" aria-label="Open items, most pressing first">{cur.items.slice(0, 4).map((i) => <li key={i.id}><button type="button" className={`t-${i.tone}`} onClick={() => { setItem(i.id); setDue(""); setPart("hall"); }}><span>{i.title}</span><span className="cs-ago">{i.due || "no date"}</span></button></li>)}</ul>}
          <ul className="cs-parts">{cur.parts.map((p) => <li key={p.key}><a href={p.href} className={`t-${p.tone}${part === p.key ? " on" : ""}`} onMouseEnter={() => setPart(p.key)}><span className="vg-k">{p.name}</span><span className="vg-v">{p.text}</span></a></li>)}</ul>
          <p className="cs-d">Landmark: {cur.landmark}</p>
          </div>
        </> : <>
          <div className="cs-info">
            <div className="cs-h"><b>Your colony</b></div>
            <p className="cs-d">Click a settlement to select it, or press its number. Drag to move, pinch to zoom, double-click to go close.</p>
            <ol className="cs-list">{villages.map((v, i) => <li key={v.id} data-c={v.color}><button type="button" onClick={() => select(v.id)}><span className="mono">{i + 1}</span><i className="dot" aria-hidden="true" /><b>{v.name}</b>{lens === "none" ? <span className={`t-${v.status.tone}`}>{v.status.text}</span> : <span className={`t-${v.lens[lens].tone}`}>{v.lens[lens].text}</span>}</button></li>)}</ol>
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
