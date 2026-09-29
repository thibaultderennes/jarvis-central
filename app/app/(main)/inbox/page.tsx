import { requireSession } from "@/lib/auth";
import * as D from "@/lib/data";
import Inbox from "@/components/Inbox";

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  await requireSession();
  const sp = await searchParams;
  const [msgs, projects, hb] = await Promise.all([D.getMessages({ limit: 60 }), D.getProjects(), D.kvGet<{ at: string }>("worker.heartbeat")]);
  return (
    <>
      <div className="hello">
        <div>
          <h1 className="page">Talk to Claude</h1>
          <p className="sub">Leave a message about any project. The worker on your Mac picks it up within a minute, works in that project, and replies here. Ask / discuss answers, researches, plans your days and edits checklists. Build it works on a new branch in that project and opens a pull request; it never merges or deploys.</p>
        </div>
      </div>
      <Inbox messages={msgs} projects={projects.map((p) => ({ id: p.id, name: p.name, color: p.kind === "running" ? "other" : p.color }))} defaultProject={sp.project || ""} workerAt={hb?.value?.at || null} />
    </>
  );
}
