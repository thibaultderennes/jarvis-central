"use client";
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { digestGotIt } from "@/lib/actions";
import type { DigestGroup } from "@/lib/fromClaude";
import "./fromClaude.css";

export type FromClaudeGroup = DigestGroup & { name: string; color: string };
const LANE: Record<string, [string, string]> = { shipped: ["Shipped", "go"], reports: ["Report", ""], fyi: ["FYI", ""] };
const SHOWN = 3;
const ago = (t: string) => { const m = Math.round((Date.now() - +new Date(t)) / 6e4); return m < 60 ? `${Math.max(1, m)} min` : m < 2880 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`; };

/**
 * What Claude finished since you last looked (lib/fromClaude.ts), one line per conversation, grouped by project.
 * "Got it" clears one project or everything; nothing is shown when there is nothing new.
 */
export default function FromClaude({ groups }: { groups: FromClaudeGroup[] }) {
  const [pending, start] = useTransition();
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []); // ages only in the browser, so the server render matches
  const shown = groups.filter((g) => !gone.has(g.project_id || "_"));
  if (!shown.length) return null;
  const count = shown.reduce((n, g) => n + g.lines.length, 0);
  const got = (p?: string | null) => {
    setGone(new Set(p === undefined ? shown.map((g) => g.project_id || "_") : [...gone, p || "_"]));
    start(() => digestGotIt(p));
  };
  return (
    <section className="panel fromclaude" aria-label="From Claude">
      <div className="ph">
        <h2 className="ph-t">From Claude</h2>
        <span className="ct">{count}</span>
        <span className="hint">since you last looked</span>
        <span className="sp" />
        <button className="btn sm ghost" disabled={pending} onClick={() => got()}>Got it, all</button>
      </div>
      <ul className="fc-groups">
        {shown.map((g) => {
          const row = (l: FromClaudeGroup["lines"][number]) => {
            const [label, cls] = LANE[l.lane] || [l.lane, ""];
            return (
              <li key={l.id} className="fc-line">
                <span className={`pill${cls ? " " + cls : ""}`} title={l.kind}>{label}</span>
                <Link href="/inbox" title={l.line}>{l.line}</Link>
                <span className="due">{mounted ? ago(l.at) : ""}</span>
              </li>
            );
          };
          return (
            <li key={g.project_id || "_"} className="fc-group" data-c={g.color}>
              <div className="fc-head">
                <span className="fc-p"><i className="dot" />{g.name}</span>
                <span className="due">{g.lines.length} new</span>
                <span className="sp" />
                <button className="more" disabled={pending} onClick={() => got(g.project_id)} aria-label={`Got it: ${g.name}`}>Got it</button>
              </div>
              <ul className="fc-lines">{g.lines.slice(0, SHOWN).map(row)}</ul>
              {g.lines.length > SHOWN && <details className="fc-more"><summary>{g.lines.length - SHOWN} more</summary><ul className="fc-lines">{g.lines.slice(SHOWN).map(row)}</ul></details>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
