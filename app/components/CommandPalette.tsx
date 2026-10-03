"use client";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { SearchItem, SearchProject } from "@/lib/search";
import { isMac, isTyping, PAGES } from "./keys";
import "./palette.css";

type Row = { key: string; group: string; label: string; href?: string; run?: () => void; color?: string; item?: SearchItem; hint?: string };
const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const hit = (q: string[], hay: string) => { const h = " " + fold(hay); return q.every((w) => h.includes(" " + w) || (w.length > 2 && h.includes(w))); };
const STATUS: Record<string, string> = { todo: "To do", doing: "In progress", done: "Done", cancelled: "Cancelled" };
const fmt = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("en-CA", { timeZone: "UTC", month: "short", day: "numeric" });
const GROUPS = ["Pages", "Projects", "Items", "Actions"];

/** ⌘K / Ctrl+K, "/" outside a text field, or `window.dispatchEvent(new Event("jarvis:palette"))`. */
export default function CommandPalette() {
  const router = useRouter(), uid = useId();
  const [open, setOpen] = useState(false), [q, setQ] = useState(""), [active, setActive] = useState(0);
  const [projects, setProjects] = useState<SearchProject[] | null>(null);
  const [items, setItems] = useState<SearchItem[]>([]), [loading, setLoading] = useState(false), [failed, setFailed] = useState(false);
  const [mac, setMac] = useState(true);
  const input = useRef<HTMLInputElement>(null), list = useRef<HTMLDivElement>(null), back = useRef<HTMLElement | null>(null);

  const show = useCallback(() => {
    if (!(document.activeElement instanceof HTMLElement) || !document.activeElement.closest(".cmdk")) back.current = document.activeElement as HTMLElement | null;
    setOpen(true);
  }, []);
  const close = useCallback((restore = true) => {
    setOpen(false); setQ(""); setItems([]); setActive(0);
    if (restore) { const el = back.current; setTimeout(() => el?.isConnected && el.focus({ preventScroll: true }), 0); }
  }, []);

  useEffect(() => {
    setMac(isMac());
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") { e.preventDefault(); if (document.querySelector(".cmdk")) close(); else show(); }
      else if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey && !e.defaultPrevented && !isTyping(e.target) && !document.querySelector("[aria-modal='true']")) { e.preventDefault(); show(); }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("jarvis:palette", show);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("jarvis:palette", show); };
  }, [show, close]);

  // Projects once, on first open; items as you type (debounced, the previous request cancelled).
  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const lock = document.body.style.overflow; document.body.style.overflow = "hidden";
    if (!projects) fetch("/api/search?projects=1").then((r) => (r.ok ? r.json() : Promise.reject())).then((d) => setProjects(d.projects || [])).catch(() => setFailed(true));
    return () => { document.body.style.overflow = lock; };
  }, [open, projects]);
  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    if (!term) { setItems([]); setLoading(false); return; }
    const ac = new AbortController();
    setLoading(true);
    const t = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: ac.signal }).then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((d) => { setItems(d.items || []); setFailed(false); setLoading(false); })
        .catch((e) => { if (e?.name !== "AbortError") { setFailed(true); setLoading(false); } });
    }, 140);
    return () => { clearTimeout(t); ac.abort(); };
  }, [q, open]);

  const go = useCallback((href: string, after?: () => void) => {
    close(false);
    const u = new URL(href, location.href);
    if (u.pathname === location.pathname && u.search === location.search && u.hash) {
      history.pushState(null, "", u.hash);
      document.getElementById(decodeURIComponent(u.hash.slice(1)))?.scrollIntoView({ block: "center" });
    } else router.push(href);
    after?.();
  }, [close, router]);

  const byId = useMemo(() => Object.fromEntries((projects || []).map((p) => [p.id, p])), [projects]);
  const rows = useMemo<Row[]>(() => {
    const w = fold(q).split(" ").filter(Boolean);
    const pages = PAGES.filter((p) => !w.length || hit(w, `${p.label} ${p.words}`))
      .map((p): Row => ({ key: "pg" + p.href, group: "Pages", label: p.label, href: p.href, hint: p.key ? `g ${p.key}` : undefined }));
    const projs = (projects || []).filter((p) => !w.length || hit(w, `${p.name} ${p.id}`))
      .map((p): Row => ({ key: "pj" + p.id, group: "Projects", label: p.name, href: `/p/${p.id}`, color: p.color, hint: p.tagline }));
    const its = items.map((i): Row => ({ key: `it:${i.project_id}:${i.id}`, group: "Items", label: i.title, href: `/p/${i.project_id}?v=checklist#item-${encodeURIComponent(i.id)}`, color: byId[i.project_id]?.color || "other", item: i }));
    const acts: Row[] = [
      { key: "a-msg", group: "Actions", label: "New message to Claude", hint: "Inbox", run: () => go("/inbox#msg", () => focusWhenThere("msg")) },
      { key: "a-todo", group: "Actions", label: "Plan today: add a todo", hint: "Today", href: "/today" },
      { key: "a-keys", group: "Actions", label: "Keyboard shortcuts", hint: "?", run: () => { close(false); window.dispatchEvent(new Event("jarvis:shortcuts")); } },
    ].filter((a) => !w.length || hit(w, `${a.label} ${a.hint} message claude todo shortcuts keys help`));
    return [...pages, ...projs, ...its, ...acts];
  }, [q, projects, items, byId, go, close]);
  useEffect(() => { setActive(0); }, [q, items]);
  useEffect(() => { list.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" }); }, [active]);

  const pick = (r: Row | undefined) => { if (!r) return; if (r.run) r.run(); else if (r.href) go(r.href); };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const n = rows.length;
    if (e.key === "ArrowDown") { e.preventDefault(); if (n) setActive((a) => (a + 1) % n); }
    else if (e.key === "ArrowUp") { e.preventDefault(); if (n) setActive((a) => (a - 1 + n) % n); }
    else if (e.key === "Home" && e.ctrlKey) { e.preventDefault(); setActive(0); }
    else if (e.key === "End" && e.ctrlKey) { e.preventDefault(); setActive(Math.max(0, n - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); if (!e.nativeEvent.isComposing) pick(rows[active]); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === "Tab") e.preventDefault();
  };

  if (!open) return null;
  const today = new Date().toLocaleDateString("en-CA");
  const listId = `${uid}-list`, opt = (i: number) => `${uid}-o${i}`;
  let idx = -1;
  return (
    <div className="cmdk-back" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="cmdk" role="dialog" aria-modal="true" aria-label="Jump to">
        <div className="cmdk-in">
          <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M13 13l4.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKeyDown} placeholder="Jump to a page, project or item code…"
            role="combobox" aria-expanded="true" aria-controls={listId} aria-autocomplete="list" aria-activedescendant={rows.length ? opt(active) : undefined}
            autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} enterKeyHint="go" aria-label="Search pages, projects and checklist items" />
          {loading && <i className="cmdk-spin" aria-hidden="true" />}
          <button type="button" className="cmdk-esc" onClick={() => close()} aria-label="Close">Esc</button>
        </div>
        <div className="cmdk-list" id={listId} role="listbox" ref={list} aria-label="Results">
          {GROUPS.map((g) => {
            const rs = rows.filter((r) => r.group === g);
            const searching = g === "Items" && q.trim() && !rs.length;
            if (!rs.length && !searching) return null;
            return (
              <div key={g} role="group" aria-labelledby={`${uid}-${g}`}>
                <div className="cmdk-g" id={`${uid}-${g}`}>{g}</div>
                {searching && <div className="cmdk-none">{loading ? "Searching…" : failed ? "Search is unavailable right now." : "No checklist item matches."}</div>}
                {rs.map((r) => {
                  idx++;
                  const i = idx, it = r.item;
                  return (
                    <div key={r.key} id={opt(i)} data-i={i} role="option" aria-selected={i === active} className="cmdk-o" data-c={r.color}
                      onMouseMove={() => i !== active && setActive(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(r)}>
                      {r.color ? <i className="dot" /> : <i className="cmdk-ic" aria-hidden="true">{g === "Pages" ? "→" : "+"}</i>}
                      <span className="cmdk-t">
                        <b>{r.label}</b>
                        {it ? (
                          <span className="cmdk-s">
                            {byId[it.project_id]?.name || it.project_id} · <span className={`cst-${it.status}`}>{STATUS[it.status] || it.status}</span>
                            {it.due && <> · <span className={`due${it.due < today && (it.status === "todo" || it.status === "doing") ? " late" : ""}`}>{fmt(it.due)}</span></>}
                          </span>
                        ) : r.hint && g === "Projects" ? <span className="cmdk-s">{r.hint}</span> : null}
                      </span>
                      {it ? <code className="pill code">{it.id}</code> : r.hint && g !== "Projects" ? <kbd>{r.hint}</kbd> : null}
                    </div>
                  );
                })}
              </div>
            );
          })}
          {!rows.length && !q.trim() && <div className="cmdk-none">{failed ? "Couldn't load your projects." : "Loading…"}</div>}
        </div>
        <div className="cmdk-f" aria-hidden="true">
          <span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>↵</kbd> open</span><span><kbd>esc</kbd> close</span>
          <span className="sp" /><span>{mac ? "⌘K" : "Ctrl K"} anywhere · <kbd>?</kbd> shortcuts</span>
        </div>
        <div className="sr" aria-live="polite">{q.trim() && !loading ? `${rows.length} results` : ""}</div>
      </div>
    </div>
  );
}

/** After a client navigation, focus a field once it exists (the inbox composer). */
function focusWhenThere(id: string) {
  let n = 0;
  const t = setInterval(() => { const el = document.getElementById(id); if (el || ++n > 40) { clearInterval(t); el?.focus(); } }, 50);
}
