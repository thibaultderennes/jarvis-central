// The Jarvis review's "Your settings" cards: which lines can be applied (lib/docsHub.ts), what each button may do from
// which state, and the Mac side that writes jarvis.config.json (agent/settingsapply.mjs) and its allowlist.
import { test } from "node:test";
import assert from "node:assert/strict";
import { decideSuggestion, parseChanges, settingSuggestions, structuredSettings } from "../lib/docsHub.ts";
import { applyChanges, checkChange, restartNote } from "../../agent/settingsapply.mjs";

const BODY = `## Pain points
- \`planner.hours\` → \`[]\` is not a suggestion here.

## Your settings
1. **\`planner.hours\` → \`[["13:00","17:00"],["20:30","23:00"]]\`** and **\`planner.max_focus_minutes_per_day\` 360 → 180** in jarvis.config.json. Reason: you sent 0 messages before noon.
2. **Example:** set 'Hours per week' (currently empty) to 120 on the project settings.
3. **\`planner.project_caps.side-app\` 360 → 120.** You logged 32 minutes.
4. **Calendar:** set \`GOOGLE_ICS_URLS\` to the feed. Run \`node scripts/setup.mjs status\` in \`app/\`.
5. Park \`pricing-page-copy\` in \`later\`.

## Tool changes
### Something
- \`reviews.concurrency\` to 3`;

const MERGED = {
  planner: { hours: [["09:00", "12:30"], ["13:30", "18:00"]], max_focus_minutes_per_day: 360, project_caps: {}, adapt: "suggest", rollover: true },
  worker: { build_model: null, allow_build: true },
  metrics: { stale_days: 7, sources: {} }, economics: { models: {} }, projects_root: "/Users/alex/Projects",
};

test("parseChanges: keys with an arrow or 'to' and a value; env vars, item codes and paths are not keys", () => {
  assert.deepEqual(parseChanges("**`planner.hours` → `[[\"13:00\",\"17:00\"]]`** and **`planner.max_focus_minutes_per_day` 360 → 180**"),
    [{ key: "planner.hours", value: [["13:00", "17:00"]] }, { key: "planner.max_focus_minutes_per_day", value: 180 }]);
  assert.deepEqual(parseChanges("Set `planner.adapt` to `apply` and `reviews.repo_scout` -> false."), [{ key: "planner.adapt", value: "apply" }, { key: "reviews.repo_scout", value: false }]);
  assert.deepEqual(parseChanges("set `GOOGLE_ICS_URLS` to the feed"), []);
  assert.deepEqual(parseChanges("Park `pricing-page-copy` in `later`."), []);
  assert.deepEqual(parseChanges("Raise `planner.buffer_minutes` because meetings overrun."), []);
});

test("settingSuggestions: the list under Your settings only, applyable or not, with stable keys and decisions", () => {
  const list = settingSuggestions({ body_md: BODY, meta: {} });
  assert.equal(list.length, 5);
  assert.deepEqual(list[0].changes.map((c) => c.key), ["planner.hours", "planner.max_focus_minutes_per_day"]);
  assert.deepEqual(list[2].changes, [{ key: "planner.project_caps.side-app", value: 120 }]);
  assert.deepEqual([list[1], list[3], list[4]].map((s) => s.changes.length), [0, 0, 0]);
  assert.ok(!list[0].text.includes("**"));
  const again = settingSuggestions({ body_md: BODY, meta: {}, decisions: { [list[1].key]: { state: "dismissed", at: "2026-10-05T10:00:00Z" }, other: { state: "bogus" } } });
  assert.equal(again[0].key, list[0].key);
  assert.equal(again[1].decision.state, "dismissed");
  assert.equal(again[0].decision, null);
});

test("structured settings win over the free text; bad keys and values are dropped", () => {
  const meta = { settings: [{ text: "Plan the afternoons", changes: [{ key: "planner.hours", value: [["13:00", "17:00"]] }, { key: "GOOGLE_ICS_URLS", value: "x" }, { key: "planner.x" }] }, { text: "ok" }, "nope"] };
  assert.deepEqual(structuredSettings(meta), [{ text: "Plan the afternoons", changes: [{ key: "planner.hours", value: [["13:00", "17:00"]] }] }]);
  const list = settingSuggestions({ body_md: BODY, meta });
  assert.equal(list.length, 1);
  assert.equal(list[0].text, "Plan the afternoons");
});

