import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { boardData } from "@/lib/board";
import { addDays, fmtDate, isDate, today } from "@/lib/time";
import Board from "@/components/Board";
import "./board.css";

export default async function TodayPage({ searchParams }: { searchParams: Promise<{ d?: string }> }) {
  await requireSession();
  const sp = await searchParams, t = today();
  const d = isDate(sp.d) ? sp.d : t;
  const data = await boardData(d, d);
  return (
    <>
      <div className="hello">
        <div>
          <h1 className="page">{d === t ? "Today" : fmtDate(d, { weekday: "long", month: "long", day: "numeric" })}</h1>
          <p className="sub">Decide what happens to anything overdue or due today, then work the list: ticking a work todo also ticks its checklist item. The load line shows how much is left against a day of focus.</p>
        </div>
        <nav className="daynav" aria-label="Change day">
          <Link href={`/today?d=${addDays(d, -1)}`}>‹ {fmtDate(addDays(d, -1), { weekday: "short" })}</Link>
          {d !== t && <Link href="/today">Today</Link>}
          <span className="cur">{fmtDate(d, { weekday: "short", month: "short", day: "numeric" })}</span>
          <Link href={`/today?d=${addDays(d, 1)}`}>{fmtDate(addDays(d, 1), { weekday: "short" })} ›</Link>
        </nav>
      </div>
      <Board mode="day" days={[d]} {...data} />
    </>
  );
}
