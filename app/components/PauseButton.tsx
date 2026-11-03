"use client";
import { useState, useTransition } from "react";
import { setProjectPaused } from "@/lib/actions";

/** Pause / resume a project from its page header. Paused: the checklist stays, nothing about it asks for your time. */
export default function PauseButton({ projectId, name, paused }: { projectId: string; name: string; paused: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  const flip = () => start(async () => {
    const r = await setProjectPaused(projectId, !paused).catch(() => ({ error: "Couldn't save. Try again." }));
    setMsg(r.error || (paused ? `${name} resumed` : `${name} paused`));
  });
  return (
    <>
      <button className="btn sm ghost" disabled={pending} onClick={flip} aria-pressed={paused}
        title={paused
          ? "Back in the plan, Today, the overdue queue, Needs you, the reviews and the audits. Due dates are unchanged, so some items may show as late."
          : "Takes it out of the plan, Today, the overdue queue, Needs you, the sidebar counts, the reviews and audits, and Claude's automatic builds. The checklist stays, and Claude still answers messages about it."}>
        {pending ? "Saving…" : paused ? "Resume project" : "Pause project"}
      </button>
      <span className="ack" role="status">{msg}</span>
    </>
  );
}
