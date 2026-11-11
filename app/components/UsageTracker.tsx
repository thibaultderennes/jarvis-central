"use client";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { isAutomatedUA } from "@/lib/automation";

/*
 * First-party usage tracking for the Monday Jarvis review: page views and clicks on links, buttons, tabs, chips,
 * checkboxes and menus, batched to /api/usage (sendBeacon). Mounted once in the (main) layout; one delegated
 * listener, nothing per component. Never records what you type: no input values, no free text from the page.
 * A label comes from `data-track`, else aria-label / title / a short button text with any text from the
 * surrounding row (item titles, todo names…) blanked out and numbers replaced by #. Links in the content are
 * recorded by their path only. A page is its path plus the view keys (?v=, ?k=, ?tab=) and the checklist filter codes
 * (?sec=, ?own=, ?due=, ?crit=, ?done=); client-side changes to those (Next syncs history.replaceState into
 * useSearchParams) are new page views. `data-track-section="…"` names a region; `data-track-off` excludes one.
 * Automated browsers (navigator.webdriver, a headless or Playwright user agent) record nothing, nor does a browser
 * that opened any page with ?notrack (remembered in localStorage; ?notrack=0 turns tracking back on).
 */
const URL_ = "/api/usage";
const NOTRACK = "jarvis-notrack";
const TARGETS = 'a[href], button, summary, select, [role="button"], [role="tab"], [role="menuitem"], [role="checkbox"], [role="switch"], [role="link"], input[type="checkbox"], input[type="radio"], input[type="submit"], [data-track]';
const REGIONS = '[role="tabpanel"], [role="dialog"], [role="tablist"], [role="menu"], [role="group"], nav, section, aside, header, form';
const ROWS = 'li, tr, article, [role="row"], [role="listitem"]';
const VIEW_KEYS = ["v", "k", "tab"]; // query keys that pick a view (e.g. /p/<id>?v=checklist), kept in the page name
const FILTER_KEYS = ["sec", "own", "due", "crit", "done"]; // checklist filter chips (codes, never typed text), kept after the view keys
const IDLE_MS = 30 * 60_000;

type Ev = { t: number; k: "click" | "view"; p: string; l?: string; g?: string; s?: string; h?: string };
const queue: Ev[] = [];
let sid = "", lastAt = 0, lastView = "", timer: ReturnType<typeof setTimeout> | null = null, off: boolean | null = null;

/** True for a script driving the browser or a browser opted out with ?notrack: nothing it does is recorded. */
export function untracked() {
  if (off !== null) return off;
  if (typeof window === "undefined") return true;
  try {
    const q = new URLSearchParams(location.search).get("notrack");
    if (q !== null) { if (/^(0|false|off|no)$/i.test(q)) localStorage.removeItem(NOTRACK); else localStorage.setItem(NOTRACK, "1"); }
    off = !!localStorage.getItem(NOTRACK);
  } catch { off = false; }
  return (off ||= !!navigator.webdriver || isAutomatedUA(navigator.userAgent));
}

function session() {
  const now = Date.now();
  if (!sid || now - lastAt > IDLE_MS) sid = Math.random().toString(36).slice(2, 10) + now.toString(36);
  lastAt = now;
  return sid;
}
function flush() {
  if (timer) { clearTimeout(timer); timer = null; }
  if (!queue.length) return;
  const body = JSON.stringify({ sid, events: queue.splice(0, 100) });
  try {
    if (!navigator.sendBeacon?.(URL_, new Blob([body], { type: "text/plain" })))
      fetch(URL_, { method: "POST", body, keepalive: true, headers: { "content-type": "text/plain" } }).catch(() => {});
  } catch { /* never break the page */ }
  if (queue.length) flush();
}
function push(e: Omit<Ev, "t">) {
  if (untracked()) return;
  session();
  queue.push({ t: Date.now(), ...e });
  if (queue.length >= 25) flush();
  else if (!timer) timer = setTimeout(flush, 15_000);
}

function pageName(pathname: string, search: string) {
  const q = new URLSearchParams(search), keep = new URLSearchParams();
  for (const k of VIEW_KEYS) { const v = q.get(k); if (v && /^[a-z][a-z0-9-]{0,24}$/.test(v)) keep.set(k, v); }
  for (const k of FILTER_KEYS) { const v = q.get(k); if (v && /^[a-z0-9][a-z0-9,_-]{0,40}$/i.test(v)) keep.set(k, v); }
  const s = keep.toString().replace(/%2C/gi, ",");
  return pathname + (s ? `?${s}` : "");
}
/** Internal destination path (no query values beyond the view keys); external links → their host only. */
function hrefOf(a: Element) {
  const raw = a.getAttribute("href");
  if (!raw || raw.startsWith("#") || /^(javascript|mailto|tel):/i.test(raw)) return undefined;
  try {
    const u = new URL(raw, location.href);
    return u.origin === location.origin ? pageName(u.pathname, u.search) : `/external/${u.host}`;
  } catch { return undefined; }
}
const clean = (s: string | null | undefined, n = 48) => (s || "").replace(/\s+/g, " ").trim().replace(/\d+/g, "#").slice(0, n);

