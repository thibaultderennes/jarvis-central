import { requireSession } from "@/lib/auth";
import * as D from "@/lib/data";
import { everyLabel, workerEvery, type WorkerBeat } from "@/lib/workerBeat";
import Inbox from "@/components/Inbox";
import FromClaude from "@/components/FromClaude";
import { Glyph, HeaderVec } from "@/components/brand";
import { DIGEST_KEY, type DigestSeen } from "@/lib/fromClaude";
import { digestGroups, digestKey } from "../digest";

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  await requireSession();
  const sp = await searchParams;
  const [msgs, projects, hb, seen] = await Promise.all([D.getMessages({ limit: 120 }), D.getProjects(), D.kvGet<NonNullable<WorkerBeat>>("worker.heartbeat"), D.kvGet<DigestSeen>(DIGEST_KEY)]);
  const topIds = new Set(D.splitFeatured(projects).featured.map((x) => x.id));
  const digest = digestGroups(msgs, seen?.value, Object.fromEntries(projects.map((p) => [p.id, p])), topIds);
  return (
    <>
      <div className="hello">
        <div>
          <h1 className="page"><Glyph n="inbox" />Talk to Claude</h1>
          <p className="sub">Leave a message about any project. The worker on your Mac picks it up at its next check ({everyLabel(workerEvery(hb?.value))}; Jarvis Check Now on your Mac runs one at once), works in that project, and replies here. Ask / discuss answers, researches, plans your days and edits checklists. Build it works on a new branch in that project and opens a pull request; it never merges or deploys. Replies sort into lanes, one line each: open one to read it, then mark it got it or put it off until tomorrow.</p>
        </div>
        <HeaderVec n="inbox" />
      </div>
      <FromClaude key={digestKey(digest)} groups={digest} />
      <Inbox messages={msgs} projects={projects.map((p) => ({ id: p.id, name: p.name, color: D.displayColor(p, topIds) }))} defaultProject={sp.project || ""} workerAt={hb?.value?.at || null} workerEvery={workerEvery(hb?.value)} />
    </>
  );
}
