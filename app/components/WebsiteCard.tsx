"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { requestWebsite, setSiteUrl } from "@/lib/actions";

export type WebsiteRun = { status: string; created_at: string; pr_url: string | null; reply: string } | null;

/** Reviews → Build website / Try a new visual: what Jarvis knows about the site, the button, the last run. */
export default function WebsiteCard({ projectId, kind, summary, siteUrl, last }: { projectId: string; kind: "new" | "redesign"; summary: string; siteUrl: string; last: WebsiteRun }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [url, setUrl] = useState(siteUrl);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [ask, setAsk] = useState("");
  const [keep, setKeep] = useState(false);
  const running = !!last && ["new", "seen", "working"].includes(last.status);
  useEffect(() => { if (!running) return; const t = setInterval(() => router.refresh(), 15000); return () => clearInterval(t); }, [running, router]);
  const label = kind === "redesign" ? "Try a new visual" : "Build website";
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const r = await setSiteUrl(projectId, url);
      setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: url.trim() ? "Saved." : "Cleared: Jarvis goes back to what it finds in the folder." });
    });
  };
  return (
    <div className="screen-card website-card" data-track-section="Website">
      <b>Website</b>
      <p>
        {kind === "redesign"
          ? "Claude reads the project's docs and builds 3 clearly different directions for your home page (colours, type and layout), as previews next to your live site. It lands as a pull request with screenshots; pick one and reply \u201capply B\u201d to make it real."
          : "Claude reads the project's docs and builds its first website with the design skills (taste, design systems, guidelines audit, browser check). It lands as a pull request; nothing is deployed."}
      </p>
      <span className="site-line">{summary}</span>
      <form className="website-url" onSubmit={save}>
        <label className="lbl" htmlFor={`site-url-${projectId}`}>Website address</label>
        <input className="input" id={`site-url-${projectId}`} type="text" inputMode="url" placeholder="example.com" value={url} onChange={(e) => { setUrl(e.target.value); setMsg(null); }} />
        <button className="btn sm ghost" type="submit" disabled={pending || url === siteUrl}>Save</button>
      </form>
      {msg && <span className={msg.ok ? "site-line" : "site-line due late"} role="status">{msg.text}</span>}
      {last && !running && <span className="site-line">Last run {last.created_at.slice(0, 10)} · {last.pr_url ? <a href={last.pr_url} target="_blank" rel="noreferrer">pull request</a> : last.status === "needs_you" ? "needs you (see the Inbox)" : last.status}</span>}
      <label className="lbl" htmlFor={`site-ask-${projectId}`}>What should change? (optional)</label>
      <textarea className="textarea website-ask" id={`site-ask-${projectId}`} rows={2} maxLength={1000} value={ask} onChange={(e) => setAsk(e.target.value)}
        placeholder={kind === "redesign" ? "e.g. darker and bolder, less editorial, more playful" : "e.g. calm and premium, one page, dark"} />
      {kind === "redesign" && (
        <label className="toggle website-keep">
          <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} /> Keep my colours
        </label>
      )}
      <button className="btn sm" disabled={running || pending} onClick={() => start(async () => { await requestWebsite(projectId, { ask, keepColours: keep }); setAsk(""); })}
        title="The Mac worker builds it on a branch with the design skills and opens a pull request for you to review; your live site isn't changed">
        {running ? "Building… (up to an hour)" : label}
      </button>
    </div>
  );
}
