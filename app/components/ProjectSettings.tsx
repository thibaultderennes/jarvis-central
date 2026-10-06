"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { featureProject, requestReview, setProjectSettings } from "@/lib/actions";
import { BUILD_MODES, normEvery, type BuildMode } from "@/lib/projectSettings";
import { Ack, enterCommits, useSubmit } from "./Submit";

type Props = {
  id: string; plan: boolean; minutes: number | null; rank: number | null;
  reviews: boolean; every: number; lastReview: string | null; nextReview: string | null; reviewWhen: string; reviewRunning: boolean;
  buildMode: BuildMode | null; defaultMode: BuildMode;
};

/** The project's Settings view: planning, the advisor review schedule (and Run now), build mode. */
export default function ProjectSettings(props: Props) {
  return (
    <>
      <Planning {...props} />
      <Review {...props} />
      <BuildModes {...props} />
    </>
  );
}

function Planning({ id, plan, minutes, rank }: Props) {
  const [p, setP] = useState(plan), [h, setH] = useState(minutes ? String(minutes / 60) : "");
  const sub = useSubmit();
  const save = (s: Parameters<typeof setProjectSettings>[1]) => sub.submit(() => setProjectSettings(id, s));
  return (
    <section className="panel" aria-labelledby="set-plan">
      <div className="ph"><h2 className="ph-t" id="set-plan">Planning</h2><span className="sp" /><span className="hint">The Sunday planner books time for this project&apos;s items in your calendars</span></div>
      <div className="psettings">
        <label className="toggle">
          <input type="checkbox" checked={p} onChange={(e) => { setP(e.target.checked); save({ plan_enabled: e.target.checked }); }} />
          Plan into my calendar
        </label>
        <label className="hrs" title="The most time the Sunday planner books for this project each week. Leave empty for no limit.">
          <span>Hours per week</span>
          <input className="input" type="number" min={0} max={80} step={0.5} inputMode="decimal" value={h} placeholder="No limit" disabled={!p}
            onChange={(e) => setH(e.target.value)} onKeyDown={enterCommits}
            onBlur={() => { const v = h.trim() === "" ? null : Math.round(Number(h) * 60); if (v === minutes) return; save({ weekly_minutes: v !== null && Number.isFinite(v) ? v : null }); }} />
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

function Review({ id, reviews, every, lastReview, nextReview, reviewWhen, reviewRunning }: Props) {
  const router = useRouter();
  const [r, setR] = useState(reviews), [n, setN] = useState(String(every));
  const [pending, start] = useTransition();
  const sub = useSubmit();
  useEffect(() => { if (!reviewRunning) return; const t = setInterval(() => router.refresh(), 15000); return () => clearInterval(t); }, [reviewRunning, router]);
  const commit = () => {
    const v = normEvery(n);
    if (v === null) { setN(String(every)); sub.submit(async () => ({ error: "Reviews run every 1 to 90 days: type a whole number." })); return; }
    if (v !== every) sub.submit(() => setProjectSettings(id, { review_every_days: v }));
  };
  const when = !r ? "Scheduled reviews are off. Run now still works."
    : every === 7 ? `Runs with the weekly reviews, ${reviewWhen}.`
    : nextReview ? `Next one due ${nextReview}; the Mac worker starts it within the hour.` : "";
  return (
    <section className="panel" aria-labelledby="set-review">
      <div className="ph"><h2 className="ph-t" id="set-review">Advisor review</h2><span className="sp" /><span className="hint">CEO, CMO and product advisors: strategy, an audit of the work, your top 3</span></div>
      <div className="psettings">
        <label className="toggle">
          <input type="checkbox" checked={r} onChange={(e) => { setR(e.target.checked); sub.submit(() => setProjectSettings(id, { reviews_enabled: e.target.checked })); }} />
          Review this project on a schedule
        </label>
        <label className="hrs">
          <span>Every</span>
          <input className="input every" type="number" min={1} max={90} step={1} inputMode="numeric" value={n} disabled={!r} aria-describedby="set-review-when"
            onChange={(e) => setN(e.target.value)} onKeyDown={enterCommits} onBlur={commit} />
          <span>days</span>
        </label>
        <button className="btn sm" disabled={reviewRunning || pending} onClick={() => start(async () => { await requestReview(id); })}
          title={`The advisors review the last ${every} days now. The report lands on the Reviews page.`}>
          {reviewRunning || pending ? "Reviewing… (several minutes)" : "Run now"}
        </button>
        <Ack s={sub} />
      </div>
      <p className="pset-note" id="set-review-when">{lastReview ? `Last review ${lastReview}. ` : "No review yet. "}{when} 7 days keeps it on the weekly run.</p>
    </section>
  );
}

function BuildModes({ id, buildMode, defaultMode }: Props) {
  const [m, setM] = useState<BuildMode | null>(buildMode);
  const sub = useSubmit();
  const cur = m ?? defaultMode;
  return (
    <section className="panel" aria-labelledby="set-build">
      <div className="ph"><h2 className="ph-t" id="set-build">Build mode</h2><span className="sp" /><span className="hint">For in-progress items Claude builds and Build it (PR)</span></div>
      <div className="modes" role="radiogroup" aria-labelledby="set-build">
        {BUILD_MODES.map((b) => (
          <label key={b.id} className="mode">
            <input type="radio" name={`build-mode-${id}`} value={b.id} checked={cur === b.id}
              onChange={() => { setM(b.id); sub.submit(() => setProjectSettings(id, { build_mode: b.id })); }} />
            <span><b>{b.name}</b><span>{b.what}</span></span>
          </label>
        ))}
      </div>
      <p className="pset-note">{m ? "" : "Following the default in your Jarvis config. "}Both run on your Mac, on a branch, and open a PR that names the mode. Website builds use their own design skills. <Ack s={sub} /></p>
    </section>
  );
}
