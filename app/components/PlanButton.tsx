"use client";
import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { requestPlanning } from "@/lib/actions";

/** Starts a full project review + checklist generation on the Mac worker, and shows its progress. */
export default function PlanButton({ projectId, running, lastPlan }: { projectId: string; running: boolean; lastPlan: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  useEffect(() => { if (!running) return; const t = setInterval(() => router.refresh(), 15000); return () => clearInterval(t); }, [running, router]);
  return (
    <button className="btn sm" disabled={running || pending} onClick={() => start(() => requestPlanning(projectId))}
      title={`Claude goes through the project folder (code, docs, git history, PRD), writes where it stands, and adds what's missing to the checklist${lastPlan ? `. Last plan: ${lastPlan}` : ""}`}>
      {running || pending ? "Planning… (a few minutes)" : "Plan this project"}
    </button>
  );
}
