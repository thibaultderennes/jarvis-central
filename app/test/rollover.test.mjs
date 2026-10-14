// The daily roll-forward (agent/rollover.mjs): pure logic, no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { rollForward, RESCOPE } from "../../agent/rollover.mjs";

const S = { rollover_max_per_day: 5, rollover_flag_after: 3, max_focus_minutes_per_day: 360, work_days: ["Mon", "Tue", "Wed", "Thu", "Fri"], weekends: "overflow" };
const TUE = "2026-10-06", MON = "2026-10-05", FRI = "2026-10-02", SAT = "2026-10-03";
const item = (id, o = {}) => ({ project_id: "app", id, title: `Item ${id}`, status: "todo", due: null, owner: "founder", critical: false, priority: 2, estimate_minutes: 60, ...o });
let n = 0;
const todo = (o = {}) => ({ id: `t${++n}`, title: `Todo ${n}`, date: MON, done: false, project_id: null, item_id: null, sort: n, rollovers: 0, rolled_from: null, rolled_at: null, ...o });

/** Apply a result as the API would (todos moved or parked, kv rollover.today replaced), for repeat-run checks. */
function apply(todos, r, today) {
  const out = todos.map((t) => {
    const m = r.moves.find((x) => x.id === t.id);
    if (m) return { ...t, date: m.date, sort: m.sort, time: null, rollovers: m.rollovers, rolled_from: m.rolled_from, rolled_at: m.rolled_at };
    if (r.parks.some((p) => p.id === t.id)) return { ...t, date: null };
    return t;
  });
  return { todos: out, prev: { date: today, items: r.items, counts: r.counts } };
}
const newCarries = (r) => r.items.filter((x) => x.carries).map((x) => x.key);
const empty = (r) => !r.moves.length && !newCarries(r).length && !r.parks.length && !r.flags.length;

test("nothing overdue: nothing moves", () => {
  const todos = [todo({ date: TUE }), todo({ date: "2026-10-07" }), todo({ date: MON, done: true })];
  const items = [item("later", { due: "2026-10-09" }), item("nodate"), item("today", { due: TUE })];
  const r = rollForward({ today: TUE, todos, items, settings: S });
  assert.ok(r.workday);
  assert.ok(empty(r));
  assert.equal(r.waiting.length, 0);
  assert.equal(r.load.before, 60, "the item due today is on Today's load already");
});

test("an overdue item is carried as an item: no todo is made, its due date untouched, its count goes up", () => {
  const items = [item("late", { due: "2026-10-01" }), item("bot", { due: MON, owner: "claude" }), item("off", { due: MON, project_id: "off" }), item("busy", { due: MON, status: "doing" })];
  const r = rollForward({ today: TUE, todos: [], items, projects: [{ id: "app" }, { id: "off", plan_enabled: false }], settings: S });
  assert.deepEqual(newCarries(r), ["app/late"], "not Claude's, not a project with planning off, not one already in progress");
  assert.equal(r.items[0].overdue, 5);
  assert.deepEqual(r.counts, { "app/late": 1 });
  assert.equal(r.moves.length, 0);
  assert.equal("adds" in r, false, "the roll-forward never creates todos");
  assert.equal(r.load.before, 60, "the in-progress item counts in today's load");
  assert.equal(r.load.after, 120);
});

test("one undone personal todo: carried to the top of today, untimed", () => {
  const today = [todo({ date: TUE, sort: 1 }), todo({ date: TUE, sort: 2 })];
  const late = todo({ date: MON, time: "10:00" });
  const r = rollForward({ today: TUE, todos: [...today, late], items: [], settings: S });
  assert.equal(r.moves.length, 1);
  const m = r.moves[0];
  assert.equal(m.id, late.id);
  assert.equal(m.date, TUE);
  assert.equal(m.time, null);
  assert.equal(m.rollovers, 1);
  assert.equal(m.rolled_from, MON);
  assert.ok(m.sort < 1, "above today's list");
});

