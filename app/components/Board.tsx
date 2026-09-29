"use client";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, TouchSensor, pointerWithin, rectIntersection,
  useDraggable, useDroppable, useSensor, useSensors,
  type CollisionDetection, type DragEndEvent, type DragOverEvent, type DragStartEvent, type UniqueIdentifier,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { createTodo, editTodo, placeTodo, removeTodo, toggleTodo } from "@/lib/actions";
import type { Todo } from "@/lib/data";
import type { CalEvent } from "@/lib/calendar";

export type BItem = { project_id: string; id: string; title: string; due: string | null; status: string; critical: boolean; owner: string | null; secName: string };
type P = { id: string; name: string; color: string };
type Props = {
  mode: "day" | "week"; days: string[]; today: string; todos: Todo[]; events: CalEvent[]; calendarOn: boolean; calendarError?: string;
  backlog: BItem[]; due: BItem[]; projects: P[]; nowTime: string;
};
const SOMEDAY = "someday";
const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const wd = (d: string) => (new Date(d + "T12:00:00Z").getUTCDay() + 6) % 7;
const addDays = (d: string, n: number) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const fmt = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("en-CA", { timeZone: "UTC", month: "short", day: "numeric" });

function build(todos: Todo[], days: string[]) {
  const l: Record<string, Todo[]> = { [SOMEDAY]: [] };
  for (const d of days) l[d] = [];
  for (const t of todos) { const k = t.date ?? SOMEDAY; if (l[k]) l[k].push(t); }
  for (const k of Object.keys(l)) l[k].sort((a, b) => a.sort - b.sort);
  return l;
}

