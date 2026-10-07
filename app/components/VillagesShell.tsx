"use client";
// The Map box's client side: the Map / List switch (remembered per viewer) and "since your last visit" growth.
// Both live in this browser's localStorage only; without it the map renders the same and nothing pops.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { newSince } from "@/lib/villages";

const VIEW_KEY = "jarvis.map.view", SEEN_KEY = "jarvis.map.seen";
type Seen = { id: string; name: string; onTime: number };

export default function VillagesShell({ map, list, seen }: { map: ReactNode; list: ReactNode; seen: Seen[] }) {
  const [view, setView] = useState<"map" | "list">("map");
  const [grown, setGrown] = useState<{ total: number; text: string } | null>(null);
  const root = useRef<HTMLDivElement>(null), ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; // dev strict mode runs effects twice; the second run would read what the first just wrote
    ran.current = true;
    try { const v = localStorage.getItem(VIEW_KEY); if (v === "list" || v === "map") setView(v); } catch { /* private mode */ }
    let before: Record<string, number> | null = null;
    try { const raw = JSON.parse(localStorage.getItem(SEEN_KEY) || "null"); if (raw && typeof raw === "object") before = raw; } catch { /* ignore */ }
    if (before) {
      const parts: string[] = [];
      let total = 0, delay = 0;
      for (const p of seen) {
        const was = before[p.id];
        if (typeof was !== "number") continue; // a new project: nothing to compare yet
        const k = newSince(p.onTime, was);
        if (k > 0) { total += k; parts.push(`${p.name} ${k}`); }
        // The town hall rises once when it reached a new tier since the last visit.
        root.current?.querySelectorAll(`[data-vil="${CSS.escape(p.id)}"] [data-since]`).forEach((el) => {
          if (Number(el.getAttribute("data-since")) > was) {
            (el as SVGElement).style.animationDelay = `${(delay++ % 6) * 80}ms`;
            el.classList.add("pop");
          }
        });
      }
      if (total) setGrown({ total, text: parts.join(", ") });
    }
    try { localStorage.setItem(SEEN_KEY, JSON.stringify(Object.fromEntries(seen.map((p) => [p.id, p.onTime])))); } catch { /* ignore */ }
  }, [seen]);

  const pick = (v: "map" | "list") => { setView(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* ignore */ } };
  return (
    <div ref={root} className="arch-shell">
      <div className="arch-bar">
        <div className="chips" role="group" aria-label="Show as">
          <button type="button" className="chip" aria-pressed={view === "map"} onClick={() => pick("map")}>Map</button>
          <button type="button" className="chip" aria-pressed={view === "list"} onClick={() => pick("list")}>List</button>
        </div>
        {grown && (
          <span className="arch-new" title={`Items done on time since your last visit: ${grown.text}`}>
            <b className="mono">+{grown.total}</b> done on time since your last visit
            <span className="sr"> ({grown.text})</span>
          </span>
        )}
      </div>
      <div hidden={view !== "map"}>{map}</div>
      <div hidden={view !== "list"}>{list}</div>
    </div>
  );
}
