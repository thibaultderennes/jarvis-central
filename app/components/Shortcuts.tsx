"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { isMac, isTyping, PAGES } from "./keys";
import "./palette.css";

const GO = PAGES.filter((p) => p.key);

/** g h / g t / g w / g i / g l / g s jump between pages; "?" (or `window` event "jarvis:shortcuts") shows the cheat sheet. */
export default function Shortcuts() {
  const router = useRouter();
  const [help, setHelp] = useState(false), [pending, setPending] = useState(false), [mac, setMac] = useState(true);
  const gAt = useRef(0), back = useRef<HTMLElement | null>(null), closeBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setMac(isMac());
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reset = () => { gAt.current = 0; setPending(false); clearTimeout(timer); };
    const openHelp = () => { back.current = document.activeElement as HTMLElement | null; setHelp(true); };
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || e.defaultPrevented || isTyping(e.target) || e.isComposing) { if (gAt.current) reset(); return; }
      if (document.querySelector(".cmdk")) return;
      const k = e.key;
      if (gAt.current && Date.now() - gAt.current < 1500) {
        const p = GO.find((x) => x.key === k.toLowerCase());
        reset();
        if (p) { e.preventDefault(); setHelp(false); router.push(p.href); }
        return;
      }
      if (k === "g" && !e.shiftKey) { gAt.current = Date.now(); setPending(true); clearTimeout(timer); timer = setTimeout(reset, 1500); }
      else if (k === "?") { e.preventDefault(); if (document.querySelector(".keys-sheet")) setHelp(false); else openHelp(); }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("jarvis:shortcuts", openHelp);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("jarvis:shortcuts", openHelp); clearTimeout(timer); };
  }, [router]);

  useEffect(() => {
    if (!help) return;
    closeBtn.current?.focus();
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); setHelp(false); } };
    window.addEventListener("keydown", onEsc);
    return () => { window.removeEventListener("keydown", onEsc); const el = back.current; if (el?.isConnected) el.focus({ preventScroll: true }); };
  }, [help]);

  return (
    <>
      {pending && <div className="keys-pending" aria-hidden="true"><kbd>g</kbd> then {GO.map((p) => <span key={p.key}><kbd>{p.key}</kbd> {p.label}</span>)}</div>}
      {help && (
        <div className="cmdk-back" onMouseDown={(e) => { if (e.target === e.currentTarget) setHelp(false); }}>
          <div className="keys-sheet" role="dialog" aria-modal="true" aria-labelledby="keys-t">
            <div className="keys-h"><h2 id="keys-t" className="ph-t">Keyboard shortcuts</h2><span className="sp" /><button ref={closeBtn} type="button" className="cmdk-esc" onClick={() => setHelp(false)} aria-label="Close">Esc</button></div>
            <dl>
              {[
                [<><kbd>{mac ? "⌘" : "Ctrl"}</kbd><kbd>K</kbd> or <kbd>/</kbd></>, "Jump to a page, project or item"],
                ...GO.map((p) => [<><kbd>g</kbd><kbd>{p.key}</kbd></>, p.label] as const),
                [<kbd key="q">?</kbd>, "This list"], [<kbd key="e">Esc</kbd>, "Close a dialog"],
              ].map(([k, d], i) => <div key={i}><dt>{k}</dt><dd>{d}</dd></div>)}
            </dl>
            <p className="keys-n">Shortcuts are off while you type in a field.</p>
          </div>
        </div>
      )}
    </>
  );
}
