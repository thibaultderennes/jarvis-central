// Docs and reviews (lib/docsHub.ts): kinds, the acknowledged filter, and the tasks a review proposes, with the push
// plan and its double-push guard. The database side (lib/data.ts pushProposal) claims the key atomically on top of this.
import { test } from "node:test";
import assert from "node:assert/strict";
import { filterHub, hubKind, hubList, isAcked, parseEntry, parseEstimate, pickSection, proposalKey, pushPlan, pushedAs, reviewProposals, topEntries, unackedCount } from "../lib/docsHub.ts";

const R = (o) => ({ id: "r1", type: "project", title: "Demo · week of 5 Oct", created_at: "2026-10-05T05:00:00Z", body_md: "", meta: {}, acked_at: null, pushed: {}, ...o });
const SECTIONS = [{ id: "build", name: "Build", owner_default: "claude" }, { id: "launch", name: "Launch" }];
const ITEMS = [{ id: "onboarding-fix", title: "Fix the onboarding flow" }, { id: "pricing-page", title: "Add a pricing page" }];
const BODY = `## Where they agree
- Ship it.

## Top 3 for this week
1. **Finish \`onboarding-fix\`**: the CEO and PO both flag it.
2. new item: Write the launch post for the beta — the CMO wants it before Friday, ~2h.
3. **New item:** Add a pricing page (all three agree).
4. Talk to five users about the pricing.

## Questions for you
- new item: Not a proposal, wrong section`;

test("hubKind: reviews, strategy docs, plans, setup, screenings, audits; cross-project ones are left out", () => {
  assert.equal(hubKind(R({})), "review");
  assert.equal(hubKind(R({ type: "doc", title: "CEO review" })), "strategy");
  assert.equal(hubKind(R({ type: "doc", title: "Project plan · 2026-10-01" })), "plan");
  assert.equal(hubKind(R({ type: "doc", title: "x", meta: { kind: "checklist-refresh" } })), "plan");
  assert.equal(hubKind(R({ type: "doc", title: "Project setup · 2026-10-01", meta: { kind: "project-setup" } })), "setup");
  assert.equal(hubKind(R({ type: "screening" })), "screening");
  assert.equal(hubKind(R({ type: "security" })), "security");
  for (const t of ["recap", "coaching", "jarvis"]) assert.equal(hubKind(R({ type: t })), null);
});

test("hubList: newest first by the file's date, then created_at; filter by kind and unacknowledged", () => {
  const list = [
    R({ id: "a", created_at: "2026-10-01T00:00:00Z", acked_at: "2026-10-02T00:00:00Z" }),
    R({ id: "b", type: "security", created_at: "2026-10-06T00:00:00Z", meta: { date: "2026-09-20" } }),
    R({ id: "c", type: "doc", title: "Strategy", created_at: "2026-10-04T00:00:00Z" }),
    R({ id: "d", type: "recap", created_at: "2026-10-07T00:00:00Z" }),
  ];
  assert.deepEqual(hubList(list).map((r) => r.id), ["c", "a", "b"]);
  assert.deepEqual(filterHub(hubList(list), { unacked: true }).map((r) => r.id), ["c", "b"]);
  assert.deepEqual(filterHub(hubList(list), { kind: "security" }).map((r) => r.id), ["b"]);
  assert.deepEqual(filterHub(hubList(list), { kind: "nonsense" }).map((r) => r.id), ["c", "a", "b"], "an unknown kind is no filter");
  assert.equal(unackedCount(list), 2, "the recap doesn't count");
});

test("acknowledge: acked_at set means read, null means new", () => {
  assert.equal(isAcked(R({ acked_at: "2026-10-07T10:00:00Z" })), true);
  assert.equal(isAcked(R({ acked_at: null })), false);
  assert.equal(isAcked(R({ acked_at: undefined })), false, "a row from before the migration reads as new");
});

test("topEntries: only the list under a Top 3 heading, continuation lines folded in", () => {
  const md = "## Top 3 for this week\n1. First line\n   goes on here\n2. Second\n\n## Next\n- not this";
  assert.deepEqual(topEntries(md), ["First line goes on here", "Second"]);
  assert.equal(topEntries(BODY).length, 4);
  assert.deepEqual(topEntries("no headings at all\n- a"), []);
});

test("parseEntry: conservative: a code is on the checklist, a 'new item:' title is pushable, the rest is text", () => {
  const ids = new Set(ITEMS.map((i) => i.id));
  const [code, launch, pricing, talk] = topEntries(BODY).map((e) => parseEntry(e, "Summary", ids));
  assert.equal(code.state, "on-checklist"); assert.deepEqual(code.items, ["onboarding-fix"]);
  assert.equal(launch.state, "pushable"); assert.equal(launch.title, "Write the launch post for the beta"); assert.equal(launch.estimate_minutes, 120);
  assert.equal(pricing.state, "pushable"); assert.equal(pricing.title, "Add a pricing page");
  assert.equal(talk.state, "text"); assert.equal(talk.title, undefined);
  assert.equal(parseEntry("new item: Fix", "S", ids).state, "text", "a one-word title is too thin to push");
  assert.equal(parseEntry("**Add dark mode toggle** (new item) — small", "S", ids).title, "Add dark mode toggle");
  assert.equal(parseEntry("Finish `not-a-real-code` soon", "S", ids).state, "text", "an unknown code is not on the checklist");
});

