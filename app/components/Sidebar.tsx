"use client";
import Link from "next/link";
import { Icon, Mark } from "./icons";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

export type NavProject = { id: string; name: string; color: string; open: number; late: number; soon: number };
type Props = {
  pinned: NavProject[]; projects: NavProject[]; waiting: number; fresh: number; todayLeft: number; needs: number; workerAt: string | null;
  rail: boolean; railCookie: string; version: string; children: React.ReactNode;
};

function ago(t: string) {
  const m = Math.round((Date.now() - +new Date(t)) / 6e4);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
}
const NARROW = "(max-width: 1099px)";

/** The app shell: left sidebar (icon rail when collapsed or under 1100px), bottom bar + drawer on phones. */
export default function Sidebar({ pinned, projects, waiting, fresh, todayLeft, needs, workerAt, rail: railCookieOn, railCookie, version, children }: Props) {
  const path = usePathname();
  const [now, setNow] = useState(0);
  const [rail, setRail] = useState(railCookieOn);
  const [narrow, setNarrow] = useState(false);
  const [open, setOpen] = useState(false);
  const sb = useRef<HTMLElement>(null), opener = useRef<HTMLElement | null>(null);
  useEffect(() => { setNow(Date.now()); const t = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(t); }, []);
  useEffect(() => { const m = matchMedia(NARROW), f = () => setNarrow(m.matches); f(); m.addEventListener("change", f); return () => m.removeEventListener("change", f); }, []);
  const close = useCallback(() => { setOpen(false); opener.current?.focus?.(); }, []);
  useEffect(() => { setOpen(false); }, [path]);
  // Drawer: focus the first link, keep Tab inside, Esc closes.
  useEffect(() => {
    if (!open) return;
    const el = sb.current!, items = () => [...el.querySelectorAll<HTMLElement>("a[href], button:not([disabled])")].filter((x) => x.offsetParent !== null);
    items()[0]?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); close(); return; }
      if (e.key !== "Tab") return;
      const l = items(), first = l[0], last = l[l.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", key);
    document.documentElement.classList.add("noscroll");
    return () => { document.removeEventListener("keydown", key); document.documentElement.classList.remove("noscroll"); };
  }, [open, close]);
  const openDrawer = (e: React.MouseEvent<HTMLElement>) => { opener.current = e.currentTarget; setOpen(true); };
  const toggle = (e: React.MouseEvent<HTMLElement>) => {
    if (narrow) return open ? close() : openDrawer(e);
    const next = !rail; setRail(next);
    document.cookie = `${railCookie}=${next ? 1 : 0}; path=/; max-age=31536000; samesite=lax`;
  };
  const iconic = (rail || narrow) && !open; // labels hidden: tooltips carry them
  const on = (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(href + "/")) ? "page" : undefined;
  const alive = workerAt && now && now - +new Date(workerAt) < 5 * 60_000;
  const worker = !workerAt ? "Mac worker not connected yet" : now ? (alive ? "Mac worker online" : `Mac worker last seen ${ago(workerAt)}`) : "Mac worker";
  const inbox = waiting ? `${waiting}` : fresh ? `${fresh} new` : "";

  const Item = ({ href, icon, label, count, tone }: { href: string; icon: string; label: string; count?: string | number; tone?: "late" | "hot" }) => (
    <Link href={href} className="sb-a" aria-current={on(href)} title={iconic ? (count ? `${label} · ${count}` : label) : undefined}>
      <Icon n={icon} /><span className="sb-l">{label}</span>
      {!!count && <span className={`sb-n${tone ? ` ${tone}` : ""}`}>{count}</span>}
    </Link>
  );
  const Proj = ({ p }: { p: NavProject }) => (
    <Link href={`/p/${p.id}`} className="sb-a sb-p" aria-current={on(`/p/${p.id}`)} data-c={p.color}
      title={iconic ? `${p.name} · ${[p.late && `${p.late} late`, p.soon && `${p.soon} due in 7 days`].filter(Boolean).join(" · ") || `${p.open} open`}` : p.name}>
      <span className="sb-dot" aria-hidden="true"><i className="dot" />{p.late > 0 ? <b /> : p.soon > 0 && <b className="soon" />}</span><span className="sb-l">{p.name}</span>
      {p.late > 0 && <span className="sb-n late" aria-label={`${p.late} late`} title={`${p.late} late`}>{p.late}</span>}
      {p.soon > 0 && <span className="sb-n soon" aria-label={`${p.soon} due in the next 7 days`} title={`${p.soon} due in the next 7 days`}>{p.soon}</span>}
      {!p.late && !p.soon && p.open > 0 && <span className="sb-n" aria-label={`${p.open} open`}>{p.open}</span>}
    </Link>
  );

  return (
    <div className={`app${rail ? " rail" : ""}${open ? " drawer" : ""}`}>
      <aside ref={sb} className="sb" id="sidebar" aria-label="Jarvis" {...(open ? { role: "dialog", "aria-modal": true } : {})}>
        <div className="sb-in">
          <div className="sb-top">
            <Link href="/" className="sb-brand" title={iconic ? "Sentient Dash · Home" : undefined}><Mark size={22} className="live" /><span className="sb-l">Sentient <span>Dash</span></span></Link>
            <button className="sb-tog" onClick={toggle} aria-label={open ? "Close the menu" : iconic ? "Expand the sidebar" : "Collapse the sidebar"} title={open ? "Close (Esc)" : iconic ? "Expand" : "Collapse"} aria-expanded={narrow ? open : !rail} aria-controls="sidebar">
              <Icon n={open ? "close" : iconic ? "expand" : "rail"} />
            </button>
          </div>
          <div className={`sb-worker ${!workerAt || !now ? "" : alive ? "on" : "off"}`} title={`${worker}. The Claude worker on your Mac checks for messages every minute.`}>
            <i aria-hidden="true" /><span className="sb-l">{worker}</span>
          </div>
          <button className="sb-jump" onClick={() => { setOpen(false); window.dispatchEvent(new Event("jarvis:palette")); }} title={iconic ? "Jump to… (⌘K)" : undefined} aria-keyshortcuts="Meta+K">
            <Icon n="search" /><span className="sb-l">Jump to…</span><kbd className="sb-l">⌘K</kbd>
          </button>
          <nav className="sb-nav" aria-label="Sections">
            <div className="sb-h">You</div>
            <Item href="/" icon="home" label="Home" count={needs || undefined} />
            <Item href="/today" icon="today" label="Today" count={todayLeft || undefined} />
            <Item href="/week" icon="week" label="Week" />
            <Item href="/timeline" icon="timeline" label="Timeline" />
            <Item href="/inbox" icon="inbox" label="Inbox" count={inbox} tone={waiting || fresh ? "hot" : undefined} />
            <Item href="/stats" icon="stats" label="Stats" />
            <Item href="/finance" icon="finance" label="Finance" />
            {pinned.length > 0 && <><div className="sb-h pin">Pinned</div>{pinned.map((p) => <Proj key={p.id} p={p} />)}</>}
            {projects.length > 0 && <><div className="sb-h">Projects</div>{projects.map((p) => <Proj key={p.id} p={p} />)}</>}
            <div className="sb-h">Library</div>
            <Item href="/reviews" icon="reviews" label="Reviews" />
            <Item href="/admin" icon="admin" label="Admin" />
          </nav>
          <div className="sb-legend sb-l" aria-hidden="true"><span><i className="late" />late</span><span><i className="soon" />due in 7 days</span></div>
          <div className="sb-foot">
            <span className="sb-ver sb-l" title="Sentient Dash version (see CHANGELOG.md in the repo)">v{version}</span>
            <form action="/api/auth/logout" method="post"><button className="sb-out" title={iconic ? "Sign out" : undefined} aria-label="Sign out"><Icon n="out" size={16} /><span className="sb-l">Sign out</span></button></form>
          </div>
        </div>
      </aside>
      {open && <div className="sb-scrim" onClick={close} aria-hidden="true" />}
      <main className="shell">{children}</main>
      <nav className="bbar" aria-label="Quick sections">
        <Link href="/" aria-current={on("/")}><Icon n="home" /><span>Home</span>{needs > 0 && <b>{needs}</b>}</Link>
        <Link href="/today" aria-current={on("/today")}><Icon n="today" /><span>Today</span>{todayLeft > 0 && <b>{todayLeft}</b>}</Link>
        <Link href="/week" aria-current={on("/week")}><Icon n="week" /><span>Week</span></Link>
        <Link href="/inbox" aria-current={on("/inbox")}><Icon n="inbox" /><span>Inbox</span>{(waiting || fresh) > 0 && <b className="hot">{waiting || fresh}</b>}</Link>
        <button onClick={openDrawer} aria-expanded={open} aria-controls="sidebar"><Icon n="menu" /><span>Menu</span></button>
      </nav>
    </div>
  );
}
