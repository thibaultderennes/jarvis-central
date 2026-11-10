import { requireSession } from "@/lib/auth";
import { boardData } from "@/lib/board";
import { getPlan } from "@/lib/plan";
import { getItems, isOpen, kvGet } from "@/lib/data";
import { waitingFor, type RolloverDay } from "@/lib/rollover";
import { addDays, fmtDate, isDate, mondayOf, today } from "@/lib/time";
import TodayView from "@/components/TodayView";
import "./today.css";

export default async function TodayPage({ searchParams }: { searchParams: Promise<{ d?: string }> }) {
  await requireSession();
  const sp = await searchParams, t = today();
  const d = isDate(sp.d) ? sp.d : t;
  const [data, plan, roll] = await Promise.all([boardData(d, d), getPlan(mondayOf(d)).catch(() => null), kvGet<RolloverDay>("rollover.today").catch(() => null)]);
  // Open items of active projects (getItems leaves paused and archived ones out), read now: what the week's plan
  // couldn't fit is offered under "Later", and this morning's waiting list drops what was closed or paused since.
  const open = plan?.unscheduled.length || roll?.value?.waiting?.length ? new Set((await getItems()).filter(isOpen).map((i) => `${i.project_id}/${i.id}`)) : new Set<string>();
  return (
    <TodayView {...data} day={d}
      label={d === t ? "Today" : fmtDate(d, { weekday: "long", month: "long", day: "numeric" })}
      dateLine={fmtDate(d, { weekday: "long", month: "long", day: "numeric" })}
      prev={{ d: addDays(d, -1), l: fmtDate(addDays(d, -1), { weekday: "short" }) }} next={{ d: addDays(d, 1), l: fmtDate(addDays(d, 1), { weekday: "short" }) }}
      waiting={waitingFor(roll?.value, d, open)}
      blocks={(plan?.blocks || []).filter((b) => b.date === d)} unplanned={(plan?.unscheduled || []).filter((u) => open.has(`${u.project_id}/${u.item_id}`))} />
  );
}
