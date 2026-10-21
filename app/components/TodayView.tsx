"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { DndContext, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { newItem, placeTodo, removeTodo, setDue, setItemStatus, toggleTodo, createTodo } from "@/lib/actions";
import type { Todo } from "@/lib/data";
import type { CalEvent } from "@/lib/calendar";
import type { WorkRow } from "@/lib/board";
import { isPersonal, workLoad, DEFAULT_EST } from "@/lib/today";
import { lateLabel, type Waiting } from "@/lib/rollover";
import { EditTitle, type BItem } from "./Board";
import { Ack, imeGuard, useSubmit } from "./Submit";
import { Glyph, HeaderVec } from "@/components/brand";
import { Icon } from "./icons";

type P = { id: string; name: string; color: string };
type Block = { project_id: string; item_id: string; title: string; start: string; end: string };
type Props = {
  day: string; today: string; label: string; dateLine: string; prev: { d: string; l: string }; next: { d: string; l: string };
  todos: Todo[]; events: CalEvent[]; calendarOn: boolean; calendarError?: string; backlog: BItem[];
  /** The day's checklist items (due, in progress, carried in, done that day): see lib/today.ts. */
  work: { open: WorkRow[]; done: WorkRow[] };
  projects: P[]; nowTime: string; capMinutes: number; blocks: Block[]; unplanned: { project_id: string; item_id: string; title: string; reason: string }[];
  /** What this morning's roll-forward couldn't fit (kv rollover.today), shown only on that day. */
  waiting?: Waiting | null;
};
const addDays = (d: string, n: number) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const fmt = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("en-CA", { timeZone: "UTC", month: "short", day: "numeric" });
const hours = (m: number) => (m >= 60 ? `${Math.round(m / 30) / 2} h` : `${m} min`);
const key = (i: { project_id: string; id: string }) => `${i.project_id}/${i.id}`;
const mins = (s: string) => +s.slice(0, 2) * 60 + +s.slice(3, 5);
const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const byOrder = (a: Todo, b: Todo) => a.sort - b.sort;

