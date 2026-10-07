"use client";
import { useState } from "react";
import Link from "next/link";
import { ackReview, pushAllReviewTasks, pushReviewTask } from "@/lib/actions";
import { OWNERS, type Proposal } from "@/lib/docsHub";
import { Ack, imeGuard, useSubmit } from "./Submit";

/** Mark a report as read (it leaves the unread count on Docs and reviews) or as unread again. */
export function AckButton({ id, ackedOn }: { id: string; ackedOn: string | null }) {
  const s = useSubmit();
  return (
    <span className="hub-ack">
      {ackedOn && <span className="hint">Read {ackedOn}</span>}
      <button className={`btn sm${ackedOn ? " ghost" : ""}`} disabled={s.pending}
        onClick={() => s.submit(() => ackReview(id, !ackedOn), { ok: ackedOn ? "Marked as unread" : "Marked as read" })}
        title={ackedOn ? "Put it back in the unread count" : "You've gone through it: it leaves the unread count"}>
        {ackedOn ? "Mark as unread" : "Mark as read"}
      </button>
      <Ack s={s} />
    </span>
  );
}

/** "Add all to checklist": every proposed task not on the checklist yet, each with its suggested section, owner and estimate. */
export function AddAllButton({ reviewId, count }: { reviewId: string; count: number }) {
  const s = useSubmit();
  if (!count) return null;
  return (
    <span className="hub-ack">
      <button className="btn sm" disabled={s.pending}
        onClick={() => s.submit(async () => {
          const r = await pushAllReviewTasks(reviewId);
          if (r.error) return { error: r.error };
          if (r.failed.length) return { error: `Added ${r.added}; ${r.failed.length} couldn't be added: ${r.failed[0]}` };
          return {};
        }, { ok: `Added ${count === 1 ? "the task" : `all ${count} tasks`} to the checklist` })}
        title="Adds every proposed task below that isn't on the checklist yet, with its suggested section, owner and estimate. Change one first with its own row if you want different settings.">
        Add all {count} to checklist
      </button>
      <Ack s={s} busy="Adding…" />
    </span>
  );
}

type Sec = { id: string; name: string; owner_default?: string };
const itemHref = (project: string, id: string) => `/p/${project}?v=checklist#item-${encodeURIComponent(id)}`;

/** The tasks a review proposes: what's already on the checklist (links), and Push to checklist for the rest. */
export function Proposals({ reviewId, projectId, list, sections, titles }: { reviewId: string; projectId: string; list: Proposal[]; sections: Sec[]; titles: Record<string, string> }) {
  const open = list.filter((p) => p.state === "pushable").length;
  const on = list.length - open - list.filter((p) => p.state === "text").length;
  return (
    <section className="hub-props" aria-labelledby={`props-${reviewId}`}>
      <div className="hub-props-h">
        <h3 className="ph-t" id={`props-${reviewId}`}>Proposed tasks</h3>
        <span className="hint">{[open ? `${open} to push` : "", on ? `${on} already on the checklist` : ""].filter(Boolean).join(" · ") || "Nothing to push"}</span>
      </div>
      <ul className="hub-plist">
        {list.map((p) => (
          <li key={p.key} className="hub-p">
            {p.state === "pushable" ? <PushRow reviewId={reviewId} p={p} sections={sections} />
              : <>
                <span className="hub-p-t">
                  <span>{p.title || p.text}</span>
                  <small>{p.source}{p.state === "text" ? " · not a clear task: add it by hand if you want it" : ""}</small>
                </span>
                {p.items.length > 0 && (
                  <span className="hub-p-on">
                    <span className="pill go">{p.state === "pushed" ? "Pushed" : "On the checklist"}</span>
                    {p.items.map((id) => <Link key={id} className="pill code" href={itemHref(projectId, id)} title={titles[id] || "No longer on the checklist"}>{id}</Link>)}
                  </span>
                )}
              </>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function PushRow({ reviewId, p, sections }: { reviewId: string; p: Proposal; sections: Sec[] }) {
  const def = sections.find((s) => s.id === p.section || s.name.toLowerCase() === (p.section || "").toLowerCase()) || sections[0];
  const [section, setSection] = useState(def?.id || "");
  const secOwner = sections.find((s) => s.id === section)?.owner_default;
  const [owner, setOwner] = useState<string>(p.owner || (OWNERS.some((o) => o.id === def?.owner_default) ? def!.owner_default! : "founder"));
  const [est, setEst] = useState(p.estimate_minutes ? String(p.estimate_minutes) : "");
  const s = useSubmit();
  const id = `push-${reviewId}-${p.key}`;
  return (
    <form className="hub-push" onKeyDown={imeGuard}
      onSubmit={(e) => { e.preventDefault(); s.submit(() => pushReviewTask(reviewId, p.key, { section, owner, estimate_minutes: est }), { ok: "Added to the checklist" }); }}>
      <span className="hub-p-t">
        <span>{p.title}</span>
        <small>{p.source}{p.detail && p.detail !== p.title ? ` · ${p.detail.length > 160 ? p.detail.slice(0, 160) + "…" : p.detail}` : ""}</small>
      </span>
      <span className="hub-push-f">
        <label className="sr" htmlFor={`${id}-s`}>Section</label>
        <select id={`${id}-s`} className="select" value={section} onChange={(e) => setSection(e.target.value)}>
          {sections.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <label className="sr" htmlFor={`${id}-o`}>Who it&apos;s waiting on</label>
        <select id={`${id}-o`} className="select" value={owner} onChange={(e) => setOwner(e.target.value)} title={secOwner ? `This section usually goes to ${OWNERS.find((o) => o.id === secOwner)?.label || secOwner}` : undefined}>
          {OWNERS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
        <label className="sr" htmlFor={`${id}-e`}>Estimate in minutes</label>
        <input id={`${id}-e`} className="input hub-est" inputMode="numeric" placeholder="min" value={est} onChange={(e) => setEst(e.target.value.replace(/[^0-9]/g, ""))} />
        <button className="btn sm" disabled={s.pending || !section}>Push to checklist</button>
        <Ack s={s} busy="Adding…" />
      </span>
    </form>
  );
}