test("parseEstimate and proposalKey", () => {
  assert.equal(parseEstimate("about 90 min"), 90);
  assert.equal(parseEstimate("~1.5h"), 90);
  assert.equal(parseEstimate("in 3 weeks"), null);
  assert.equal(proposalKey("Add a pricing page"), proposalKey("**add a pricing page.**"), "keys ignore case and punctuation");
  assert.notEqual(proposalKey("Add a pricing page"), proposalKey("Add a signup page"));
});

test("reviewProposals: run-added items, structured proposals, free text and advisor tabs, de-duplicated", () => {
  const r = R({
    body_md: BODY,
    meta: {
      added: ["onboarding-fix", "gone-item"],
      proposals: [{ title: "Set up error tracking", detail: "Sentry or similar", section: "Launch", owner: "claude", estimate_minutes: 60 }, { title: "x" }],
      tabs: [{ key: "cmo", label: "CMO", body_md: "## Top 3 for this week\n- new item: Write the launch post for the beta\n- new item: Post in two communities each week" }],
    },
  });
  const ps = reviewProposals(r, [{ id: "onboarding-fix", title: "Fix the onboarding flow" }]);
  const by = (t) => ps.find((p) => p.title === t || p.text === t);
  assert.equal(ps.filter((p) => p.source === "Added by the run").length, 2);
  assert.equal(by("Fix the onboarding flow").state, "on-checklist");
  assert.equal(by("gone-item").state, "on-checklist", "an added code whose item is gone still shows as its code");
  assert.equal(by("Set up error tracking").owner, "claude");
  assert.equal(ps.filter((p) => p.title === "Write the launch post for the beta").length, 1, "the same task in a tab is shown once");
  assert.equal(by("Post in two communities each week").source, "CMO");
  assert.ok(!ps.some((p) => p.title === "Not a proposal, wrong section"), "only Top 3 lists are read");
});

test("push: picks the section, owner and estimate; detail cites the review", () => {
  const r = R({ body_md: BODY });
  const launch = reviewProposals(r, ITEMS.slice(0, 1)).find((p) => p.title === "Write the launch post for the beta");
  const plan = pushPlan(r, launch.key, ITEMS.slice(0, 1), SECTIONS);
  assert.ok("item" in plan);
  assert.deepEqual({ ...plan.item, detail: undefined }, { section: "build", title: "Write the launch post for the beta", owner: "claude", estimate_minutes: 120, detail: undefined });
  assert.match(plan.item.detail, /From "Demo · week of 5 Oct"/);
  const chosen = pushPlan(r, launch.key, ITEMS.slice(0, 1), SECTIONS, { section: "launch", owner: "founder", estimate_minutes: "45" });
  assert.deepEqual([chosen.item.section, chosen.item.owner, chosen.item.estimate_minutes], ["launch", "founder", 45]);
  assert.equal(pushPlan(r, launch.key, ITEMS.slice(0, 1), SECTIONS, { owner: "nobody", estimate_minutes: "2" }).item.owner, "claude", "a bad owner falls back to the section's default");
  assert.equal(pickSection(SECTIONS, "Launch").id, "launch");
  assert.equal(pickSection(SECTIONS, "unknown").id, "build");
  assert.equal(pickSection([], "x"), null);
});

test("double-push guard: a pushed key, an existing title or a text-only proposal can't be pushed", () => {
  const r = R({ body_md: BODY });
  const launch = reviewProposals(r, []).find((p) => p.title === "Write the launch post for the beta");
  const pushed = R({ body_md: BODY, pushed: { [launch.key]: "write-launch-post" } });
  const again = pushPlan(pushed, launch.key, [], SECTIONS);
  assert.ok("error" in again); assert.equal(again.existing, "write-launch-post");
  assert.equal(reviewProposals(pushed, []).find((p) => p.key === launch.key).state, "pushed");

  const pricing = reviewProposals(r, []).find((p) => p.title === "Add a pricing page");
  const dup = pushPlan(r, pricing.key, ITEMS, SECTIONS);
  assert.ok("error" in dup); assert.equal(dup.existing, "pricing-page", "the title is already an item");

  const talk = reviewProposals(r, []).find((p) => p.state === "text");
  assert.ok("error" in pushPlan(r, talk.key, [], SECTIONS));
  assert.ok("error" in pushPlan(r, "p-unknown", [], SECTIONS));
  assert.ok("error" in pushPlan(r, launch.key, [], []), "no sections, no push");

  const pending = R({ body_md: BODY, pushed: { [launch.key]: "pending:2026-10-07 10:00:00+00" } });
  assert.equal(pushedAs(pending, launch.key), null, "a claim still running is not a pushed item");
  assert.equal(reviewProposals(pending, []).find((p) => p.key === launch.key).state, "pushable");
});
