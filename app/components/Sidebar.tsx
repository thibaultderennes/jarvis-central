"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

export type NavProject = { id: string; name: string; color: string; open: number; late: number };
type Props = {
  pinned: NavProject[]; projects: NavProject[]; waiting: number; fresh: number; todayLeft: number; needs: number; workerAt: string | null;
  rail: boolean; railCookie: string; version: string; children: React.ReactNode;
};

/* One stroke style for every icon: 20px box, 1.6 stroke, round joins. */
const PATHS: Record<string, string> = {
  home: "M3.5 9.2 10 4l6.5 5.2V16a.8.8 0 0 1-.8.8H12.2v-4.6H7.8v4.6H4.3a.8.8 0 0 1-.8-.8z",
  today: "M10 2.8v1.6M10 15.6v1.6M2.8 10h1.6M15.6 10h1.6M4.9 4.9l1.1 1.1M14 14l1.1 1.1M4.9 15.1 6 14M14 6l1.1-1.1M10 6.6a3.4 3.4 0 1 1 0 6.8 3.4 3.4 0 0 1 0-6.8z",
  week: "M3.5 5.2h13v11.3h-13zM3.5 8.6h13M7 3.2v3.4M13 3.2v3.4M6.5 11.6h1.4M9.3 11.6h1.4M12.1 11.6h1.4M6.5 14h1.4M9.3 14h1.4",
  timeline: "M3.5 4.5v11M6.5 6h6M9 10h7.5M6.5 14h5",
  inbox: "M3.5 11.5 5.6 4.8h8.8l2.1 6.7v3.9a.8.8 0 0 1-.8.8H4.3a.8.8 0 0 1-.8-.8zM3.5 11.5h3.8l1 1.9h3.4l1-1.9h3.8",
  reviews: "M5.5 2.8h6.2l3 3V17H5.5zM11.5 2.8v3.2h3.2M7.8 9.5h4.6M7.8 12.3h4.6M7.8 15h2.6",
  finance: "M10 2.8v14.4M13.4 6.3c-.6-1.1-1.9-1.7-3.4-1.7-1.9 0-3.3 1-3.3 2.5 0 3.5 6.9 1.9 6.9 5.6 0 1.5-1.5 2.6-3.6 2.6-1.6 0-2.9-.7-3.5-1.8",
  stats: "M3.5 16.5h13M5.5 13.5v3M9 9.5v7M12.5 11.5v5M16 6v10.5M5.5 9.5 9 6l3.5 2.5L16 3.5",
  admin: "M10 7.3a2.7 2.7 0 1 1 0 5.4 2.7 2.7 0 0 1 0-5.4zM10 2.8l1.3 1.9 2.2-.5.4 2.2 2 1-.9 2.1.9 2.1-2 1-.4 2.2-2.2-.5L10 17.2l-1.3-1.9-2.2.5-.4-2.2-2-1 .9-2.1-.9-2.1 2-1 .4-2.2 2.2.5z",
  search: "M8.8 3.8a5 5 0 1 1 0 10 5 5 0 0 1 0-10zM12.4 12.4l4.1 4.1",
  rail: "M3.5 4h13v12h-13zM8 4v12M13.2 8.2 11.4 10l1.8 1.8",
  expand: "M3.5 4h13v12h-13zM8 4v12M11.4 8.2l1.8 1.8-1.8 1.8",
  menu: "M3.5 5.5h13M3.5 10h13M3.5 14.5h13",
  out: "M8 3.5H4.3v13H8M12 6.5 15.5 10 12 13.5M15.5 10H7.5",
  close: "M5 5l10 10M15 5 5 15",
};
export function Icon({ n, size = 18 }: { n: keyof typeof PATHS | string; size?: number }) {
  return <svg className="ico" width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={PATHS[n]} /></svg>;
}
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
      title={iconic ? `${p.name} · ${p.late ? `${p.late} late` : `${p.open} open`}` : p.name}>
      <span className="sb-dot" aria-hidden="true"><i className="dot" />{p.late > 0 && <b />}</span><span className="sb-l">{p.name}</span>
      {p.late > 0 ? <span className="sb-n late" aria-label={`${p.late} late`}>{p.late} late</span> : p.open > 0 && <span className="sb-n" aria-label={`${p.open} open`}>{p.open}</span>}
    </Link>
  );

  return (
    <div className={`app${rail ? " rail" : ""}${open ? " drawer" : ""}`}>
      <aside ref={sb} className="sb" id="sidebar" aria-label="Jarvis" {...(open ? { role: "dialog", "aria-modal": true } : {})}>
        <div className="sb-in">
          <div className="sb-top">
            <Link href="/" className="sb-brand" title={iconic ? "Sentient Dash · Home" : undefined}><i className="pulse" aria-hidden="true" /><span className="sb-l">Sentient <span>Dash</span></span></Link>
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
            {pinned.length > 0 && <><div className="sb-h">Pinned</div>{pinned.map((p) => <Proj key={p.id} p={p} />)}</>}
            {projects.length > 0 && <><div className="sb-h">Projects</div>{projects.map((p) => <Proj key={p.id} p={p} />)}</>}
            <div className="sb-h">Library</div>
            <Item href="/reviews" icon="reviews" label="Reviews" />
            <Item href="/admin" icon="admin" label="Admin" />
          </nav>
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
