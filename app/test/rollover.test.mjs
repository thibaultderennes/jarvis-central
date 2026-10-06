// The daily roll-forward (agent/rollover.mjs): pure logic, no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { rollForward, RESCOPE } from "../../agent/rollover.mjs";

const S = { rollover_max_per_day: 5, rollover_flag_after: 3, max_focus_minutes_per_day: 360, work_days: ["Mon", "Tue", "Wed", "Thu", "Fri"], weekends: "overflow" };
const TUE = "2026-10-06", MON = "2026-10-05", FRI = "2026-10-02", SAT = "2026-10-03";
const item = (id, o = {}) => ({ project_id: "app", id, title: `Item ${id}`, status: "todo", due: null, owner: "founder", critical: false, priority: 2, estimate_minutes: 60, ...o });
let n = 0;
const todo = (o = {}) => ({ id: `t${++n}`, title: `Todo ${n}`, date: MON, done: false, project_id: null, item_id: null, sort: n, rollovers: 0, rolled_from: null, rolled_at: null, ...o });

/** Apply a result to the todo list, as the API would, for repeat-run checks. */
function apply(todos, r) {
  const out = todos.map((t) => {
    const m = r.moves.find((x) => x.id === t.id);
    if (m) return { ...t, date: m.date, sort: m.sort, time: null, rollovers: m.rollovers, rolled_from: m.rolled_from, rolled_at: m.rolled_at };
    if (r.parks.some((p) => p.id === t.id)) return { ...t, date: null };
    return t;
  });
  r.adds.forEach((a, i) => out.push({ id: `added${i}`, done: false, rollovers: 0, ...a }));
  return out;
}
const empty = (r) => !r.moves.length && !r.adds.length && !r.parks.length && !r.flags.length;

test("nothing overdue: nothing moves", () => {
  const todos = [todo({ date: TUE }), todo({ date: "2026-10-07" }), todo({ date: MON, done: true })];
  const items = [item("later", { due: "2026-10-09" }), item("nodate")];
  const r = rollForward({ today: TUE, todos, items, settings: S });
  assert.ok(r.workday);
  assert.ok(empty(r));
  assert.equal(r.waiting.length, 0);
});

test("one overdue todo: carried to the top of today, untimed, counted once", () => {
  const today = [todo({ date: TUE, sort: 1 }), todo({ date: TUE, sort: 2 })];
  const late = todo({ date: MON, time: "10:00", project_id: "app", item_id: "a" });
  const r = rollForward({ today: TUE, todos: [...today, late], items: [item("a")], settings: S });
  assert.equal(r.moves.length, 1);
  const m = r.moves[0];
  assert.equal(m.id, late.id);
  assert.equal(m.date, TUE);
  assert.equal(m.time, null);
  assert.equal(m.rollovers, 1);
  assert.equal(m.rolled_from, MON);
  assert.ok(m.sort < 1, "above today's list");
  assert.equal(r.adds.length, 0, "the item already has a todo: no extra one");
});

test("an overdue item with no todo gets one today; a due-today item too; Claude's items don't", () => {
  const items = [item("late", { due: "2026-10-01" }), item("today", { due: TUE }), item("bot", { due: MON, owner: "claude" }), item("parked", { due: MON }), item("off", { due: MON, project_id: "off" })];
  const todos = [todo({ date: null, project_id: "app", item_id: "parked" })];
  const r = rollForward({ today: TUE, todos, items, projects: [{ id: "app" }, { id: "off", plan_enabled: false }], settings: S });
  assert.deepEqual(r.adds.map((a) => a.item_id), ["late", "today"]);
  assert.equal(r.adds[0].source, "rollover");
  assert.equal(r.adds[0].rolled_from, "2026-10-01");
});

test("closed items' todos and Someday todos stay put", () => {
  const todos = [todo({ date: MON, project_id: "app", item_id: "gone" }), todo({ date: null })];
  const r = rollForward({ today: TUE, todos, items: [], settings: S });
  assert.ok(empty(r));
});