test("old work todos linked to items don't carry; their item does when it's overdue", () => {
  const items = [item("a", { due: MON }), item("b", { due: "2026-10-09" })];
  const todos = [todo({ date: MON, project_id: "app", item_id: "a", source: "plan" }), todo({ date: MON, project_id: "app", item_id: "b" })];
  const r = rollForward({ today: TUE, todos, items, settings: S });
  assert.equal(r.moves.length, 0);
  assert.deepEqual(newCarries(r), ["app/a"]);
});

test("an item you placed yourself (a todo today, later, or in Someday) isn't carried", () => {
  const items = [item("later", { due: MON }), item("someday", { due: MON }), item("closed-todo", { due: MON })];
  const todos = [todo({ date: "2026-10-08", project_id: "app", item_id: "later" }), todo({ date: null, project_id: "app", item_id: "someday" }), todo({ date: TUE, project_id: "app", item_id: "closed-todo", done: true })];
  assert.deepEqual(newCarries(rollForward({ today: TUE, todos, items, settings: S })), ["app/closed-todo"]);
});

test("closed items and Someday todos stay put", () => {
  const todos = [todo({ date: MON, project_id: "app", item_id: "gone" }), todo({ date: null })];
  const r = rollForward({ today: TUE, todos, items: [item("done", { due: MON, status: "done" })], settings: S });
  assert.ok(empty(r));
});

test("order: critical first, then days overdue, then priority", () => {
  const items = [item("p1", { priority: 1, due: MON }), item("p3", { priority: 3, due: MON }), item("old", { priority: 3, due: "2026-10-01" }), item("crit", { critical: true, priority: 3, due: MON })];
  const r = rollForward({ today: TUE, todos: [], items, settings: S });
  assert.deepEqual(newCarries(r), ["app/crit", "app/old", "app/p1", "app/p3"]);
});

test("more overdue than capacity: the most important fill the day, the rest wait", () => {
  const items = Array.from({ length: 8 }, (_, i) => item(`i${i}`, { estimate_minutes: 90, priority: (i % 3) + 1, due: MON }));
  items.push(item("busy", { estimate_minutes: 120, due: TUE }));
  const r = rollForward({ today: TUE, todos: [], items, settings: S });
  // 360 cap - 120 already due today = 240 → two 90-min items fit.
  assert.equal(newCarries(r).length, 2);
  assert.equal(r.load.after, 300);
  assert.equal(r.waiting.length, 6);
  assert.ok(newCarries(r).every((k) => items.find((i) => `app/${i.id}` === k).priority === 1));
});

test("the daily count cap holds even when minutes would fit", () => {
  const todos = Array.from({ length: 9 }, () => todo({ date: MON }));
  const r = rollForward({ today: TUE, todos, items: [], settings: S });
  assert.equal(r.moves.length, 5);
  assert.equal(r.waiting.length, 4);
  assert.match(r.waiting[0].reason, /cap/);
});

test("repeat run the same day changes nothing and keeps the morning's carries", () => {
  const items = [...Array.from({ length: 7 }, (_, i) => item(`i${i}`, { estimate_minutes: 45, due: MON })), item("big", { due: MON, estimate_minutes: 300 })];
  const todos0 = [todo({ date: "2026-09-30", rollovers: 3 }), todo({ date: MON }), todo({ date: TUE })];
  const first = rollForward({ today: TUE, todos: todos0, items, settings: S });
  assert.ok(newCarries(first).length > 0 && first.moves.length === 1);
  assert.equal(first.parks.length, 1);
  const a = apply(todos0, first, TUE);
  const second = rollForward({ today: TUE, todos: a.todos, items, settings: S, prev: a.prev });
  assert.ok(empty(second), JSON.stringify(second));
  assert.deepEqual(second.items.map((x) => x.key), first.items.map((x) => x.key), "today's carried items stay listed");
  assert.deepEqual(second.counts, first.counts, "counts don't go up twice in a day");
  assert.equal(second.load.before, first.load.after);
  const b = apply(a.todos, second, TUE);
  assert.ok(empty(rollForward({ today: TUE, todos: b.todos, items, settings: S, prev: b.prev })));
});

