import { requireSession } from "@/lib/auth";
import { boardData } from "@/lib/board";
import { getPlan } from "@/lib/plan";
import { getItems, isOpen } from "@/lib/data";
import { addDays, fmtDate, isDate, mondayOf, today } from "@/lib/time";
import TodayView from "@/components/TodayView";
import "./today.css";

export default async function TodayPage({ searchParams }: { searchParams: Promise<{ d?: string }> }) {
  await requireSession();
  const sp = await searchParams, t = today();
  const d = isDate(sp.d) ? sp.d : t;
  const [data, plan] = await Promise.all([boardData(d, d), getPlan(mondayOf(d)).catch(() => null)]);
  // What the week's plan couldn't fit, still open: offered under "Later" as suggestions.
  const open = plan?.unscheduled.length ? new Set((await getItems()).filter(isOpen).map((i) => `${i.project_id}/${i.id}`)) : new Set<string>();
  return (
    <TodayView {...data} day={d}
      label={d === t ? "Today" : fmtDate(d, { weekday: "long", month: "long", day: "numeric" })}
      dateLine={fmtDate(d, { weekday: "long", month: "long", day: "numeric" })}
      prev={{ d: addDays(d, -1), l: fmtDate(addDays(d, -1), { weekday: "short" }) }} next={{ d: addDays(d, 1), l: fmtDate(addDays(d, 1), { weekday: "short" }) }}
      blocks={(plan?.blocks || []).filter((b) => b.date === d)} unplanned={(plan?.unscheduled || []).filter((u) => open.has(`${u.project_id}/${u.item_id}`))} />
  );
}