test("order: critical first, then days overdue, then priority", () => {
  const items = [item("p1", { priority: 1 }), item("p3", { priority: 3 }), item("old", { priority: 3 }), item("crit", { critical: true, priority: 3 })];
  const todos = [
    todo({ date: MON, project_id: "app", item_id: "p3" }),
    todo({ date: MON, project_id: "app", item_id: "p1" }),
    todo({ date: "2026-10-01", project_id: "app", item_id: "old" }),
    todo({ date: MON, project_id: "app", item_id: "crit" }),
  ];
  const r = rollForward({ today: TUE, todos, items, settings: S });
  const order = [...r.moves].sort((a, b) => a.sort - b.sort).map((m) => todos.find((t) => t.id === m.id).item_id);
  assert.deepEqual(order, ["crit", "old", "p1", "p3"]);
});

test("more overdue than capacity: the most important fill the day, the rest wait", () => {
  const items = Array.from({ length: 8 }, (_, i) => item(`i${i}`, { estimate_minutes: 90, priority: (i % 3) + 1 }));
  const todos = items.map((i) => todo({ date: MON, project_id: "app", item_id: i.id }));
  todos.push(todo({ date: TUE, project_id: "app", item_id: "busy" }));
  items.push(item("busy", { estimate_minutes: 120 }));
  const r = rollForward({ today: TUE, todos, items, settings: S });
  // 360 cap - 120 already today = 240 → two 90-min items fit.
  assert.equal(r.moves.length, 2);
  assert.equal(r.load.after, 300);
  assert.equal(r.waiting.length, 6);
  assert.ok(r.moves.every((m) => items.find((i) => i.id === todos.find((t) => t.id === m.id).item_id).priority === 1));
});

test("the daily count cap holds even when minutes would fit", () => {
  const todos = Array.from({ length: 9 }, () => todo({ date: MON }));
  const r = rollForward({ today: TUE, todos, items: [], settings: S });
  assert.equal(r.moves.length, 5);
  assert.equal(r.waiting.length, 4);
  assert.match(r.waiting[0].reason, /cap/);
});

test("repeat run the same day changes nothing", () => {
  const items = [...Array.from({ length: 7 }, (_, i) => item(`i${i}`, { estimate_minutes: 45 })), item("due", { due: MON }), item("big", { due: MON, estimate_minutes: 300 })];
  let todos = [...items.slice(0, 7).map((i) => todo({ date: MON, project_id: "app", item_id: i.id })), todo({ date: "2026-09-30", rollovers: 3 }), todo({ date: TUE })];
  const first = rollForward({ today: TUE, todos, items, settings: S });
  assert.ok(first.moves.length + first.adds.length > 0);
  assert.equal(first.parks.length, 1);
  todos = apply(todos, first);
  const second = rollForward({ today: TUE, todos, items, settings: S });
  assert.ok(empty(second), JSON.stringify(second));
  // and a third, for good measure
  assert.ok(empty(rollForward({ today: TUE, todos: apply(todos, second), items, settings: S })));
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

test("after 3 carries: parked in Someday and its item flagged once for re-scoping", () => {
  const a = todo({ date: MON, project_id: "app", item_id: "a", rollovers: 3, rolled_from: "2026-10-01" });
  const b = todo({ date: MON, project_id: "app", item_id: "a", rollovers: 3 });
  const plain = todo({ date: MON, rollovers: 3 });
  const r = rollForward({ today: TUE, todos: [a, b, plain], items: [item("a", { due: "2026-10-01" })], settings: S });
  assert.equal(r.moves.length, 0);
  assert.deepEqual(r.parks.map((p) => p.id), [a.id, b.id, plain.id]);
  assert.equal(r.flags.length, 1);
  assert.equal(r.flags[0].refine, "flagged");
  assert.ok(r.flags[0].refine_note.startsWith(RESCOPE));
  assert.equal(r.adds.length, 0, "the parked todo still holds the item: no new todo");
  // an item already flagged for re-scoping isn't flagged again
  const again = rollForward({ today: TUE, todos: [a], items: [item("a", { refine: "flagged", refine_note: `${RESCOPE} earlier` })], settings: S });
  assert.equal(again.flags.length, 0);
});

test("todos older than the lookback are history", () => {
  const r = rollForward({ today: TUE, todos: [todo({ date: "2026-09-01" })], items: [], settings: S });
  assert.ok(empty(r));
});
