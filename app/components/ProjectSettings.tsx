"use client";
import { useState } from "react";
import { featureProject, setProjectSettings } from "@/lib/actions";
import { Ack, enterCommits, useSubmit } from "./Submit";

/** Per-project switches: plan it into the calendar, weekly time for the planner, weekly advisor review. */
export default function ProjectSettings({ id, plan, minutes, reviews, rank }: { id: string; plan: boolean; minutes: number | null; reviews: boolean; rank: number | null }) {
  const [p, setP] = useState(plan), [r, setR] = useState(reviews), [h, setH] = useState(minutes ? String(minutes / 60) : "");
  const sub = useSubmit();
  const save = (s: Parameters<typeof setProjectSettings>[1]) => sub.submit(() => setProjectSettings(id, s));
  return (
    <section className="panel" aria-label="Project settings">
      <div className="psettings">
        <label className="toggle" title="The Sunday planner books time for this project's items and writes them to your calendars">
          <input type="checkbox" checked={p} onChange={(e) => { setP(e.target.checked); save({ plan_enabled: e.target.checked }); }} />
          Plan into my calendar
        </label>
        <label className="hrs" title="The most time the Sunday planner books for this project each week. Leave empty for no limit.">
          <span>Hours per week</span>
          <input className="input" type="number" min={0} max={80} step={0.5} inputMode="decimal" value={h} placeholder="No limit" disabled={!p}
            onChange={(e) => setH(e.target.value)} onKeyDown={enterCommits}
            onBlur={() => { const v = h.trim() === "" ? null : Math.round(Number(h) * 60); if (v === minutes) return; save({ weekly_minutes: v !== null && Number.isFinite(v) ? v : null }); }} />
        </label>
        <label className="toggle" title="Monday: CEO, CMO and product advisors review this project (strategy, audit, top 3)">
          <input type="checkbox" checked={r} onChange={(e) => { setR(e.target.checked); save({ reviews_enabled: e.target.checked }); }} />
          Weekly review, strategy &amp; audit
        </label>
        {!rank && (
          <select className="plan-sel" aria-label="Put this project in the top 3" value="" onChange={(e) => { const v = Number(e.target.value); if (v) sub.submit(() => featureProject(id, v), { ok: "Now in your top 3" }); }}>
            <option value="">Put in top 3…</option>
            {[1, 2, 3].map((s) => <option key={s} value={s}>Slot {s}</option>)}
          </select>
        )}
        {rank && <span className="saved">Top 3 · slot {rank}</span>}
        <Ack s={sub} />
      </div>
    </section>
  );
}
