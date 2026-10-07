"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { resetDashboardTab, saveDashboardLayout } from "@/lib/actions";
import { BOXES, nudge, readingOrder, settle, type Place, type Tab } from "@/lib/dashLayout";
import { Icon } from "./icons";

/**
 * The dashboard's boxes on a 12-column grid. ↑ / ↓ on every box swap it with its neighbour (no Customize needed). Customize: drag a box by its title bar anywhere, drag its corner to resize,
 * fold it to its title, remove it, or add one back from the library; arrow keys move a focused title bar and Shift +
 * arrows resize it. Everything settles so boxes never overlap, and the tab's layout is saved on the site. Box bodies
 * are rendered on the server (`nodes`); this component only places them. Under 700px the boxes stack in order.
 */
export default function DashCanvas({ tab, places: initial, nodes, hints }: { tab: Tab; places: Place[]; nodes: Record<string, React.ReactNode>; hints: Record<string, string> }) {
  const router = useRouter();
  const [places, setPlaces] = useState(initial);
  const [editing, setEditing] = useState(false), [lib, setLib] = useState(false);
  const [msg, setMsg] = useState(""), [pending, start] = useTransition();
  const grid = useRef<HTMLDivElement>(null);
  const live = useRef(places); live.current = places;
  useEffect(() => setPlaces(initial), [initial]);
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(""), 2500); return () => clearTimeout(t); }, [msg]);

  const commit = (next: Place[], movedId: string | null, note = "Saved") => {
    const settled = settle(next, movedId);
    setPlaces(settled);
    start(async () => { const r = await saveDashboardLayout(tab, settled).catch(() => ({ error: "Couldn't save the layout. Try again." })); setMsg(r.error || note); });
  };
  const upd = (id: string, f: (p: Place) => Place) => live.current.map((p) => (p.id === id ? f(p) : p));

  // Pointer: move by the title bar, resize by the corner. The box follows the grid live; the drop settles and saves.
  const down = (id: string, mode: "move" | "size") => (e: React.PointerEvent) => {
    if (!editing || e.button !== 0 || (e.target as Element).closest("button")) return;
    e.preventDefault();
    const g = grid.current!.getBoundingClientRect(), col = (g.width + 12) / 12, row = 48 + 12;
    const p0 = live.current.find((p) => p.id === id)!, sx = e.clientX, sy = e.clientY + scrollY;
    // Near the top or bottom edge the page scrolls by itself, so a box can travel the whole page in one drag.
    let last: PointerEvent | null = null, raf = 0;
    const edge = () => {
      raf = 0;
      if (!last) return;
      const v = last.clientY < 72 ? -18 : last.clientY > innerHeight - 72 ? 18 : 0;
      if (v) { scrollBy(0, v); mv(last); raf = requestAnimationFrame(edge); }
    };
    const mv = (ev: PointerEvent) => {
      last = ev;
      if (!raf) raf = requestAnimationFrame(edge);
      const dx = Math.round((ev.clientX - sx) / col), dy = Math.round((ev.clientY + scrollY - sy) / row);
      setPlaces(upd(id, (p) => mode === "size"
        ? { ...p, w: Math.max(2, Math.min(12 - p.x, p0.w + dx)), h: Math.max(1, p0.h + dy) }
        : { ...p, x: Math.max(0, Math.min(12 - p.w, p0.x + dx)), y: Math.max(0, p0.y + dy) }));
    };
    const up = () => { cancelAnimationFrame(raf); last = null; removeEventListener("pointermove", mv); removeEventListener("pointerup", up); commit(live.current, id, mode === "size" ? "Resized" : "Moved"); };
    addEventListener("pointermove", mv); addEventListener("pointerup", up);
  };
  const keys = (id: string) => (e: React.KeyboardEvent) => {
    if (!editing || !e.key.startsWith("Arrow")) return;
    e.preventDefault();
    const [dx, dy] = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, number[]>)[e.key];
    commit(upd(id, (p) => e.shiftKey ? { ...p, w: Math.max(2, Math.min(12 - p.x, p.w + dx)), h: Math.max(1, p.h + dy) } : { ...p, x: Math.max(0, Math.min(12 - p.w, p.x + dx)), y: Math.max(0, p.y + dy) }), id, e.shiftKey ? "Resized" : "Moved");
    requestAnimationFrame(() => grid.current?.querySelector<HTMLElement>(`[data-box="${id}"] .dbh`)?.focus());
  };
  const missing = Object.keys(nodes).filter((id) => !places.some((p) => p.id === id));

  return (
    <div className={`dash${editing ? " editing" : ""}`}>
      <div className="dash-tools">
        <span className="ack" role="status">{pending ? "Saving…" : msg}</span>
        {editing && <button className="btn sm ghost" onClick={() => setLib(true)}>Add box{missing.length ? ` (${missing.length})` : ""}</button>}
        {editing && <button className="btn sm ghost" onClick={() => start(async () => { await resetDashboardTab(tab); router.refresh(); setMsg("Layout reset"); })}>Reset layout</button>}
        <button className="btn sm" aria-pressed={editing} onClick={() => { setEditing(!editing); setLib(false); }}>{editing ? "Done" : "Customize"}</button>
      </div>
      <div className="dgrid" ref={grid}>
        {places.map((p) => (
          <section key={p.id} id={`box-${p.id}`} data-box={p.id} className={`dbox${p.min ? " min" : ""}`} aria-label={BOXES[p.id]?.title}
            style={{ gridColumn: `${p.x + 1} / span ${p.w}`, gridRow: `${p.y + 1} / span ${p.min ? 1 : p.h}` }}>
            <div className="dbh" tabIndex={editing ? 0 : -1} onPointerDown={down(p.id, "move")} onKeyDown={keys(p.id)}
              aria-roledescription={editing ? "movable box: arrow keys move it, Shift + arrows resize it" : undefined}>
              {editing && <span className="dgrip" aria-hidden="true"><Icon n="drag" size={14} /></span>}
              <h2>{BOXES[p.id]?.title}</h2>
              {hints[p.id] && <span className="hint">{hints[p.id]}</span>}
              {(() => {
                const order = readingOrder(places), i = order.findIndex((x) => x.id === p.id), t = BOXES[p.id]?.title;
                const go = (dir: -1 | 1) => {
                  const next = nudge(live.current, p.id, dir);
                  if (!next) return;
                  setPlaces(next);
                  start(async () => { const r = await saveDashboardLayout(tab, next).catch(() => ({ error: "Couldn't save the layout. Try again." })); setMsg(r.error || (dir < 0 ? `Moved ${t} up` : `Moved ${t} down`)); });
                  requestAnimationFrame(() => document.getElementById(`box-${p.id}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
                };
                return <>
                  <button className="dib dmv" onClick={() => go(-1)} disabled={i <= 0} aria-label={`Move ${t} up`} title="Move up">↑</button>
                  <button className="dib dmv" onClick={() => go(1)} disabled={i >= order.length - 1} aria-label={`Move ${t} down`} title="Move down">↓</button>
                </>;
              })()}
              <button className="dib" onClick={() => commit(upd(p.id, (x) => ({ ...x, min: !x.min })), p.id, p.min ? "Unfolded" : "Folded")} aria-label={`${p.min ? "Unfold" : "Fold"} ${BOXES[p.id]?.title}`} aria-expanded={!p.min}>{p.min ? "+" : "−"}</button>
              {editing && <button className="dib" onClick={() => commit(live.current.filter((x) => x.id !== p.id), null, `Removed ${BOXES[p.id]?.title}: Add box brings it back`)} aria-label={`Remove ${BOXES[p.id]?.title}`}>×</button>}
            </div>
            {!p.min && <div className="dbb">{nodes[p.id]}</div>}
            {editing && !p.min && <span className="drz" onPointerDown={down(p.id, "size")} aria-hidden="true" />}
          </section>
        ))}
        {!places.length && <div className="panel empty" style={{ gridColumn: "1 / -1" }}>Every box is removed. Customize → Add box puts them back.</div>}
      </div>
      {lib && (
        <aside className="dlib" aria-label="Add a box">
          <div className="dlib-h"><b>Add a box</b><button className="btn sm ghost" onClick={() => setLib(false)} autoFocus>Close</button></div>
          {missing.length ? missing.map((id) => (
            <div key={id} className="dlib-it">
              <span><b>{BOXES[id].title}</b><small>{BOXES[id].what}</small></span>
              <button className="btn sm" onClick={() => { const b = BOXES[id]; commit([{ id, x: 0, y: 0, w: b.at[2], h: b.at[3] }, ...live.current], id, `Added ${b.title} at the top`); }}>Add</button>
            </div>
          )) : <p className="due">Every box is already on the page.</p>}
        </aside>
      )}
    </div>
  );
}