/** Text shown around the element (its row), so a label like "Mark done: <todo title>" can drop the title. */
function rowText(el: Element): string[] {
  let box: Element | null = el.closest(ROWS) || el.parentElement;
  for (let level = 0; box && level < 5; level++, box = box.parentElement) {
    const out: string[] = [];
    const w = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(), i = 0; n && i < 300; n = w.nextNode(), i++) {
      if (el.contains(n) || n.parentElement?.closest("button")) continue; // button captions are UI words, not content
      const t = (n.nodeValue || "").replace(/\s+/g, " ").trim();
      if (t.length >= 3) out.push(t);
    }
    if (out.length) return out.sort((x, y) => y.length - x.length); // the nearest box with text of its own = the row
  }
  return [];
}
/** The element's visible text pieces, so "Project settings" + "planned" never run together as "Project settingsplanned". */
function textOf(el: Element): string[] {
  const out: string[] = [];
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(), i = 0; n && i < 60; n = w.nextNode(), i++) {
    if (n.parentElement?.closest('[aria-hidden="true"]')) continue;
    const t = (n.nodeValue || "").replace(/\s+/g, " ").trim();
    if (t) out.push(t);
  }
  return out;
}
function labelOf(el: Element, kind: string): string {
  const explicit = el.getAttribute("data-track");
  if (explicit) return clean(explicit, 60);
  // Menus and tab bars are the tool's own words; elsewhere a label can quote something you wrote.
  const inChrome = !!el.closest('nav, header, [role="tablist"], [role="menu"]');
  // A content link's text is usually something you wrote (an item, a review): keep only its path (see href).
  if (kind === "link" && !inChrome) return "";
  const pieces = textOf(el), text = pieces.join(" ");
  // A disclosure (<summary>, a button with aria-expanded) is named by its first words ("Later", "Agenda", "Done"), not its counts.
  const disclosure = kind === "disclosure" || el.hasAttribute("aria-expanded");
  let s = el.getAttribute("aria-label") || el.getAttribute("title") || (disclosure ? pieces[0] || "" : text.length <= 40 ? text : "");
  if (s && !inChrome) for (const t of rowText(el)) if (s.includes(t)) s = s.split(t).join("…");
  s = clean(s);
  if (disclosure && !s.replace(/[…#\s·]/g, "")) s = clean(`Disclosure in ${sectionOf(el) || "page"}`, 60);
  return s;
}
function kindOf(el: Element) {
  const role = el.getAttribute("role");
  if (role) return role;
  const tag = el.tagName.toLowerCase();
  if (tag === "a") return "link";
  if (tag === "summary") return "disclosure";
  if (tag === "input") return (el as HTMLInputElement).type;
  return tag;
}
function sectionOf(el: Element) {
  const named = el.closest("[data-track-section]");
  if (named) return clean(named.getAttribute("data-track-section"), 60);
  const r = el.parentElement?.closest(REGIONS);
  if (!r) return "";
  const by = r.getAttribute("aria-labelledby");
  const heading = by ? document.getElementById(by.split(" ")[0])?.textContent : null;
  return clean(r.getAttribute("aria-label") || heading || r.getAttribute("role") || r.tagName.toLowerCase(), 60);
}

function onClick(e: MouseEvent) {
  if (!e.isTrusted || !(e.target instanceof Element)) return;
  const el = e.target.closest(TARGETS);
  if (!el || el.closest("[data-track-off]")) return;
  const kind = kindOf(el);
  push({ k: "click", p: lastView || pageName(location.pathname, location.search), l: labelOf(el, kind), g: kind.slice(0, 20), s: sectionOf(el), h: el.tagName === "A" ? hrefOf(el) : undefined });
}
function onHide() { if (document.visibilityState === "hidden") flush(); }

export default function UsageTracker() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  useEffect(() => {
    document.addEventListener("click", onClick, { capture: true, passive: true });
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("click", onClick, { capture: true });
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);
  useEffect(() => {
    const p = pageName(pathname, search);
    if (p === lastView && Date.now() - lastAt < IDLE_MS) return;
    lastView = p;
    push({ k: "view", p });
  }, [pathname, search]);
  return null;
}
