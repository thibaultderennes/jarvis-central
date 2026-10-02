import { requireSession } from "@/lib/auth";
import { getMessages, getProjects, kvGet, splitFeatured } from "@/lib/data";
import { Suspense } from "react";
import Nav from "@/components/Nav";
import UsageTracker from "@/components/UsageTracker";
import { trackingEnabled } from "@/lib/usage";

export default async function MainLayout({ children }: { children: React.ReactNode }) {
  await requireSession();
  const [projects, msgs, hb] = await Promise.all([getProjects(), getMessages({ limit: 100 }), kvGet<{ at: string }>("worker.heartbeat")]);
  const { featured, others } = splitFeatured(projects);
  const tabs = featured.map((p) => ({ id: p.id, name: p.name, color: p.color }));
  const waiting = msgs.filter((m) => ["new", "seen", "working"].includes(m.status)).length;
  // "new" in the badge = replies you haven't opened yet (they move to Pending once seen in the inbox).
  const fresh = msgs.filter((m) => ["answered", "done", "needs_you", "error"].includes(m.status) && !m.opened_at && !m.treated_at).length;
  const last = hb?.value?.at || null;
  return (
    <>
      <Nav projects={tabs} moreCount={others.length} waiting={waiting} fresh={fresh} workerAt={last} />
      <main className="shell">{children}</main>
      {/* Page views and clicks for the Monday Jarvis review (first-party, labels only); usage.track_clicks: false turns it off. */}
      {trackingEnabled() && <Suspense fallback={null}><UsageTracker /></Suspense>}
    </>
  );
}
