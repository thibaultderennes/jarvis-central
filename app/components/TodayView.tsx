"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { DndContext, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { createTodo, placeTodo, removeTodo, setDue, setItemStatus, toggleTodo } from "@/lib/actions";
import type { Todo } from "@/lib/data";
import type { CalEvent } from "@/lib/calendar";
import { EditTitle, type BItem } from "./Board";
import { Ack, imeGuard, useSubmit } from "./Submit";

type P = { id: string; name: string; color: string };
type Block = { project_id: string; item_id: string; title: string; start: string; end: string };
type Props = {
  day: string; today: string; label: string; dateLine: string; prev: { d: string; l: string }; next: { d: string; l: string };
  todos: Todo[]; events: CalEvent[]; calendarOn: boolean; calendarError?: string; backlog: BItem[]; due: BItem[];
  projects: P[]; nowTime: string; capMinutes: number; blocks: Block[]; unplanned: { project_id: string; item_id: string; title: string; reason: string }[];
};
const DEFAULT_EST = 60;
const addDays = (d: string, n: number) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const fmt = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("en-CA", { timeZone: "UTC", month: "short", day: "numeric" });
const hours = (m: number) => (m >= 60 ? `${Math.round(m / 30) / 2} h` : `${m} min`);
const key = (i: { project_id: string; id: string }) => `${i.project_id}/${i.id}`;
const tkey = (t: Todo) => (t.project_id && t.item_id ? `${t.project_id}/${t.item_id}` : null);
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
  useEffect(() => setHandled(new Set()), [props.backlog, props.due]);
  const [, start] = useTransition();
  const [msg, setMsg] = useState("");
  const run = (fn: () => Promise<unknown>) => start(async () => { try { setMsg(""); await fn(); } catch { setMsg("Couldn't save that. Check your connection and try again."); setTodos(props.todos); } });
  const hide = (k: string) => setHandled((s) => new Set(s).add(k));

  const list = todos.filter((t) => t.date === day).sort(byOrder);
  const open = list.filter((t) => !t.done), done = list.filter((t) => t.done);
  const someday = todos.filter((t) => !t.date && !t.done).sort(byOrder);
  const onList = new Set(list.map(tkey).filter(Boolean) as string[]);
  const dueHere = props.due.filter((i) => i.due === day && !onList.has(key(i)) && !handled.has(key(i)));
  const dueOpen = dueHere.filter((i) => i.status !== "done").sort((a, b) => Number(b.critical) - Number(a.critical));
  const backlog = props.backlog.filter((i) => !handled.has(key(i)) && !onList.has(key(i)) && i.due !== day);
  const overdue = backlog.filter((i) => i.due && i.due < today).sort((a, b) => Number(b.critical) - Number(a.critical) || a.due!.localeCompare(b.due!));
  const coming = backlog.filter((i) => !(i.due && i.due < today));
  const suggest = props.unplanned.filter((u) => !onList.has(`${u.project_id}/${u.item_id}`) && !handled.has(`${u.project_id}/${u.item_id}`));
  const lateTodo = (t: Todo) => { const k = tkey(t); const i = k ? props.backlog.find((x) => key(x) === k) : null; return !!i?.due && i.due < today; };

  // Load: undone todos linked to items weigh the item's estimate; open items due here and not on the list weigh theirs.
  const est = useMemo(() => { const m = new Map<string, number>(); for (const i of [...props.backlog, ...props.due]) m.set(key(i), i.estimate_minutes || DEFAULT_EST); return m; }, [props.backlog, props.due]);
  const seen = new Set<string>(); let load = 0;
  for (const t of open) { const k = tkey(t); if (k && !seen.has(k)) { seen.add(k); load += est.get(k) || DEFAULT_EST; } }
  for (const i of dueOpen) if (!seen.has(key(i))) { seen.add(key(i)); load += i.estimate_minutes || DEFAULT_EST; }
  const total = list.length + dueHere.length, nDone = done.length + dueHere.filter((i) => i.status === "done").length;

  const toggle = (t: Todo) => { setTodos((xs) => xs.map((x) => (x.id === t.id ? { ...x, done: !x.done } : x))); run(() => toggleTodo(t.id)); };
  const move = (t: Todo, date: string | null) => { setTodos((xs) => xs.map((x) => (x.id === t.id ? { ...x, date, sort: 1e9 } : x))); run(() => placeTodo(t.id, date, [])); };
  const del = (t: Todo) => { setTodos((xs) => xs.filter((x) => x.id !== t.id)); run(() => removeTodo(t.id)); };
  const reorder = (ids: string[]) => {
    const order = [...ids, ...done.map((t) => t.id)];
    setTodos((xs) => xs.map((x) => (order.includes(x.id) ? { ...x, sort: order.indexOf(x.id) + 1 } : x)));
    run(() => placeTodo(ids[0], day, order));
  };
  const nudge = (t: Todo, dir: -1 | 1) => { const ids = open.map((x) => x.id), i = ids.indexOf(t.id), j = i + dir; if (j < 0 || j >= ids.length) return; reorder(arrayMove(ids, i, j)); };
  const pull = (it: { project_id: string; id: string; title: string }) => {
    hide(key(it));
    setTodos((xs) => [...xs, { id: `tmp-${Date.now()}`, date: day, title: it.title, kind: "work", project_id: it.project_id, item_id: it.id, time: null, sort: 1e9, done: false, done_at: null, created_at: "" }]);
    run(() => createTodo({ date: day, title: it.title, project_id: it.project_id, item_id: it.id, kind: "work" })); };
  const finish = (it: BItem) => { hide(key(it)); run(() => setItemStatus(it.project_id, it.id, "done")); };
  const shift = (it: BItem, date: string) => { hide(key(it)); run(() => setDue(it.project_id, it.id, date)); };

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
          <h1 className="page">{props.label}</h1>
          {isToday && <span className="td-date">{props.dateLine}</span>}
        </div>
        <nav className="daynav" aria-label="Change day">
          <Link href={`/today?d=${props.prev.d}`} aria-label="Previous day">‹ {props.prev.l}</Link>
          {!isToday && <Link href="/today">Today</Link>}
          <Link href={`/today?d=${props.next.d}`} aria-label="Next day">{props.next.l} ›</Link>
        </nav>
        <div className="td-stats">
          <span className="td-prog"><b>{nDone}</b> of {total} done</span>
          <span className={`td-load${over ? " over" : ""}`} title={`Work left, from the estimates of the linked checklist items (${DEFAULT_EST} min when unknown), against ${hours(capMinutes)} of focus a day`}>
            <span className="td-bar" aria-hidden="true"><i style={{ width: `${Math.min(100, (load / capMinutes) * 100)}%` }} /></span>
            ~{hours(load)} of {hours(capMinutes)} focus{over ? ` · over by ${hours(load - capMinutes)}` : ""}
          </span>
        </div>
      </header>
      {msg && <div className="due late" role="alert">{msg}</div>}

      <div className="td-grid">
        <section className="panel td-main" aria-label={`${props.label}'s list`}>
          <QuickAdd day={day} projects={projects} />
          <DndContext id="jarvis-today" sensors={sensors} collisionDetection={closestCenter} onDragEnd={onEnd}>
            <SortableContext items={open.map((t) => t.id)} strategy={verticalListSortingStrategy}>
              <ol className="td-list">
                {open.map((t, i) => (
                  <Row key={t.id} t={t} p={t.project_id ? pmap[t.project_id] : undefined} next={i === 0} late={lateTodo(t)} est={tkey(t) ? est.get(tkey(t)!) : undefined}
                    onToggle={() => toggle(t)} onTomorrow={() => move(t, tom)} onDate={(d) => move(t, d)} onSomeday={() => move(t, null)} onDelete={() => del(t)} onNudge={(d) => nudge(t, d)} />
                ))}
                {dueOpen.map((i, n) => <ItemRow key={key(i)} it={i} p={pmap[i.project_id]} next={!open.length && n === 0} today={today} onDone={() => finish(i)} onTomorrow={() => shift(i, tom)} />)}
              </ol>
            </SortableContext>
          </DndContext>
          {!open.length && !dueOpen.length && (
            <div className="empty td-empty">{list.length ? "All done for the day." : `Nothing on ${isToday ? "today" : "this day"} yet. Type above and press Enter, or pull something in from Later.`}</div>
          )}
          {done.length > 0 && (
            <details className="td-done">
              <summary>Done <span className="ct">{done.length}</span></summary>
              <ol className="td-list">{done.map((t) => <Row key={t.id} t={t} p={t.project_id ? pmap[t.project_id] : undefined} next={false} late={false} onToggle={() => toggle(t)} onDelete={() => del(t)} />)}</ol>
            </details>
          )}
        </section>

        <Agenda events={evs} todos={list} blocks={props.blocks} on={props.calendarOn} error={props.calendarError} nowM={nowM} pmap={pmap} nextEv={nextEv} />

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

