"use client";
import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { requestScreening } from "@/lib/actions";

export type ScreenCard = { kind: string; title: string; what: string; last: { date: string; verdict: string | null; fail: number; live: number } | null; running: boolean };

/** The three screenings: what each checks, the last result, and Run (the Mac worker takes a few minutes). */
export default function Screenings({ projectId, cards }: { projectId: string; cards: ScreenCard[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const busy = cards.some((c) => c.running);
  useEffect(() => { if (!busy) return; const t = setInterval(() => router.refresh(), 15000); return () => clearInterval(t); }, [busy, router]);
  return (
    <div className="screens" data-track-section="Screenings">
      {cards.map((c) => (
        <div key={c.kind} className="screen-card">
          <b>{c.title}</b>
          <p>{c.what}</p>
          <span className="due">{c.last ? <>Last run {c.last.date}{c.last.verdict ? <> · <span className={`verdict v-${c.last.verdict}`}>{c.last.verdict.replace("-", " ")}</span></> : null} · {c.last.fail} to fix{c.last.live ? ` · ${c.last.live} to check live` : ""}</> : "Never run"}</span>
          <button className="btn sm" disabled={c.running || pending} onClick={() => start(() => requestScreening(projectId, c.kind))}
            title="Claude checks the project folder against the researched check list (read-only), writes the report here and adds what to fix to the checklist">
            {c.running ? "Running… (a few minutes)" : c.last ? "Run again" : "Run"}
          </button>
        </div>
      ))}
    </div>
  );
}