export default function TodayView(props: Props) {
  const { day, today, projects, capMinutes } = props;
  const isToday = day === today;
  const pmap = useMemo(() => Object.fromEntries(projects.map((p) => [p.id, p])), [projects]);
  const [todos, setTodos] = useState(props.todos);
  useEffect(() => setTodos(props.todos), [props.todos]);
  const [handled, setHandled] = useState<Set<string>>(() => new Set());
  useEffect(() => setHandled(new Set()), [props.backlog, props.work]);
  const [, start] = useTransition();
  const [msg, setMsg] = useState("");
  const run = (fn: () => Promise<unknown>) => start(async () => { try { setMsg(""); await fn(); } catch { setMsg("Couldn't save that. Check your connection and try again."); setTodos(props.todos); setHandled(new Set()); } });
  const hide = (k: string) => setHandled((s) => new Set(s).add(k));

  // Todos are personal tasks; work is the checklist items (a todo linked to an item shows as that item).
  const list = todos.filter((t) => t.date === day && isPersonal(t)).sort(byOrder);
  const open = list.filter((t) => !t.done), done = list.filter((t) => t.done);
  const someday = todos.filter((t) => !t.date && !t.done && isPersonal(t)).sort(byOrder);
  const work = props.work.open.filter((r) => !handled.has(key(r.item))), workDone = props.work.done;
  const onList = new Set([...props.work.open, ...workDone].map((r) => key(r.item)));
  const backlog = props.backlog.filter((i) => !handled.has(key(i)) && !onList.has(key(i)));
  const overdue = backlog.filter((i) => i.due && i.due < today).sort((a, b) => Number(b.critical) - Number(a.critical) || a.due!.localeCompare(b.due!));
  const coming = backlog.filter((i) => !(i.due && i.due < today));
  const suggest = props.unplanned.filter((u) => !onList.has(`${u.project_id}/${u.item_id}`) && !handled.has(`${u.project_id}/${u.item_id}`));

  // Load: each open item on the list weighs its estimate; personal todos weigh nothing.
  const load = workLoad(work);
  const total = list.length + work.length + workDone.length, nDone = done.length + workDone.length;

  const toggle = (t: Todo) => { setTodos((xs) => xs.map((x) => (x.id === t.id ? { ...x, done: !x.done } : x))); run(() => toggleTodo(t.id)); };
  const move = (t: Todo, date: string | null) => { setTodos((xs) => xs.map((x) => (x.id === t.id ? { ...x, date, sort: 1e9 } : x))); run(() => placeTodo(t.id, date, [])); };
  const del = (t: Todo) => { setTodos((xs) => xs.filter((x) => x.id !== t.id)); run(() => removeTodo(t.id)); };
  const reorder = (ids: string[]) => {
    const order = [...ids, ...done.map((t) => t.id)];
    setTodos((xs) => xs.map((x) => (order.includes(x.id) ? { ...x, sort: order.indexOf(x.id) + 1 } : x)));
    run(() => placeTodo(ids[0], day, order));
  };
  const nudge = (t: Todo, dir: -1 | 1) => { const ids = open.map((x) => x.id), i = ids.indexOf(t.id), j = i + dir; if (j < 0 || j >= ids.length) return; reorder(arrayMove(ids, i, j)); };
  // Putting an item on a day never makes a todo: on Today it starts it (in progress), on another day it moves its due date there.
  const pull = (it: { project_id: string; id: string }) => { hide(key(it)); run(() => (isToday ? setItemStatus(it.project_id, it.id, "doing") : setDue(it.project_id, it.id, day))); };
  const finish = (it: BItem) => { hide(key(it)); run(() => setItemStatus(it.project_id, it.id, "done")); };
  const reopen = (it: BItem) => run(() => setItemStatus(it.project_id, it.id, "todo"));
  const shift = (it: BItem, date: string) => { hide(key(it)); run(() => setDue(it.project_id, it.id, date)); };
  // "→" on a work row: a planned row moves its old todo; due or carried rows move the due date; in-progress rows stay.
  const later = (r: WorkRow, date: string) => {
    if (r.why === "planned" && r.todo) { hide(key(r.item)); const id = r.todo; run(() => placeTodo(id, date, [])); }
    else if (r.why === "due" || r.why === "carried") shift(r.item, date);
  };

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const onEnd = (e: DragEndEvent) => { const ids = open.map((x) => x.id), a = ids.indexOf(String(e.active.id)), b = ids.indexOf(String(e.over?.id)); if (a >= 0 && b >= 0 && a !== b) reorder(arrayMove(ids, a, b)); };

  const evs = props.events.filter((e) => e.date === day);
  const nowM = isToday ? mins(props.nowTime) : day < today ? 1e4 : -1;
  const nextEv = isToday ? evs.find((e) => !e.allDay && e.startTime && mins(e.startTime) >= nowM) : undefined;
  const over = load > capMinutes;
  const tom = addDays(day, 1);

  return (
    <div className="td">
      <header className="td-head">
        <div className="td-ttl">
          <h1 className="page"><Glyph n="today" />{props.label}</h1>
          {isToday && <span className="td-date">{props.dateLine}</span>}
          <HeaderVec n="today" />
        </div>
        <nav className="daynav" aria-label="Change day">
          <Link href={`/today?d=${props.prev.d}`} aria-label="Previous day">‹ {props.prev.l}</Link>
          {!isToday && <Link href="/today">Today</Link>}
          <Link href={`/today?d=${props.next.d}`} aria-label="Next day">{props.next.l} ›</Link>
        </nav>
        <div className="td-stats">
          <span className="td-prog"><b>{nDone}</b> of {total} done</span>
          <span className={`td-load${over ? " over" : ""}`} title={`Work left, from the estimates of the checklist items on the list (${DEFAULT_EST} min when unknown), against ${hours(capMinutes)} of focus a day`}>
            <span className="td-bar" aria-hidden="true"><i style={{ width: `${Math.min(100, (load / capMinutes) * 100)}%` }} /></span>
            ~{hours(load)} of {hours(capMinutes)} focus{over ? ` · over by ${hours(load - capMinutes)}` : ""}
          </span>
        </div>
      </header>
      {msg && <div className="due late" role="alert">{msg}</div>}
      {props.waiting && <WaitingLine w={props.waiting} pmap={Object.fromEntries(projects.map((p) => [p.id, p]))} />}

      <div className="td-grid">
        <section className="panel td-main" aria-label={`${props.label}'s list`}>
          <QuickAdd day={day} projects={projects} />
          <DndContext id="jarvis-today" sensors={sensors} collisionDetection={closestCenter} onDragEnd={onEnd}>
            <SortableContext items={open.map((t) => t.id)} strategy={verticalListSortingStrategy}>
              <ol className="td-list">
                {work.map((r, n) => <ItemRow key={key(r.item)} r={r} p={pmap[r.item.project_id]} next={n === 0} today={today} onDone={() => finish(r.item)}
                  onTomorrow={r.why === "doing" ? undefined : () => later(r, tom)} />)}
                {open.map((t, i) => (
                  <Row key={t.id} t={t} p={t.project_id ? pmap[t.project_id] : undefined} next={!work.length && i === 0}
                    onToggle={() => toggle(t)} onTomorrow={() => move(t, tom)} onDate={(d) => move(t, d)} onSomeday={() => move(t, null)} onDelete={() => del(t)} onNudge={(d) => nudge(t, d)} />
                ))}
              </ol>
            </SortableContext>
          </DndContext>
          {!open.length && !work.length && (
            <div className="empty td-empty">{total ? "All done for the day." : `Nothing on ${isToday ? "today" : "this day"} yet. Type above and press Enter to add a personal todo, or ${isToday ? "start" : "pick"} a checklist item from Later.`}</div>
          )}
          {done.length + workDone.length > 0 && (
            <details className="td-done">
              <summary>Done <span className="ct">{done.length + workDone.length}</span></summary>
              <ol className="td-list">
                {workDone.map((r) => <ItemRow key={key(r.item)} r={r} p={pmap[r.item.project_id]} next={false} today={today} onDone={() => reopen(r.item)} />)}
                {done.map((t) => <Row key={t.id} t={t} p={t.project_id ? pmap[t.project_id] : undefined} next={false} onToggle={() => toggle(t)} onDelete={() => del(t)} />)}
              </ol>
            </details>
          )}
        </section>

        <Agenda events={evs} todos={todos.filter((t) => t.date === day)} blocks={props.blocks} doneKeys={new Set(workDone.map((r) => key(r.item)))} on={props.calendarOn} error={props.calendarError} nowM={nowM} pmap={pmap} nextEv={nextEv} />

        <details className="panel td-later">
          <summary>
            <span className="ph-t">Later</span>
            <span className="td-counts">
              {overdue.length > 0 && <span className="late">{overdue.length} overdue</span>}
              <span>{coming.length} coming up</span>
              <span>{someday.length} someday</span>
              {suggest.length > 0 && <span>{suggest.length} from the plan</span>}
            </span>
          </summary>
          <Later overdue={overdue} coming={coming} someday={someday} suggest={suggest} pmap={pmap} projects={projects} today={today} isToday={isToday}
            onPull={pull} onDone={finish} onShift={shift} onTodo={(t) => move(t, day)} onDelete={del} />
        </details>
      </div>
    </div>
  );
}