export default function Board(props: Props) {
  const { mode, days, today, projects } = props;
  const pmap = useMemo(() => Object.fromEntries(projects.map((p) => [p.id, p])), [projects]);
  const [lists, setLists] = useState(() => build(props.todos, days));
  const listsRef = useRef(lists); listsRef.current = lists;
  useEffect(() => { setLists(build(props.todos, days)); }, [props.todos, days]);
  const [active, setActive] = useState<{ kind: "todo"; todo: Todo } | { kind: "item"; item: BItem } | null>(null);
  const [, start] = useTransition();
  const [msg, setMsg] = useState("");
  const [filter, setFilter] = useState<string>("all");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const collide: CollisionDetection = (args) => { const p = pointerWithin(args); return p.length ? p : rectIntersection(args); };
  const findC = (id: UniqueIdentifier | undefined) => {
    if (id == null) return null;
    const s = String(id);
    if (s in listsRef.current) return s;
    return Object.keys(listsRef.current).find((k) => listsRef.current[k].some((t) => t.id === s)) || null;
  };
  const run = (fn: () => Promise<unknown>) => start(async () => { try { setMsg(""); await fn(); } catch { setMsg("Couldn't save that. Check your connection and try again."); } });
  const dateOf = (c: string) => (c === SOMEDAY ? null : c);

  function onStart(e: DragStartEvent) {
    const d = e.active.data.current as { kind: string; todo?: Todo; item?: BItem };
    setActive(d.kind === "item" ? { kind: "item", item: d.item! } : { kind: "todo", todo: d.todo! });
  }
  function onOver(e: DragOverEvent) {
    if (active?.kind !== "todo" || !e.over) return;
    const from = findC(e.active.id), to = findC(e.over.id);
    if (!from || !to || from === to) return;
    setLists((prev) => {
      const a = [...prev[from]], b = [...prev[to]];
      const i = a.findIndex((x) => x.id === e.active.id); if (i < 0) return prev;
      const [m] = a.splice(i, 1);
      let j = b.findIndex((x) => x.id === e.over!.id); if (j < 0) j = b.length;
      b.splice(j, 0, { ...m, date: dateOf(to) });
      return { ...prev, [from]: a, [to]: b };
    });
  }
  function onEnd(e: DragEndEvent) {
    const a = active; setActive(null);
    const to = findC(e.over?.id);
    if (!a || !to) return;
    if (a.kind === "todo") {
      let list = listsRef.current[to];
      const oi = list.findIndex((x) => x.id === e.active.id), ni = list.findIndex((x) => x.id === e.over!.id);
      if (oi >= 0 && ni >= 0 && oi !== ni) { list = arrayMove(list, oi, ni); setLists((p) => ({ ...p, [to]: list })); }
      run(() => placeTodo(String(e.active.id), dateOf(to), list.map((x) => x.id)));
    } else {
      addFromItem(a.item, to, e.over?.id);
    }
  }
  function addFromItem(it: BItem, to: string, overId?: UniqueIdentifier) {
    const date = dateOf(to);
    const tmp: Todo = { id: `tmp-${Date.now()}`, date, title: it.title, kind: "work", project_id: it.project_id, item_id: it.id, time: null, sort: 1e9, done: false, done_at: null, created_at: "" };
    const list = [...listsRef.current[to]];
    let j = list.findIndex((x) => x.id === overId); if (j < 0) j = list.length;
    list.splice(j, 0, tmp);
    setLists((p) => ({ ...p, [to]: list }));
    run(async () => {
      const t = await createTodo({ date, title: it.title, project_id: it.project_id, item_id: it.id, kind: "work" });
      if (t && j < list.length - 1) await placeTodo(t.id, date, list.map((x) => (x.id === tmp.id ? t.id : x.id)));
    });
  }

  const planned = useMemo(() => new Set(Object.values(lists).flat().filter((t) => t.item_id).map((t) => `${t.project_id}/${t.item_id}`)), [lists]);
  const backlog = props.backlog.filter((i) => filter === "all" || i.project_id === filter);
  const groups = [
    { name: "Overdue", items: backlog.filter((i) => i.due && i.due < today) },
    { name: "Due today", items: backlog.filter((i) => i.due === today) },
    { name: "In progress", items: backlog.filter((i) => i.status === "doing" && !(i.due && i.due <= today)) },
    { name: "Next 7 days", items: backlog.filter((i) => i.status !== "doing" && i.due && i.due > today && i.due <= addDays(today, 7)) },
    { name: "Next 14 days", items: backlog.filter((i) => i.status !== "doing" && i.due && i.due > addDays(today, 7)) },
  ];
  const target = mode === "day" ? days[0] : days.includes(today) ? today : days[0];

  const backlogPanel = (
    <section className="panel" aria-labelledby="h-backlog">
      <div className="ph">
        <h2 className="ph-t" id="h-backlog">Backlog</h2><span className="sp" />
        <span className="hint">Drag onto a day, or tap +</span>
      </div>
      <div className="quick" style={{ borderBottom: "1px solid var(--line-2)" }}>
        <div className="chips" role="group" aria-label="Filter backlog by project">
          <button className="chip" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>All</button>
          {projects.filter((p) => props.backlog.some((i) => i.project_id === p.id)).map((p) => (
            <button key={p.id} className="chip" aria-pressed={filter === p.id} onClick={() => setFilter(p.id)} data-c={p.color}><i className="dot" /> {p.name}</button>
          ))}
        </div>
      </div>
      <div>
        {groups.map((g) => g.items.length > 0 && (
          <div key={g.name}>
            <div className="bgroup"><span className="lbl">{g.name}</span><span className="ct">{g.items.length}</span></div>
            {g.items.slice(0, 30).map((i) => (
              <BacklogRow key={`${i.project_id}/${i.id}`} it={i} p={pmap[i.project_id]} today={today} planned={planned.has(`${i.project_id}/${i.id}`)}
                onAdd={() => addFromItem(i, target)} addLabel={mode === "day" ? "+ Day" : `+ ${WD[wd(target)]}`} />
            ))}
          </div>
        ))}
        {!backlog.length && <div className="empty">Nothing open with a due date in the next two weeks.</div>}
      </div>
      <div className="ph" style={{ borderTop: "1px solid var(--line-2)" }}><h2 className="ph-t">Someday</h2><span className="sp" /><span className="hint">Undated todos</span></div>
      <Zone id={SOMEDAY}>
        <SortableContext items={lists[SOMEDAY].map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {lists[SOMEDAY].map((t) => <TodoRow key={t.id} t={t} c={SOMEDAY} p={t.project_id ? pmap[t.project_id] : undefined} run={run} compact={false} mode={mode} today={today} />)}
        </SortableContext>
        {!lists[SOMEDAY].length && <div className="empty" style={{ padding: 4 }}>Drop things here that have no day yet.</div>}
      </Zone>
    </section>
  );

  return (
    <DndContext id="jarvis-board" sensors={sensors} collisionDetection={collide} onDragStart={onStart} onDragOver={onOver} onDragEnd={onEnd} onDragCancel={() => { setActive(null); setLists(build(props.todos, days)); }}>
      {msg && <div className="due late" role="alert">{msg}</div>}
      {mode === "day" ? (
        <div className="board day">
          <section className="panel" aria-labelledby="h-cal">
            <div className="ph"><h2 className="ph-t" id="h-cal">Calendar</h2><span className="sp" /><span className="hint">{props.calendarOn ? "Google Calendar" : ""}</span></div>
            <Events events={props.events.filter((e) => e.date === days[0])} on={props.calendarOn} error={props.calendarError} nowTime={days[0] === today ? props.nowTime : days[0] < today ? "99:99" : ""} />
          </section>
          <section className="panel" aria-labelledby="h-list">
            <div className="ph"><h2 className="ph-t" id="h-list">{days[0] === today ? "Today" : fmt(days[0])}</h2><span className="sp" />
              <span className="hint">{lists[days[0]].filter((t) => t.done).length}/{lists[days[0]].length} done</span></div>
            <QuickAdd date={days[0]} projects={projects} run={run} />
            <Zone id={days[0]}>
              <SortableContext items={lists[days[0]].map((t) => t.id)} strategy={verticalListSortingStrategy}>
                {lists[days[0]].map((t) => <TodoRow key={t.id} t={t} c={days[0]} p={t.project_id ? pmap[t.project_id] : undefined} run={run} compact={false} mode={mode} today={today} />)}
              </SortableContext>
              {!lists[days[0]].length && <div className="empty" style={{ padding: 4 }}>Add personal todos above, or drag work in from the backlog.</div>}
            </Zone>
          </section>
          {backlogPanel}
        </div>
      ) : (
        <div className="board week">
          <section className="panel">
            <QuickAdd date={target} projects={projects} run={run} days={days} />
            <div className="week7">
              {days.map((d) => {
                const evs = props.events.filter((e) => e.date === d), due = props.due.filter((i) => i.due === d);
                const load = lists[d].filter((t) => !t.done).length + due.filter((i) => i.status !== "done").length + evs.filter((e) => !e.allDay).length;
                return (
                  <div key={d} className={`wday${d === today ? " today" : d < today ? " past" : ""}`}>
                    <div className="wdh"><span className="wd">{WD[wd(d)]}</span><Link className="dn" href={`/today?d=${d}`}>{Number(d.slice(8))}</Link>{load > 0 && <span className="ld">{load}</span>}</div>
                    {evs.map((e) => <div key={e.id} className={`wev${e.allDay ? " allday" : ""}`}><span className="tm">{e.allDay ? "all day" : e.startTime}</span><span>{e.title}</span></div>)}
                    {due.map((i) => (
                      <div key={i.id} className={`wdue${i.status === "done" ? " done" : ""}`} data-c={pmap[i.project_id]?.color} title={`${pmap[i.project_id]?.name} · ${i.secName} · due`}>
                        <i className="sq" /><span>{i.title}</span>
                      </div>
                    ))}
                    <Zone id={d}>
                      <SortableContext items={lists[d].map((t) => t.id)} strategy={verticalListSortingStrategy}>
                        {lists[d].map((t) => <TodoRow key={t.id} t={t} c={d} p={t.project_id ? pmap[t.project_id] : undefined} run={run} compact mode={mode} today={today} />)}
                      </SortableContext>
                    </Zone>
                  </div>
                );
              })}
            </div>
            <div className="legend" style={{ paddingTop: 10, borderTop: "1px solid var(--line-2)" }}>
              <span><i className="dot" style={{ background: "var(--doing-soft)", border: "1px solid var(--doing)" }} />Calendar event</span>
              {projects.map((p) => <span key={p.id}><i className="dot" data-c={p.color} />{p.name} due</span>)}
              <span><i className="dot" data-c="life" />Personal todo</span>
            </div>
          </section>
          {backlogPanel}
        </div>
      )}
      <DragOverlay dropAnimation={null}>
        {active?.kind === "todo" && <div className="todo overlay" data-c={active.todo.project_id ? pmap[active.todo.project_id]?.color : "life"}><span className="grip">⠿</span><span /><span className="tt"><span>{active.todo.title}</span></span><span /></div>}
        {active?.kind === "item" && <div className="todo overlay" data-c={pmap[active.item.project_id]?.color}><span className="grip">⠿</span><span /><span className="tt"><span>{active.item.title}</span><small>{pmap[active.item.project_id]?.name}</small></span><span /></div>}
      </DragOverlay>
    </DndContext>
  );
}

function Zone({ id, children }: { id: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return <div ref={setNodeRef} className={`dropzone${isOver ? " over" : ""}`}>{children}</div>;
}

function TodoRow({ t, c, p, run, compact, mode, today }: { t: Todo; c: string; p?: P; run: (fn: () => Promise<unknown>) => void; compact: boolean; mode: string; today: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: t.id, data: { kind: "todo", todo: t, c } });
  const tmp = t.id.startsWith("tmp-");
  const [editing, setEditing] = useState(false);
  const style = { transform: CSS.Transform.toString(transform), transition };
  const color = p?.color || (t.kind === "work" ? "other" : "life");
  const body = (
    <span className="tt" onDoubleClick={() => !tmp && setEditing(true)}>
      {editing ? (
        <input className="input" defaultValue={t.title} autoFocus aria-label="Edit todo"
          onBlur={(e) => { setEditing(false); if (e.target.value.trim() && e.target.value !== t.title) run(() => editTodo(t.id, { title: e.target.value })); }}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditing(false); }} />
      ) : <span>{t.time && <span className="tm">{t.time} </span>}{t.title}</span>}
      {!compact && (p || t.kind === "life") && <small>{p ? `${p.name}${t.item_id ? ` · ${t.item_id}` : ""}` : "Personal"}</small>}
    </span>
  );
  return (
    <div ref={setNodeRef} style={style} className={`todo${t.done ? " done" : ""}${isDragging ? " dragging" : ""}`} data-c={color}
      {...(compact ? { ...attributes, ...listeners } : {})}>
      {!compact && <button className="grip" aria-label={`Move ${t.title}`} {...attributes} {...listeners}>⠿</button>}
      <button className="ck" aria-label={`${t.done ? "Mark not done" : "Mark done"}: ${t.title}`} disabled={tmp} onClick={() => run(() => toggleTodo(t.id))} onPointerDown={(e) => e.stopPropagation()}>✓</button>
      {body}
      <span className="acts" onPointerDown={(e) => e.stopPropagation()}>
        {!compact && mode === "day" && c !== SOMEDAY && <button title="Move to the next day" onClick={() => run(() => placeTodo(t.id, addDays(c, 1), []))} disabled={tmp}>→</button>}
        {!compact && c !== SOMEDAY && <button title="Move to someday" onClick={() => run(() => placeTodo(t.id, null, []))} disabled={tmp}>↓</button>}
        {!compact && c === SOMEDAY && <button title="Move to today" onClick={() => run(() => placeTodo(t.id, today, []))} disabled={tmp}>↑</button>}
        <button title="Delete" aria-label={`Delete ${t.title}`} onClick={() => run(() => removeTodo(t.id))} disabled={tmp}>×</button>
      </span>
    </div>
  );
}

