"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { sendMessage } from "@/lib/actions";
import type { Message } from "@/lib/data";
import { Ack, enterSends, useSubmit } from "./Submit";

const ST: Record<string, [string, string]> = {
  new: ["Waiting for the Mac worker", "wait"], seen: ["Picked up", "wait"], working: ["Working…", "wait"],
  answered: ["Answered", "ok"], done: ["Done", "ok"], needs_you: ["Needs you", "err"], error: ["Failed", "err"],
};

/** Discussion under a review or strategy document: discuss ideas, or ask Claude to build one (branch + PR). */
export default function Thread({ reviewId, projectId, tab, messages, canBuild }: { reviewId: string; projectId: string | null; tab?: string | null; messages: Message[]; canBuild: boolean }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const s = useSubmit(), pending = s.pending;
  const busy = messages.some((m) => ["new", "seen", "working"].includes(m.status));
  useEffect(() => { if (!busy) return; const t = setInterval(() => router.refresh(), 10000); return () => clearInterval(t); }, [busy, router]);
  const send = (mode: "discuss" | "build") => {
    const v = text.trim(); if (!v || s.pending) return;
    s.submit(() => sendMessage(v, projectId, { mode, review_id: reviewId, review_tab: tab || null }), { ok: "Sent", onOk: () => setText("") });
  };
  return (
    <section className="thread" aria-label="Discuss this review with Claude">
      <div className="lbl" style={{ marginBottom: 8 }}>Discuss this with Claude{tab ? ` · about the ${tab.toUpperCase()} tab` : ""}</div>
      {messages.map((m) => {
        const [label, cls] = ST[m.status] || [m.status, ""];
        const meta = m.meta as { pr_url?: string };
        return (
          <div key={m.id} className="turn">
            <div className="q"><span className="pill" style={{ marginRight: 8 }}>{m.mode === "build" ? "build" : "you"}</span>{m.text}</div>
            {m.reply ? <div className="a" style={{ whiteSpace: "pre-wrap" }}>{m.reply}</div> : <div className={`mst ${cls}`} style={{ fontFamily: "var(--mono)", fontSize: 11 }}>{label}</div>}
            {meta.pr_url && <div className="a"><a href={meta.pr_url} target="_blank" rel="noopener noreferrer">Pull request ↗</a> · not merged</div>}
          </div>
        );
      })}
      <form className="composer" style={{ padding: 0, border: 0, marginTop: 10 }} onSubmit={(e) => { e.preventDefault(); send("discuss"); }}>
        <textarea id={`thread-${reviewId}`} className="textarea" rows={3} value={text} onChange={(e) => setText(e.target.value)}
          placeholder="Push back, propose an idea, ask why… Claude reads this review and the discussion so far."
          onKeyDown={enterSends} title="Enter sends · Shift+Enter for a new line" />
        <div className="crow">
          <span className="explain" style={{ fontSize: 12, color: "var(--ink-3)" }}>
            <b>Discuss</b> answers and can add checklist items. <b>Build it</b> works on a new branch and opens a PR{canBuild ? " (in projects that are a git repo; otherwise it plans the change)" : ""}.
          </span>
          <span className="sp" />
          <Ack s={s} busy="Sending…" />
          <button type="button" className="btn ghost" disabled={pending || !text.trim()} onClick={() => send("build")}>Build it (PR)</button>
          <button className="btn" disabled={pending || !text.trim()}>{pending ? "Sending…" : "Discuss"}</button>
        </div>
      </form>
    </section>
  );
}