test("the next day an item still overdue is carried again, its count one higher; re-dated items lose their count", () => {
  const items = [item("a", { due: MON }), item("b", { due: "2026-10-09" })];
  const prev = { date: MON, items: [{ key: "app/a" }], counts: { "app/a": 1, "app/b": 2, "app/gone": 1 } };
  const r = rollForward({ today: TUE, todos: [], items, settings: S, prev });
  assert.deepEqual(r.counts, { "app/a": 2 });
});

test("weekend gap: nothing runs on Saturday; Monday carries Friday's once, three days overdue", () => {
  const t = todo({ date: FRI, rollovers: 1, rolled_from: "2026-10-01" });
  const sat = rollForward({ today: SAT, todos: [t], items: [], settings: S });
  assert.equal(sat.workday, false);
  assert.ok(empty(sat));
  const mon = rollForward({ today: MON, todos: [t], items: [], settings: S });
  assert.equal(mon.moves.length, 1);
  assert.equal(mon.moves[0].rollovers, 2, "the weekend is one carry, not three");
  assert.equal(mon.moves[0].overdue, 4, "counted from the day it was first meant for");
  assert.equal(mon.moves[0].rolled_from, "2026-10-01");
  // weekends "always": Saturday is a work day
  assert.equal(rollForward({ today: SAT, todos: [t], items: [], settings: { ...S, weekends: "always" } }).moves.length, 1);
});

test("after 3 carries: an item is flagged once for re-scoping and waits; a personal todo is parked in Someday", () => {
  const plain = todo({ date: MON, rollovers: 3 });
  const prev = { date: MON, items: [], counts: { "app/a": 3 } };
  const r = rollForward({ today: TUE, todos: [plain], items: [item("a", { due: "2026-10-01" })], settings: S, prev });
  assert.equal(r.moves.length, 0);
  assert.equal(newCarries(r).length, 0);
  assert.deepEqual(r.parks.map((p) => p.id), [plain.id]);
  assert.equal(r.flags.length, 1);
  assert.equal(r.flags[0].refine, "flagged");
  assert.ok(r.flags[0].refine_note.startsWith(RESCOPE));
  // an item already flagged for re-scoping isn't flagged again
  const again = rollForward({ today: TUE, todos: [], items: [item("a", { due: "2026-10-01", refine: "flagged", refine_note: `${RESCOPE} earlier` })], settings: S, prev });
  assert.equal(again.flags.length, 0);
});

test("todos older than the lookback are history", () => {
  const r = rollForward({ today: TUE, todos: [todo({ date: "2026-09-01" })], items: [], settings: S });
  assert.ok(empty(r));
});

import { waitingFor, lateLabel } from "../lib/rollover.ts";

test("waitingFor: only that day, critical then most late first", () => {
  const v = { date: "2026-10-06", load: { before: 420, after: 420, cap: 360 }, waiting: [
    { title: "a", key: "p/a", critical: false, overdue: 5, reason: "no room today (420 of 360 focus min used, needs 60)" },
    { title: "b", key: "p/b", critical: true, overdue: 1, reason: "no room today (420 of 360 focus min used, needs 60)" },
    { title: "c", key: null, critical: false, overdue: 9, reason: "daily carry-over cap (5) reached" } ] };
  const w = waitingFor(v, "2026-10-06");
  assert.equal(w.count, 3);
  assert.deepEqual(w.tasks.map((t) => t.title), ["b", "c", "a"]);
  assert.equal(w.full, true);
  assert.equal(waitingFor(v, "2026-10-07"), null);
  assert.equal(waitingFor({ date: "2026-10-06", waiting: [] }, "2026-10-06"), null);
  assert.equal(waitingFor(null, "2026-10-06"), null);
  assert.equal(lateLabel(0), "due today");
  assert.equal(lateLabel(3), "3 days late");
});
