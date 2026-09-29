import { requireSession } from "@/lib/auth";
import { getMessages, getProjects, kvGet, splitFeatured } from "@/lib/data";
import Nav from "@/components/Nav";

export default async function MainLayout({ children }: { children: React.ReactNode }) {
  await requireSession();
  const [projects, msgs, hb] = await Promise.all([getProjects(), getMessages({ limit: 100 }), kvGet<{ at: string }>("worker.heartbeat")]);
  const { featured, others } = splitFeatured(projects);
  const tabs = featured.map((p) => ({ id: p.id, name: p.name, color: p.color }));
  const waiting = msgs.filter((m) => ["new", "seen", "working"].includes(m.status)).length;
  const fresh = msgs.filter((m) => ["answered", "done", "needs_you", "error"].includes(m.status) && m.replied_at && Date.now() - +new Date(m.replied_at) < 864e5).length;
  const last = hb?.value?.at || null;
  return (
    <>
      <Nav projects={tabs} moreCount={others.length} waiting={waiting} fresh={fresh} workerAt={last} />
      <main className="shell">{children}</main>
    </>
  );
}