function BacklogRow({ it, p, today, planned, onAdd, addLabel }: { it: BItem; p?: P; today: string; planned: boolean; onAdd: () => void; addLabel: string }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `item:${it.project_id}/${it.id}`, data: { kind: "item", item: it } });
  const late = it.due && it.due < today;
  return (
    <div ref={setNodeRef} className={`bl${planned ? " planned" : ""}`} data-c={p?.color} style={{ opacity: isDragging ? 0.4 : undefined }}>
      <button className="grip" aria-label={`Drag ${it.title} onto a day`} {...attributes} {...listeners}>⠿</button>
      <i className="dot" />
      <span className="tt"><span title={it.title}>{it.title}</span><small>{p?.name} · {it.secName} · {it.id}{it.owner === "claude" ? " · Claude" : ""}{it.critical ? " · critical" : ""}{planned ? " · planned" : ""}</small></span>
      <span className={`due${late ? " late" : ""}`}>{it.due ? fmt(it.due) : ""}</span>
      <button className="add" onClick={onAdd} aria-label={`Add ${it.title} to the day`}>{addLabel}</button>
    </div>
  );
}

function QuickAdd({ date, projects, run, days }: { date: string; projects: P[]; run: (fn: () => Promise<unknown>) => void; days?: string[] }) {
  const [title, setTitle] = useState(""), [time, setTime] = useState(""), [proj, setProj] = useState(""), [day, setDay] = useState(date);
  useEffect(() => setDay(date), [date]);
  return (
    <form className="quick" onSubmit={(e) => {
      e.preventDefault(); const v = title.trim(); if (!v) return;
      setTitle(""); setTime("");
      run(() => createTodo({ date: day, title: v, time: time || null, project_id: proj || null, kind: proj ? "work" : "life" }));
    }}>
      <input id={`qa-title-${days ? "w" : "d"}`} className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={days ? "Add a todo to the week…" : "Add a todo: groceries, gym, call the bank…"} aria-label="New todo" />
      {days && (
        <select className="select" value={day} onChange={(e) => setDay(e.target.value)} aria-label="Day">
          {days.map((d) => <option key={d} value={d}>{WD[wd(d)]} {Number(d.slice(8))}</option>)}
        </select>
      )}
      <input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Time (optional)" style={{ width: 108 }} />
      <select className="select" value={proj} onChange={(e) => setProj(e.target.value)} aria-label="Personal or project">
        <option value="">Personal</option>
        {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <button className="btn">Add</button>
    </form>
  );
}

function Events({ events, on, error, nowTime }: { events: CalEvent[]; on: boolean; error?: string; nowTime: string }) {
  if (!on) return <div className="empty">Google Calendar isn't connected yet. Add your calendar's secret iCal address to the site settings (see the setup notes) and your appointments show here.</div>;
  if (error) return <div className="empty">Couldn't read your calendar just now ({error}). It retries every 5 minutes.</div>;
  if (!events.length) return <div className="empty">Nothing on the calendar.</div>;
  return (
    <div className="events">
      {events.map((e) => {
        const past = !e.allDay && nowTime && (e.endTime || "24:00") <= nowTime;
        const now = !e.allDay && nowTime && (e.startTime || "00:00") <= nowTime && (e.endTime || "24:00") > nowTime;
        return (
          <div key={e.id} className={`ev${past ? " past" : ""}${now ? " now" : ""}`}>
            <span className="tm">{e.allDay ? "all day" : `${e.startTime || ""}${e.endTime ? `–${e.endTime}` : ""}`}</span>
            <span>{e.title}{e.location && <small>{e.location}</small>}</span>
          </div>
        );
      })}
    </div>
  );
}