/** A personal todo (or an older project todo not linked to an item). */
function Row({ t, p, next, onToggle, onTomorrow, onDate, onSomeday, onDelete, onNudge }: {
  t: Todo; p?: P; next: boolean; onToggle: () => void; onTomorrow?: () => void; onDate?: (d: string) => void; onSomeday?: () => void; onDelete: () => void; onNudge?: (d: -1 | 1) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: t.id, disabled: t.done });
  const [editing, setEditing] = useState(false), [menu, setMenu] = useState(false);
  const tmp = t.id.startsWith("tmp-");
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} data-c={p?.color || (t.kind === "work" ? "other" : "life")}
      className={`td-row${next ? " next" : ""}${menu ? " menu" : ""}${t.done ? " done" : ""}${isDragging ? " dragging" : ""}`}
      onKeyDown={(e) => { if (onNudge && e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown") && !(e.target as HTMLElement).matches("input")) { e.preventDefault(); onNudge(e.key === "ArrowUp" ? -1 : 1); } }}>
      {t.done ? <span /> : <button className="grip" aria-label={`Reorder ${t.title} (drag, or Alt+↑/↓)`} {...attributes} {...listeners}>⠿</button>}
      <button className="ck" aria-label={`${t.done ? "Mark not done" : "Mark done"}: ${t.title}`} disabled={tmp} onClick={onToggle}>✓</button>
      <span className="tt" onDoubleClick={() => !tmp && setEditing(true)}>
        {next && <span className="td-tag"><Icon n="start" size={13} />Next up</span>}
        {editing ? <EditTitle t={t} onDone={() => setEditing(false)} /> : <span className="ti">{t.title}</span>}
        <small>
          {t.time && <span className="tm">{t.time}</span>}
          {p ? <Link href={`/p/${p.id}`}>{p.name}</Link> : t.kind === "life" ? "Personal" : null}
        </small>
      </span>
      <button className="td-dots" aria-expanded={menu} aria-label={`More actions: ${t.title}`} onClick={() => setMenu(!menu)}>⋯</button>
      <span className="acts">
        {onTomorrow && <button title="Move to the next day" aria-label={`Move ${t.title} to the next day`} onClick={onTomorrow} disabled={tmp}>→</button>}
        {onDate && <input type="date" className="movedate" aria-label={`Move ${t.title} to a day`} title="Move to a day" value="" disabled={tmp} onChange={(e) => e.target.value && onDate(e.target.value)} />}
        {onSomeday && <button title="Move to someday" aria-label={`Move ${t.title} to someday`} onClick={onSomeday} disabled={tmp}>↓</button>}
        <button title="Delete" aria-label={`Delete ${t.title}`} onClick={onDelete} disabled={tmp}>×</button>
      </span>
    </li>
  );
}

/** A checklist item on the day: due, in progress, carried in by the roll-forward, planned, or done that day. Ticking it marks the item done. */
function ItemRow({ r, p, next, today, onDone, onTomorrow }: { r: WorkRow; p?: P; next: boolean; today: string; onDone: () => void; onTomorrow?: () => void }) {
  const it = r.item, isDone = r.why === "done";
  const moveTitle = r.why === "planned" ? "Move it to the next day" : "Move its due date to the next day";
  return (
    <li className={`td-row item${next ? " next" : ""}${it.critical && !isDone ? " crit" : ""}${isDone ? " done" : ""}${r.late && !isDone ? " late" : ""}`} data-c={p?.color}>
      <span className="grip" aria-hidden="true" />
      <button className="ck" aria-label={`${isDone ? "Mark not done" : "Mark done"}: ${it.title}`} onClick={onDone}>✓</button>
      <span className="tt">
        {next && <span className="td-tag"><Icon n="start" size={13} />Next up</span>}
        <span className="ti">{it.title}</span>
        <small>
          <Link href={`/p/${it.project_id}`}>{p?.name} · {it.id}</Link>
          {it.due && <span>due {it.due === today ? "today" : fmt(it.due)}</span>}
          {r.why === "doing" && <span>in progress</span>}
          {r.why === "carried" && <span>carried in this morning</span>}
          {it.critical && !isDone && <b className="latetag">critical</b>}
          {r.late && !isDone && <b className="latetag">overdue</b>}
          {it.estimate_minutes ? <span>~{hours(it.estimate_minutes)}</span> : null}
          {it.owner === "claude" && <span>Claude</span>}
        </small>
      </span>
      {onTomorrow && !isDone && <span className="acts"><button title={moveTitle} aria-label={`${moveTitle}: ${it.title}`} onClick={onTomorrow}>→</button></span>}
    </li>
  );
}

/**
 * Enter adds a personal todo. "14:00 call the bank" sets the time; time and project also sit behind "More".
 * Picking a project adds a checklist item due that day instead (work lives on the checklist). Text stays if the save fails.
 */
function QuickAdd({ day, projects }: { day: string; projects: P[] }) {
  const [title, setTitle] = useState(""), [time, setTime] = useState(""), [proj, setProj] = useState(""), [more, setMore] = useState(false);
  const s = useSubmit();
  return (
    <form className="td-add" onKeyDown={imeGuard} onSubmit={(e) => {
      e.preventDefault(); let v = title.trim(), tm = time; if (!v || s.pending) return;
      const m = /^([01]?\d|2[0-3])[:h]([0-5]\d)\s+(.+)$/.exec(v); if (m && !tm) { tm = `${m[1].padStart(2, "0")}:${m[2]}`; v = m[3]; }
      s.submit(async () => proj ? newItem(proj, "", v, day)
        : (await createTodo({ date: day, title: v, time: tm || null, kind: "life" })) ?? { error: "Couldn't add that todo: check the title." },
        { ok: "Added", onOk: () => { setTitle(""); setTime(""); } });
    }}>
      <span className="plus" aria-hidden="true">+</span>
      <input id="qa-title-d" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={proj ? "Add a checklist item due this day, Enter to save" : "Add a personal todo, Enter to save (“14:00 call the bank” sets a time)"} aria-label={proj ? "New checklist item" : "New todo"} autoComplete="off" />
      <button type="button" className="btn ghost sm" aria-expanded={more} onClick={() => setMore(!more)}>{more ? "Less" : "More"}</button>
      <button className="btn sm" disabled={!title.trim() || s.pending}>{s.pending ? "Adding…" : "Add"}</button>
      {more && (
        <span className="td-opts">
          {!proj && <input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Time (optional)" />}
          <select className="select" value={proj} onChange={(e) => setProj(e.target.value)} aria-label="Personal todo, or a checklist item in a project">
            <option value="">Personal todo</option>
            {projects.map((p) => <option key={p.id} value={p.id}>Item in {p.name}</option>)}
          </select>
        </span>
      )}
      <Ack s={s} busy="Adding…" />
    </form>
  );
}

const PX = 38; // pixels per hour on the agenda
/** Calendar events, the Sunday plan's blocks (done once their item is) and timed todos, on an hour grid. */
function Agenda({ events, todos, blocks, doneKeys, on, error, nowM, pmap, nextEv }: { events: CalEvent[]; todos: Todo[]; blocks: Block[]; doneKeys: Set<string>; on: boolean; error?: string; nowM: number; pmap: Record<string, P>; nextEv?: CalEvent }) {
  const [open, setOpen] = useState(false);
  const allDay = events.filter((e) => e.allDay);
  // A timed todo the planner made before blocks stopped becoming todos is the same slot as its block: show it once.
  const sameSlot = (t: Todo) => !!t.item_id && blocks.some((b) => b.start === t.time && b.item_id === t.item_id && b.project_id === t.project_id);
  const entries = [
    ...events.filter((e) => !e.allDay && e.startTime).map((e) => ({ id: e.id, kind: "ev", title: e.title, s: mins(e.startTime!), e: e.endTime ? Math.max(mins(e.endTime), mins(e.startTime!) + 15) : mins(e.startTime!) + 30, c: undefined as string | undefined, done: false, sub: e.location })),
    ...blocks.map((b, i) => ({ id: `b${i}-${b.item_id}`, kind: "todo", title: b.title, s: mins(b.start), e: Math.max(mins(b.end), mins(b.start) + 15), c: pmap[b.project_id]?.color, done: doneKeys.has(`${b.project_id}/${b.item_id}`), sub: "" })),
    ...todos.filter((t) => t.time && !sameSlot(t)).map((t) => ({ id: t.id, kind: "todo", title: t.title, s: mins(t.time!), e: mins(t.time!) + 30, c: t.project_id ? pmap[t.project_id]?.color : "life", done: t.done, sub: "" })),
  ].sort((a, b) => a.s - b.s || b.e - a.e);
  // Side-by-side lanes for overlaps.
  const lanes: number[] = [], placed = entries.map((x) => { let l = lanes.findIndex((end) => end <= x.s); if (l < 0) { l = lanes.length; lanes.push(0); } lanes[l] = x.e; return { ...x, lane: l }; });
  const cols = (x: (typeof placed)[number]) => Math.max(...placed.filter((y) => y.s < x.e && y.e > x.s).map((y) => y.lane)) + 1;
  const h0 = Math.min(8, ...entries.map((x) => Math.floor(x.s / 60))), h1 = Math.max(18, ...entries.map((x) => Math.ceil(x.e / 60)));
  const timed = entries.length, planned = entries.filter((x) => x.kind !== "ev").length;
  const summary = !on && !timed ? "Calendar not connected" : `${events.length} event${events.length === 1 ? "" : "s"} · ${planned} planned${nextEv ? ` · next ${nextEv.startTime}` : ""}`;
  return (
    <section className={`panel td-rail${open ? " open" : ""}`} aria-labelledby="h-agenda">
      <h2 className="td-railh" id="h-agenda">
        <button className="td-railhead" aria-expanded={open} onClick={() => setOpen(!open)}><span className="ph-t">Agenda</span><span className="hint">{summary}</span><span className="chev" aria-hidden="true">▾</span></button>
      </h2>
      <div className="td-railbody">
        {!on && <div className="empty">Google Calendar isn&apos;t connected yet. Add your calendar&apos;s secret iCal address in the site settings and appointments show here.</div>}
        {on && error && <div className="empty">Couldn&apos;t read your calendar just now ({error}). It retries every 5 minutes.</div>}
        {allDay.length > 0 && <div className="td-allday">{allDay.map((e) => <span key={e.id}>{e.title}</span>)}</div>}
        <div className="td-time" style={{ height: (h1 - h0) * PX }}>
          {Array.from({ length: h1 - h0 }, (_, i) => <div key={i} className="hr" style={{ top: i * PX }}><span>{hhmm((h0 + i) * 60)}</span></div>)}
          {placed.map((x) => {
            const n = cols(x), past = x.e <= nowM;
            return (
              <div key={x.id} className={`blk k-${x.kind}${x.done ? " done" : ""}${past ? " past" : ""}${x.s <= nowM && x.e > nowM ? " now" : ""}`} data-c={x.c}
                style={{ top: ((x.s - h0 * 60) / 60) * PX, height: Math.max(16, ((x.e - x.s) / 60) * PX - 2), left: `calc(42px + (100% - 46px) * ${x.lane / n})`, width: `calc((100% - 46px) / ${n} - 2px)` }}
                title={`${hhmm(x.s)}–${hhmm(x.e)} ${x.title}${x.sub ? ` · ${x.sub}` : ""}`}>
                <span className="tm">{hhmm(x.s)}</span> {x.title}
              </div>
            );
          })}
          {nowM >= h0 * 60 && nowM <= h1 * 60 && <div className="nowline" style={{ top: ((nowM - h0 * 60) / 60) * PX }} aria-label={`Now, ${hhmm(nowM)}`} />}
        </div>
        {on && !error && !timed && !allDay.length && <div className="empty">Nothing on the calendar, no plan blocks and no timed todos.</div>}
      </div>
    </section>
  );
}

function Later({ overdue, coming, someday, suggest, pmap, projects, today, isToday, onPull, onDone, onShift, onTodo, onDelete }: {
  overdue: BItem[]; coming: BItem[]; someday: Todo[]; suggest: Props["unplanned"]; pmap: Record<string, P>; projects: P[]; today: string; isToday: boolean;
  onPull: (it: { project_id: string; id: string }) => void; onDone: (it: BItem) => void; onShift: (it: BItem, d: string) => void; onTodo: (t: Todo) => void; onDelete: (t: Todo) => void;
}) {
  const [filter, setFilter] = useState("all"), [all, setAll] = useState(false);
  // Today: "Start" sets the item in progress, which puts it on the list. Another day: "+ Day" makes it due that day.
  const add = isToday ? "Start" : "+ Day";
  const shown = coming.filter((i) => filter === "all" || i.project_id === filter);
  const line = (i: BItem, acts: React.ReactNode) => (
    <div key={key(i)} className={`td-lrow${i.critical ? " crit" : ""}`} data-c={pmap[i.project_id]?.color}>
      <i className="dot" />
      <span className="tt"><Link href={`/p/${i.project_id}`} title={i.title}>{i.title}</Link><small>{pmap[i.project_id]?.name} · {i.secName}{i.status === "doing" ? " · in progress" : ""}{i.owner === "claude" ? " · Claude" : ""}{i.critical ? " · critical" : ""}{i.estimate_minutes ? ` · ~${hours(i.estimate_minutes)}` : ""}</small></span>
      <span className={`due${i.due && i.due < today ? " late" : ""}`}>{i.due ? fmt(i.due) : ""}</span>
      <span className="sacts">{acts}</span>
    </div>
  );
  return (
    <div className="td-laterbody">
      {overdue.length > 0 && (
        <div className="td-grp">
          <div className="bgroup"><span className="lbl">Overdue</span><span className="ct">{overdue.length}</span><span className="hint">finish, start, or give a new day</span></div>
          {overdue.map((i) => line(i, <>
            <button className="btn ghost sm" onClick={() => onDone(i)}>✓ Done</button>
            <button className="btn ghost sm" onClick={() => onPull(i)}>{add}</button>
            <button className="btn ghost sm" onClick={() => onShift(i, addDays(today, 1))}>→ Tomorrow</button>
          </>))}
        </div>
      )}
      {suggest.length > 0 && (
        <div className="td-grp">
          <div className="bgroup"><span className="lbl">The plan couldn&apos;t fit</span><span className="ct">{suggest.length}</span></div>
          {suggest.map((u) => (
            <div key={`${u.project_id}/${u.item_id}`} className="td-lrow" data-c={pmap[u.project_id]?.color}>
              <i className="dot" />
              <span className="tt"><Link href={`/p/${u.project_id}`}>{u.title}</Link><small>{pmap[u.project_id]?.name}{u.reason ? ` · ${u.reason}` : ""}</small></span>
              <span /><span className="sacts"><button className="btn ghost sm" onClick={() => onPull({ project_id: u.project_id, id: u.item_id })}>{add}</button></span>
            </div>
          ))}
        </div>
      )}
      <div className="td-grp">
        <div className="bgroup"><span className="lbl">Coming up</span><span className="ct">{coming.length}</span><span className="hint">in progress, or due in the next two weeks</span></div>
        {coming.length > 0 && projects.some((p) => coming.some((i) => i.project_id === p.id)) && (
          <div className="chips td-chips" role="group" aria-label="Filter by project">
            <button className="chip" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>All</button>
            {projects.filter((p) => coming.some((i) => i.project_id === p.id)).map((p) => <button key={p.id} className="chip" aria-pressed={filter === p.id} onClick={() => setFilter(p.id)} data-c={p.color}><i className="dot" /> {p.name}</button>)}
          </div>
        )}
        {(all ? shown : shown.slice(0, 8)).map((i) => line(i, <button className="btn ghost sm" onClick={() => onPull(i)}>{add}</button>))}
        {shown.length > 8 && <button className="td-more" onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show all ${shown.length}`}</button>}
        {!coming.length && <div className="empty">Nothing due in the next two weeks.</div>}
      </div>
      <div className="td-grp">
        <div className="bgroup"><span className="lbl">Someday</span><span className="ct">{someday.length}</span><span className="hint">todos without a day</span></div>
        {someday.map((t) => (
          <div key={t.id} className="td-lrow" data-c={t.project_id ? pmap[t.project_id]?.color : "life"}>
            <i className="dot" /><span className="tt"><span>{t.title}</span><small>{t.project_id ? pmap[t.project_id]?.name : "Personal"}</small></span><span />
            <span className="sacts"><button className="btn ghost sm" onClick={() => onTodo(t)}>{add}</button><button className="btn ghost sm" aria-label={`Delete ${t.title}`} onClick={() => onDelete(t)}>×</button></span>
          </div>
        ))}
        {!someday.length && <div className="empty">Use ↓ on a todo to park it here.</div>}
      </div>
    </div>
  );
}

/** "N tasks are waiting": late work the morning roll-forward couldn't fit, so it doesn't slip out of sight. */
function WaitingLine({ w, pmap }: { w: Waiting; pmap: Record<string, P> }) {
  const crit = w.tasks.filter((t) => t.critical).length;
  return (
    <details className="td-waiting" data-track-section="Waiting">
      <summary>
        <b>{w.count} late {w.count === 1 ? "task is" : "tasks are"} waiting</b>
        {crit > 0 && <> · {crit} critical</>}
        {" · "}{w.full && w.load ? `this morning today was already at ${w.load.before} of ${w.load.cap} focus min` : "this morning's carry-over cap was reached"}
      </summary>
      <p>Finish or move something on today&apos;s list to make room; tomorrow morning they come first. A task waiting with no room is never pushed into an over-full day.</p>
      <ul>
        {w.tasks.slice(0, 15).map((t, i) => {
          const pid = t.key?.split("/")[0], p = pid ? pmap[pid] : undefined;
          return (
            <li key={i}>
              {t.critical && <span className="due late">critical</span>}
              <span className="ti">{t.title}</span>
              <small>{p ? <Link href={`/p/${p.id}`}>{p.name}{t.key ? ` · ${t.key.split("/")[1]}` : ""}</Link> : null} · {lateLabel(t.overdue)}</small>
            </li>
          );
        })}
      </ul>
      {w.count > 15 && <p>And {w.count - 15} more. Run <code>node agent/rollover.mjs --dry-run</code> on the Mac for the full list.</p>}
    </details>
  );
}
