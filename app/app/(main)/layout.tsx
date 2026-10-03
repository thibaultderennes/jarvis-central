import { cookies } from "next/headers";
import { requireSession } from "@/lib/auth";
import { getMessages, getProjects, getTodos, kvGet, openCounts, splitFeatured } from "@/lib/data";
import { today } from "@/lib/time";
import { Suspense } from "react";
import Sidebar, { type NavProject } from "@/components/Sidebar";
import UsageTracker from "@/components/UsageTracker";
import { trackingEnabled } from "@/lib/usage";
import { needsYou } from "@/lib/needs";
import CommandPalette from "@/components/CommandPalette";
import Shortcuts from "@/components/Shortcuts";

// Remembers the collapsed (icon rail) sidebar so the server renders it right, without a flash.
const RAIL_COOKIE = "jarvis_rail";

export default async function MainLayout({ children }: { children: React.ReactNode }) {
  await requireSession();
  const t = today();
  const [projects, msgs, hb, counts, todos, jar, needs] = await Promise.all([
    getProjects(), getMessages({ limit: 100 }), kvGet<{ at: string }>("worker.heartbeat"), openCounts(t), getTodos(t, t), cookies(), needsYou(),
  ]);
  const { featured, others } = splitFeatured(projects);
  // Top-3 keep their colour slot; every other project shares "other", as in the charts.
  const nav = (p: (typeof projects)[number], top: boolean): NavProject => ({ id: p.id, name: p.name, color: top ? p.color : "other", open: counts[p.id]?.open || 0, late: counts[p.id]?.late || 0 });
  const waiting = msgs.filter((m) => ["new", "seen", "working"].includes(m.status)).length;
  // "new" in the badge = replies you haven't opened yet (they move to Pending once seen in the inbox).
  const fresh = msgs.filter((m) => ["answered", "done", "needs_you", "error"].includes(m.status) && !m.opened_at && !m.treated_at).length;
  return (
    <Sidebar pinned={featured.map((p) => nav(p, true))} projects={others.map((p) => nav(p, false))} waiting={waiting} fresh={fresh}
      todayLeft={todos.filter((x) => !x.done).length} needs={needs.count} workerAt={hb?.value?.at || null} rail={jar.get(RAIL_COOKIE)?.value === "1"} railCookie={RAIL_COOKIE}
      version={process.env.NEXT_PUBLIC_JARVIS_VERSION || "dev"}>
      {children}
      <CommandPalette />
      <Shortcuts />
      {/* Page views and clicks for the Monday Jarvis review (first-party, labels only); usage.track_clicks: false turns it off. */}
      {trackingEnabled() && <Suspense fallback={null}><UsageTracker /></Suspense>}
    </Sidebar>
  );
}