function Row({ t, p, next, late, est, onToggle, onTomorrow, onDate, onSomeday, onDelete, onNudge }: {
  t: Todo; p?: P; next: boolean; late: boolean; est?: number; onToggle: () => void; onTomorrow?: () => void; onDate?: (d: string) => void; onSomeday?: () => void; onDelete: () => void; onNudge?: (d: -1 | 1) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: t.id, disabled: t.done });
  const [editing, setEditing] = useState(false), [menu, setMenu] = useState(false);
  const tmp = t.id.startsWith("tmp-");
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} data-c={p?.color || (t.kind === "work" ? "other" : "life")}
      className={`td-row${next ? " next" : ""}${menu ? " menu" : ""}${t.done ? " done" : ""}${late && !t.done ? " late" : ""}${isDragging ? " dragging" : ""}`}
      onKeyDown={(e) => { if (onNudge && e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown") && !(e.target as HTMLElement).matches("input")) { e.preventDefault(); onNudge(e.key === "ArrowUp" ? -1 : 1); } }}>
      {t.done ? <span /> : <button className="grip" aria-label={`Reorder ${t.title} (drag, or Alt+↑/↓)`} {...attributes} {...listeners}>⠿</button>}
      <button className="ck" aria-label={`${t.done ? "Mark not done" : "Mark done"}: ${t.title}`} disabled={tmp} onClick={onToggle}>✓</button>
      <span className="tt" onDoubleClick={() => !tmp && setEditing(true)}>
        {next && <span className="td-tag">Next up</span>}
        {editing ? <EditTitle t={t} onDone={() => setEditing(false)} /> : <span className="ti">{t.title}</span>}
        <small>
          {t.time && <span className="tm">{t.time}</span>}
          {p ? <Link href={`/p/${p.id}`}>{p.name}{t.item_id ? ` · ${t.item_id}` : ""}</Link> : t.kind === "life" ? "Personal" : null}
          {est ? <span>~{hours(est)}</span> : null}
          {late && !t.done && <b className="latetag">overdue</b>}
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

/** A checklist item due this day that isn't on the list as a todo. */
function ItemRow({ it, p, next, today, onDone, onTomorrow }: { it: BItem; p?: P; next: boolean; today: string; onDone: () => void; onTomorrow: () => void }) {
  return (
    <li className={`td-row item${next ? " next" : ""}${it.critical ? " crit" : ""}`} data-c={p?.color}>
      <span className="grip" aria-hidden="true" />
      <button className="ck" aria-label={`Mark done: ${it.title}`} onClick={onDone}>✓</button>
      <span className="tt">
        {next && <span className="td-tag">Next up</span>}
        <span className="ti">{it.title}</span>
        <small><Link href={`/p/${it.project_id}`}>{p?.name} · {it.id}</Link><span>due {it.due === today ? "today" : fmt(it.due!)}</span>{it.critical && <b className="latetag">critical</b>}{it.estimate_minutes ? <span>~{hours(it.estimate_minutes)}</span> : null}{it.owner === "claude" && <span>Claude</span>}</small>
      </span>
      <span className="acts"><button title="Move its due date to the next day" aria-label={`Due the next day: ${it.title}`} onClick={onTomorrow}>→</button></span>
    </li>
  );
}

/** Enter adds. "14:00 call the bank" sets the time; time and project also sit behind "More". Text stays if the save fails. */
function QuickAdd({ day, projects }: { day: string; projects: P[] }) {
  const [title, setTitle] = useState(""), [time, setTime] = useState(""), [proj, setProj] = useState(""), [more, setMore] = useState(false);
  const s = useSubmit();
  return (
    <form className="td-add" onKeyDown={imeGuard} onSubmit={(e) => {
      e.preventDefault(); let v = title.trim(), tm = time; if (!v || s.pending) return;
      const m = /^([01]?\d|2[0-3])[:h]([0-5]\d)\s+(.+)$/.exec(v); if (m && !tm) { tm = `${m[1].padStart(2, "0")}:${m[2]}`; v = m[3]; }
      s.submit(async () => (await createTodo({ date: day, title: v, time: tm || null, project_id: proj || null, kind: proj ? "work" : "life" })) ?? { error: "Couldn't add that todo: check the title." },
        { ok: "Added", onOk: () => { setTitle(""); setTime(""); } });
    }}>
      <span className="plus" aria-hidden="true">+</span>
      <input id="qa-title-d" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a todo, Enter to save (“14:00 call the bank” sets a time)" aria-label="New todo" autoComplete="off" />
      <button type="button" className="btn ghost sm" aria-expanded={more} onClick={() => setMore(!more)}>{more ? "Less" : "More"}</button>
      <button className="btn sm" disabled={!title.trim() || s.pending}>{s.pending ? "Adding…" : "Add"}</button>
      {more && (
        <span className="td-opts">
          <input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Time (optional)" />
          <select className="select" value={proj} onChange={(e) => setProj(e.target.value)} aria-label="Personal or project">
            <option value="">Personal</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </span>
      )}
      <Ack s={s} busy="Adding…" />
    </form>
  );
}

const PX = 38; // pixels per hour on the agenda
function Agenda({ events, todos, blocks, on, error, nowM, pmap, nextEv }: { events: CalEvent[]; todos: Todo[]; blocks: Block[]; on: boolean; error?: string; nowM: number; pmap: Record<string, P>; nextEv?: CalEvent }) {
  const [open, setOpen] = useState(false);
  const allDay = events.filter((e) => e.allDay);
  const used = new Set<Block>();
  const entries = [
    ...events.filter((e) => !e.allDay && e.startTime).map((e) => ({ id: e.id, kind: "ev", title: e.title, s: mins(e.startTime!), e: e.endTime ? Math.max(mins(e.endTime), mins(e.startTime!) + 15) : mins(e.startTime!) + 30, c: undefined as string | undefined, done: false, sub: e.location })),
    ...todos.filter((t) => t.time).map((t) => {
      const b = blocks.find((x) => !used.has(x) && x.start === t.time && x.item_id === t.item_id); if (b) used.add(b);
      return { id: t.id, kind: "todo", title: t.title, s: mins(t.time!), e: b ? mins(b.end) : mins(t.time!) + 30, c: t.project_id ? pmap[t.project_id]?.color : "life", done: t.done, sub: "" };
    }),
  ].sort((a, b) => a.s - b.s || b.e - a.e);
  // Side-by-side lanes for overlaps.
  const lanes: number[] = [], placed = entries.map((x) => { let l = lanes.findIndex((end) => end <= x.s); if (l < 0) { l = lanes.length; lanes.push(0); } lanes[l] = x.e; return { ...x, lane: l }; });
  const cols = (x: (typeof placed)[number]) => Math.max(...placed.filter((y) => y.s < x.e && y.e > x.s).map((y) => y.lane)) + 1;
  const h0 = Math.min(8, ...entries.map((x) => Math.floor(x.s / 60))), h1 = Math.max(18, ...entries.map((x) => Math.ceil(x.e / 60)));
  const timed = entries.length;
  const summary = !on && !timed ? "Calendar not connected" : `${events.length} event${events.length === 1 ? "" : "s"} · ${todos.filter((t) => t.time).length} timed${nextEv ? ` · next ${nextEv.startTime}` : ""}`;
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
        {on && !error && !timed && !allDay.length && <div className="empty">Nothing on the calendar and no timed todos.</div>}
      </div>
    </section>
  );
}

function Later({ overdue, coming, someday, suggest, pmap, projects, today, isToday, onPull, onDone, onShift, onTodo, onDelete }: {
  overdue: BItem[]; coming: BItem[]; someday: Todo[]; suggest: Props["unplanned"]; pmap: Record<string, P>; projects: P[]; today: string; isToday: boolean;
  onPull: (it: { project_id: string; id: string; title: string }) => void; onDone: (it: BItem) => void; onShift: (it: BItem, d: string) => void; onTodo: (t: Todo) => void; onDelete: (t: Todo) => void;
}) {
  const [filter, setFilter] = useState("all"), [all, setAll] = useState(false);
  const add = isToday ? "+ Today" : "+ Day";
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
          <div className="bgroup"><span className="lbl">Overdue</span><span className="ct">{overdue.length}</span><span className="hint">finish, take on, or give a new day</span></div>
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
              <span /><span className="sacts"><button className="btn ghost sm" onClick={() => onPull({ project_id: u.project_id, id: u.item_id, title: u.title })}>{add}</button></span>
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