test("decideSuggestion: apply only with config changes, never twice, undo only what isn't written", () => {
  const [cfg, text] = settingSuggestions({ body_md: BODY, meta: {} });
  const at = "2026-10-14T12:00:00Z";
  assert.deepEqual(decideSuggestion(cfg, "apply", at), { decision: { state: "queued", at, changes: cfg.changes }, from: ["", "failed"] });
  assert.match(decideSuggestion(text, "apply", at).error, /no config key/);
  assert.equal(decideSuggestion(text, "done", at).decision.state, "done");
  assert.equal(decideSuggestion(text, "dismiss", at).decision.state, "dismissed");
  const queued = { ...cfg, decision: { state: "queued", at } };
  assert.match(decideSuggestion(queued, "dismiss", at).error, /Waiting for your Mac/);
  assert.match(decideSuggestion(queued, "undo", at).error, /Waiting/);
  const applied = { ...cfg, decision: { state: "applied", at } };
  assert.match(decideSuggestion(applied, "apply", at).error, /Already applied/);
  assert.match(decideSuggestion(applied, "undo", at).error, /change it there/);
  const failed = { ...cfg, decision: { state: "failed", at, error: "x" } };
  assert.equal(decideSuggestion(failed, "apply", at).decision.state, "queued");
  assert.deepEqual(decideSuggestion({ ...text, decision: { state: "dismissed", at } }, "undo", at), { decision: null, from: ["dismissed"] });
  assert.match(decideSuggestion(text, "undo", at).error, /Nothing to undo/);
});

test("checkChange: only allowlisted keys, the same type as before, new keys only inside an existing section", () => {
  assert.equal(checkChange({ key: "planner.hours", value: [["13:00", "17:00"]] }, MERGED), null);
  assert.equal(checkChange({ key: "planner.project_caps.side-app", value: 120 }, MERGED), null);
  assert.equal(checkChange({ key: "worker.build_model", value: "opus" }, MERGED), null);
  assert.equal(checkChange({ key: "metrics.stale_days", value: 14 }, MERGED), null);
  assert.match(checkChange({ key: "metrics.sources.app", value: { command: "rm -rf ~" } }, MERGED), /can't be set from the site/);
  assert.match(checkChange({ key: "economics.models.app", value: "x.cjs" }, MERGED), /can't be set from the site/);
  assert.match(checkChange({ key: "projects_root.x", value: "/tmp" }, MERGED), /can't be set/);
  assert.match(checkChange({ key: "planner.max_focus_minutes_per_day", value: "lots" }, MERGED), /a number, not a string/);
  assert.match(checkChange({ key: "planner.hours", value: ["13:00"] }, MERGED), /every entry/);
  assert.match(checkChange({ key: "planner.nope.deep", value: 1 }, MERGED), /no planner.nope section/);
  assert.match(checkChange({ key: "planner.project_caps.x", value: { a: 1 } }, MERGED), /whole section/);
});

test("applyChanges: writes into the owner's own config only, keeps the rest, refuses the whole batch on one bad key", () => {
  const own = { $schema: "./docs/config.schema.json", owner_name: "Alex", planner: { work_days: ["Mon"] } };
  const next = applyChanges(own, [{ key: "planner.max_focus_minutes_per_day", value: 180 }, { key: "planner.project_caps.side-app", value: 120 }], MERGED);
  assert.deepEqual(next, { $schema: "./docs/config.schema.json", owner_name: "Alex", planner: { work_days: ["Mon"], max_focus_minutes_per_day: 180, project_caps: { side-app: 120 } } });
  assert.deepEqual(own.planner, { work_days: ["Mon"] });
  assert.throws(() => applyChanges(own, [{ key: "planner.rollover", value: false }, { key: "guard.deny", value: [] }], MERGED), /guard.deny can't be set/);
  assert.throws(() => applyChanges(own, [], MERGED), /no config change/);
  assert.match(restartNote([{ key: "worker.build_model" }]), /restart/);
  assert.equal(restartNote([{ key: "planner.hours" }]), "");
});
