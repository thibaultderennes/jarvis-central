// Product metrics (agent/metrics.mjs): picking numbers from a source, and finding live projects with no numbers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pick, sourceList, expectsNumbers, metricsGaps, reminderTodo, gapLine, gapOptions } from "../../agent/metrics.mjs";

const TODAY = "2026-10-14";
const proj = (id, o = {}) => ({ id, name: id.toUpperCase(), archived: false, state: null, site_url: null, site: null, ...o });
const live = (id, o = {}) => proj(id, { site: { url: `https://${id}.example`, live: true }, ...o });

test("pick: map paths, array indexes counted from either end, {value: n}, strings", () => {
  const json = { weeks: [{ signups: 3 }, { signups: 5 }], paying: "7", visitors: { value: 40 }, name: "x" };
  assert.deepEqual(pick(json, { first: "weeks.0.signups", last: "weeks.-1.signups", paying_users: "paying", visits: "visitors", gone: "weeks.9.signups" }),
    { first: 3, last: 5, paying_users: 7, visits: 40 });
  assert.deepEqual(pick(json), { paying: 7, visitors: 40 });
  assert.deepEqual(pick({ metrics: { users: 2, Bad: 1 } }), { users: 2 });
});

test("sourceList: one source or several, junk dropped", () => {
  assert.deepEqual(sourceList(undefined), []);
  assert.deepEqual(sourceList({ url: "u" }), [{ url: "u" }]);
  assert.deepEqual(sourceList([{ url: "u" }, null, "x", { command: "c" }]), [{ url: "u" }, { command: "c" }]);
});

test("expectsNumbers: a live site, an owner-set address or a 'live' state; expect and skip win; archived never", () => {
  assert.equal(expectsNumbers(live("a")), true);
  assert.equal(expectsNumbers(proj("b", { site_url: "https://b.example" })), true);
  assert.equal(expectsNumbers(proj("c", { state: "Live" })), true);
  assert.equal(expectsNumbers(proj("d", { state: "Delivered" })), false);
  assert.equal(expectsNumbers(proj("e", { site: { url: "https://e.example", live: false } })), false);
  assert.equal(expectsNumbers(proj("f"), { expect: ["f"] }), true);
  assert.equal(expectsNumbers(live("g"), { skip: ["g"] }), false);
  assert.equal(expectsNumbers(live("h", { archived: true }), { expect: ["h"] }), false);
});

test("metricsGaps: no source, a source that never posted, a stale one; recent numbers are no gap", () => {
  const projects = [live("none"), live("never"), live("stale"), live("fresh"), live("typed"), proj("offline"), live("skipped")];
  const sources = { never: { url: "u" }, stale: [{ url: "u" }, { command: "c" }], fresh: { command: "c" } };
  const snapshots = [
    { project_id: "stale", date: "2026-10-01" }, { project_id: "fresh", date: "2026-10-01" }, { project_id: "fresh", date: "2026-10-13" },
    { project_id: "typed", date: "2026-10-08" },
  ];
  const gaps = metricsGaps({ projects, sources, snapshots, today: TODAY, staleDays: 7, skip: ["skipped"] });
  assert.deepEqual(gaps.map((g) => [g.id, g.why, g.last, g.days]), [
    ["none", "no-source", null, null], ["never", "never", null, null], ["stale", "stale", "2026-10-01", 13],
  ]);
  // A snapshot exactly stale_days old counts as stale; one a day newer doesn't.
  assert.equal(metricsGaps({ projects: [live("x")], snapshots: [{ project_id: "x", date: "2026-10-07" }], today: TODAY }).length, 1);
  assert.equal(metricsGaps({ projects: [live("x")], snapshots: [{ project_id: "x", date: "2026-10-08" }], today: TODAY }).length, 0);
});

test("reminderTodo: one todo for the projects to type by hand, none for broken sources", () => {
  assert.equal(reminderTodo([], TODAY), null);
  assert.equal(reminderTodo([{ id: "a", name: "A", why: "stale" }], TODAY), null);
  const one = reminderTodo([{ id: "a", name: "A", why: "no-source" }, { id: "b", name: "B", why: "never" }], TODAY);
  assert.equal(one.project_id, "a");
  assert.equal(one.date, TODAY);
  assert.match(one.title, /^Record this week's product numbers: A \(/);
  const two = reminderTodo([{ id: "a", name: "A", why: "no-source" }, { id: "c", name: "C", why: "no-source" }], TODAY);
  assert.equal(two.project_id, undefined);
  assert.match(two.title, /A, C/);
});

test("gapLine and gapOptions", () => {
  assert.match(gapLine({ id: "a", name: "A", why: "no-source", last: null }), /no source connected and nothing ever typed/);
  assert.match(gapLine({ id: "a", name: "A", why: "no-source", last: "2026-09-01" }), /nothing typed since 2026-09-01/);
  assert.match(gapLine({ id: "a", name: "A", why: "stale", last: "2026-09-01" }), /hasn't posted since 2026-09-01/);
  assert.deepEqual(gapOptions({}), { staleDays: 7, expect: [], skip: [] });
  assert.deepEqual(gapOptions({ stale_days: 14, expect: ["x"], skip: "nope" }), { staleDays: 14, expect: ["x"], skip: [] });
});
