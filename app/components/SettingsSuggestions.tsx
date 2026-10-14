"use client";
import { decideSettingSuggestion } from "@/lib/actions";
import type { Suggestion } from "@/lib/docsHub";
import { Ack, useSubmit } from "./Submit";

/** `code` spans in a suggestion's text as <code>, the rest as text. */
const withCode = (t: string) => t.split(/(`[^`]+`)/g).map((x, i) => (x.startsWith("`") && x.endsWith("`") && x.length > 2 ? <code key={i}>{x.slice(1, -1)}</code> : x));
// UTC on both sides, so the server and the browser render the same day.
const day = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: "UTC" });

const STATE: Record<string, { pill: string; cls: string }> = {
  queued: { pill: "Waiting for your Mac", cls: "" },
  applied: { pill: "Applied", cls: "go" },
  failed: { pill: "Couldn't apply", cls: "crit" },
  done: { pill: "Done", cls: "go" },
  dismissed: { pill: "Dismissed", cls: "" },
};

/**
 * The Jarvis review's "Your settings", one card each. Apply hands the config keys to your Mac, which writes them into
 * jarvis.config.json on its next pass; Done is for the ones you do by hand; Dismiss says no. Next week's review reads all three.
 */
export function SettingsSuggestions({ reviewId, list }: { reviewId: string; list: Suggestion[] }) {
  if (!list.length) return null;
  const open = list.filter((s) => !s.decision || s.decision.state === "failed").length;
  return (
    <section className="sset" aria-labelledby={`sset-${reviewId}`}>
      <div className="sset-h">
        <h2 className="ph-t" id={`sset-${reviewId}`}>Your settings</h2>
        <span className="hint">{open ? `${open} of ${list.length} to decide` : "All decided"}: next week&apos;s review reads what you chose</span>
      </div>
      <ul className="sset-list">
        {list.map((s) => <Card key={s.key} reviewId={reviewId} s={s} />)}
      </ul>
    </section>
  );
}

function Card({ reviewId, s }: { reviewId: string; s: Suggestion }) {
  const sub = useSubmit();
  const d = s.decision, st = d ? STATE[d.state] : null;
  const act = (a: "apply" | "done" | "dismiss" | "undo", ok: string) => sub.submit(() => decideSettingSuggestion(reviewId, s.key, a), { ok });
  const undecided = !d || d.state === "failed";
  return (
    <li className="sset-card" data-state={d?.state || "open"}>
      <p className="sset-t">{withCode(s.text)}</p>
      {s.changes.length > 0 && (
        <ul className="sset-keys" aria-label="Config changes">
          {s.changes.map((c) => <li key={c.key}><code>{c.key}</code> <span aria-hidden>→</span><span className="sr">set to</span> <code>{JSON.stringify(c.value)}</code></li>)}
        </ul>
      )}
      {d?.state === "failed" && d.error && <p className="sset-err" role="alert">{d.error}</p>}
      {d?.state === "applied" && d.note && <p className="hint">{d.note}</p>}
      <div className="sset-f">
        {st && <span className={`pill ${st.cls}`}>{st.pill}{d && d.state !== "queued" ? ` · ${day(d.at)}` : ""}</span>}
        {undecided && s.changes.length > 0 && (
          <button className="btn sm" disabled={sub.pending} onClick={() => act("apply", "Sent to your Mac")}
            title="Your Mac writes these keys into jarvis.config.json on its next pass (about a minute when the worker runs)">
            {d?.state === "failed" ? "Try again" : "Apply"}
          </button>
        )}
        {undecided && (
          <button className={`btn sm${s.changes.length ? " ghost" : ""}`} disabled={sub.pending} onClick={() => act("done", "Marked as done")}
            title={s.changes.length ? "You changed it yourself" : "You did it by hand"}>
            Done
          </button>
        )}
        {undecided && <button className="btn sm ghost" disabled={sub.pending} onClick={() => act("dismiss", "Dismissed")} title="Not for you: next week's review won't push it again without new evidence">Dismiss</button>}
        {(d?.state === "done" || d?.state === "dismissed") && <button className="btn sm ghost" disabled={sub.pending} onClick={() => act("undo", "Back to undecided")}>Undo</button>}
        <Ack s={sub} busy="Saving…" />
      </div>
    </li>
  );
}
