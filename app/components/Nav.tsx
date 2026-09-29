"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { track } from "@/lib/actions";

type Tab = { id: string; name: string; color: string };
function ago(t: string) {
  const m = Math.round((Date.now() - +new Date(t)) / 6e4);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
}

export default function Nav({ projects, waiting, fresh, workerAt }: { projects: Tab[]; waiting: number; fresh: number; workerAt: string | null }) {
  const path = usePathname();
  const [now, setNow] = useState(0);
  useEffect(() => { setNow(Date.now()); const t = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(t); }, []);
  useEffect(() => { track("page_view", path).catch(() => {}); }, [path]);
  const on = (href: string) => (href === "/" ? path === "/" : path.startsWith(href)) ? "page" : undefined;
  const alive = workerAt && now && now - +new Date(workerAt) < 5 * 60_000;
  return (
    <header className="topbar">
      <div className="topbar-in">
        <div className="brandrow">
          <Link href="/" className="word"><i className="pulse" aria-hidden="true" />Jarvis <span>Central</span></Link>
          <span className="sp" />
          <span className={`worker ${!workerAt ? "" : alive ? "on" : "off"}`} title="The Claude worker on your Mac checks for messages every minute">
            <i />{!workerAt ? "Mac worker not connected yet" : now ? (alive ? "Mac worker online" : `Mac worker last seen ${ago(workerAt)}`) : ""}
          </span>
          <span className="ver" title="Jarvis Central version (see CHANGELOG.md in the repo)">v{process.env.NEXT_PUBLIC_JARVIS_VERSION || "dev"}</span>
          <form action="/api/auth/logout" method="post"><button className="logout">Sign out</button></form>
        </div>
        <nav className="tabs" aria-label="Sections">
          <Link href="/" aria-current={on("/")}>Overview</Link>
          <Link href="/today" aria-current={on("/today")}>Today</Link>
          <Link href="/week" aria-current={on("/week")}>Week</Link>
          {projects.length > 0 && <span className="sep" aria-hidden="true" />}
          {projects.map((p) => (
            <Link key={p.id} href={`/p/${p.id}`} aria-current={on(`/p/${p.id}`)} data-c={p.color}><i className="dot" />{p.name}</Link>
          ))}
          <span className="sep" aria-hidden="true" />
          <Link href="/reviews" aria-current={on("/reviews")}>Reviews</Link>
          <Link href="/inbox" aria-current={on("/inbox")}>Inbox{waiting + fresh > 0 && <span className="badge">{waiting ? `${waiting} waiting` : `${fresh} new`}</span>}</Link>
        </nav>
      </div>
    </header>
  );
}
