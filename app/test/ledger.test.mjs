// Follow-through ledger (lib/ledger.ts): a review's Top 3 as entries, what happened to each against the checklist,
// and rejected advice recognised when it comes back in other words.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEntry, proposalKey, topEntries } from "../lib/docsHub.ts";
import { isAdviceStatus, matchRejected, outcome, similarity, topThree } from "../lib/ledger.ts";
import { synthesisPrompt } from "../../agent/advisors.mjs";

const BODY = `## Last week's Top 3
1. **Done** · Ship the old thing

## Where they agree
- Ship it.

## Top 3 for this week
1. **Finish \`onboarding-fix\`**: the CEO and PO both flag it.
2. new item: Write the launch post for the beta — the CMO wants it before Friday.
3. Talk to five users about the pricing.
4. A fourth one that is cut.

## Questions for you
- Something else`;
const parse = (md, ids = new Set(["onboarding-fix"])) => topThree(topEntries(md).map((e) => parseEntry(e, "Summary", ids)));

test("topThree: the summary's Top 3 only, at most three, never the follow-through section on top", () => {
  const e = parse(BODY);
  assert.equal(e.length, 3);
  assert.deepEqual(e.map((x) => x.rank), [1, 2, 3]);
  assert.deepEqual(e[0].items, ["onboarding-fix"]);
  assert.ok(!e.some((x) => /old thing|fourth/.test(x.text)));
  // A "new item:" entry keeps its proposal key, so a push of it is found again (reviews.pushed).
  assert.equal(e[1].key, proposalKey("Write the launch post for the beta"));
});

test("topThree: duplicates collapse", () => {
  const e = parse("## Top 3\n- Talk to five users\n- Talk to five users\n- Raise prices");
  assert.deepEqual(e.map((x) => x.text), ["Talk to five users", "Raise prices"]);
});

test("outcome: the owner's call wins, then the checklist, then ignored once the week is over", () => {
  const st = new Map([["a", "done"], ["b", "doing"], ["c", "todo"]]);
  assert.equal(outcome({ status: "rejected", items: ["a"] }, st, true), "rejected");
  assert.equal(outcome({ status: "done", items: [] }, st, false), "done");
  assert.equal(outcome({ status: "open", items: ["c", "a"] }, st, true), "done");
  assert.equal(outcome({ status: "open", items: [], pushed_item: "b" }, st, true), "started");
  assert.equal(outcome({ status: "open", items: ["c"] }, st, true), "ignored");
  assert.equal(outcome({ status: "open", items: ["c"] }, st, false), "open");
});

test("matchRejected: same key, or the same advice in other words; different advice passes", () => {
  const rejected = [{ key: "k1", text: "Launch a TikTok channel for the brand" }, { key: "k2", text: "Hire a part-time designer" }];
  assert.equal(matchRejected({ key: "k2", text: "anything" }, rejected)?.key, "k2");
  assert.equal(matchRejected({ key: "x", text: "Launch a TikTok channel for the brand this week" }, rejected)?.key, "k1");
  assert.equal(matchRejected({ key: "y", text: "Finish the onboarding flow and ship it" }, rejected), null);
  assert.ok(similarity("Raise prices to 20 dollars", "raise prices to 20 dollars!") === 1);
  assert.equal(similarity("", "x"), 0);
});

test("synthesisPrompt: carries last review's follow-through and the rejected advice, and stays quiet without them", () => {
  const base = { p: { name: "Demo", sections: [] }, W: { startDate: "2026-10-05", lastDate: "2026-10-11" }, reports: [{ label: "CEO · strategy", verdict: "on-track", headline: "h", body_md: "b" }], meta: {} };
  const with_ = synthesisPrompt({ ...base, ledger: ["1. **Ignored** · Talk to users"], rejected: ["- Launch a TikTok channel (rejected on the review of 2026-09-28)"] });
  assert.match(with_, /Ignored\*\* · Talk to users/);
  assert.match(with_, /Never put any of it[\s\S]*TikTok/);
  const without = synthesisPrompt(base);
  assert.doesNotMatch(without, /rejected|Last review's Top 3/);
});

test("isAdviceStatus: only what the owner can decide", () => {
  for (const s of ["open", "done", "rejected"]) assert.ok(isAdviceStatus(s));
  for (const s of ["ignored", "started", "", null]) assert.ok(!isAdviceStatus(s));
});
