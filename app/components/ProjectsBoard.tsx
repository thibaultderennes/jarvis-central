"use client";
import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { featureProject } from "@/lib/actions";

export type Card = {
  id: string; name: string; color: string; tagline: string; kind: string; state: string; status: string;
  done: number; doing: number; late: number; total: number;
  next: { id: string; title: string; due: string }[];
  verdict: string | null; deadline: { date: string; label: string; days: number } | null;
  plan_enabled: boolean; weekly_minutes: number | null; reviews_enabled: boolean;
  /** Next milestone vs current pace (Home); omitted = not shown. */
  pace?: { text: string; risk: boolean } | null;
};

const fmt = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("en-CA", { timeZone: "UTC", month: "short", day: "numeric" });
const hours = (m: number) => (m % 60 ? `${(m / 60).toFixed(1)} h` : `${m / 60} h`);

/** Overview projects: the top 3 as full cards (drop targets), the rest as compact cards you drag onto a top-3 card to swap. */
export default function ProjectsBoard({ featured, others, today }: { featured: Card[]; others: Card[]; today: string }) {
  const [top, setTop] = useState(featured), [rest, setRest] = useState(others);
  useEffect(() => { setTop(featured); setRest(others); }, [featured, others]);
  const [dragging, setDragging] = useState<Card | null>(null);
  const [, start] = useTransition();
  const [err, setErr] = useState("");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }), useSensor(KeyboardSensor));

  const place = (id: string, slot: number) => {
    const all = [...top, ...rest], card = all.find((c) => c.id === id);
    if (!card) return;
    const t = [...top], from = t.findIndex((c) => c.id === id);
    let r = rest.filter((c) => c.id !== id);
    if (from >= 0) { const o = t[slot - 1]; t[slot - 1] = card; if (o) t[from] = o; }
    else { const out = t[slot - 1]; t[slot - 1] = card; if (out) r = [out, ...r]; }
    setTop(t.filter(Boolean)); setRest(r);
    start(async () => { try { setErr(""); await featureProject(id, slot); } catch { setErr("Couldn't move that project. Try again."); setTop(featured); setRest(others); } });
  };
  const onEnd = (e: DragEndEvent) => {
    setDragging(null);
    const over = e.over?.id ? String(e.over.id) : "";
    if (over.startsWith("slot-")) place(String(e.active.id), Number(over.slice(5)));
  };

  return (
    <DndContext id="projects-board" sensors={sensors} onDragStart={(e) => setDragging([...top, ...rest].find((c) => c.id === e.active.id) || null)} onDragEnd={onEnd} onDragCancel={() => setDragging(null)}>
      {err && <div className="due late" role="alert">{err}</div>}
      <div className="grid3">
        {[0, 1, 2].map((i) => <Slot key={i} slot={i + 1} card={top[i]} today={today} />)}
      </div>
      {rest.length > 0 && (
        <>
          <div className="lbl" style={{ marginTop: 6 }}>Other projects · drag one onto a card above to swap it into your top 3</div>
          <div className="minis">
            {rest.map((c) => <Mini key={c.id} c={c} />)}
          </div>
        </>
      )}
      <DragOverlay dropAnimation={null}>
        {dragging && <div className="panel mini overlay" data-c={dragging.color}><div className="h"><i className="dot" /><b>{dragging.name}</b></div></div>}
      </DragOverlay>
    </DndContext>
  );
}

function Slot({ slot, card, today }: { slot: number; card?: Card; today: string }) {
  const { setNodeRef, isOver } = useDroppable({ id: `slot-${slot}` });
  if (!card) return <div ref={setNodeRef} className={`panel proj emptyslot${isOver ? " over" : ""}`}>Drop a project here</div>;
  return <div ref={setNodeRef} className={isOver ? "slotwrap over" : "slotwrap"}><Full c={card} today={today} /></div>;
}

function Grip({ id, label }: { id: string; label: string }) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id });
  return <button ref={setNodeRef} className="grip" aria-label={`Move ${label}`} title="Drag to swap" {...attributes} {...listeners}>⠿</button>;
}

function Full({ c, today }: { c: Card; today: string }) {
  const n = c.total || 1;
  return (
    <article className="panel proj" data-c={c.color}>
      <div className="nm">
        <i className="dot" /><Link href={`/p/${c.id}`}><b>{c.name}</b></Link>
        {c.verdict && <span className={`verdict v-${c.verdict}`}>{c.verdict.replace("-", " ")}</span>}
        <span className="pct">{c.total ? `${Math.round((c.done / n) * 100)}%` : ""}</span>
        <Grip id={c.id} label={c.name} />
      </div>
      <p className="tag">{c.tagline || c.status}</p>
      {c.total > 0 ? (
        <>
          <div className="seg" role="img" aria-label={`${c.done} done, ${c.doing} in progress, ${c.late} overdue of ${c.total}`}>
            <i className="d" style={{ width: `${(c.done / n) * 100}%` }} /><i className="g" style={{ width: `${(c.doing / n) * 100}%` }} /><i className="l" style={{ width: `${(c.late / n) * 100}%` }} />
          </div>
          <div className="nums"><span><b>{c.done}</b> done</span><span><b>{c.doing}</b> in progress</span><span><b>{c.total - c.done - c.doing}</b> to do</span>{c.late > 0 && <span className="late"><b>{c.late}</b> overdue</span>}</div>
        </>
      ) : <div className="due">No checklist items yet — open the project to add some.</div>}
      {c.pace && <div className={`pace${c.pace.risk ? " risk" : ""}`}><b>{c.pace.risk ? "At risk" : "On pace"}</b> {c.pace.text}</div>}
      <div className="next">
        <span className="lbl">Next up</span>
        {c.next.map((i) => <div className="r" key={i.id}><span title={i.title}>{i.title}</span><span className={`due${i.due < today ? " late" : ""}`}>{fmt(i.due)}</span></div>)}
        {!c.next.length && <span className="due">Nothing open with a date</span>}
      </div>
      <div className="flags">
        <span className={c.plan_enabled ? "on" : "off"}>{c.plan_enabled ? "In calendar" : "Not in calendar"}</span>
        <span>{c.weekly_minutes ? `${hours(c.weekly_minutes)}/week` : "No weekly limit"}</span>
        <span className={c.reviews_enabled ? "on" : "off"}>{c.reviews_enabled ? "Weekly review on" : "Weekly review off"}</span>
        {c.deadline && <span>{c.deadline.label} in {c.deadline.days} d</span>}
      </div>
      <Link className="open" href={`/p/${c.id}`}>Open project →</Link>
    </article>
  );
}

function Mini({ c }: { c: Card }) {
  const n = c.total || 1, open = c.total - c.done;
  return (
    <div className="panel mini" data-c={c.color}>
      <div className="h">
        <i className="dot" /><Link href={`/p/${c.id}`}><b>{c.name}</b></Link>
        {c.state && <span className={`state${c.state === "Live" ? " live" : c.state === "Automated" ? " auto" : ""}`}>{c.state}</span>}
        <Grip id={c.id} label={c.name} />
      </div>
      <p>{c.status || c.tagline}</p>
      {c.total > 0 && <div className="seg thin"><i className="d" style={{ width: `${(c.done / n) * 100}%` }} /><i className="g" style={{ width: `${(c.doing / n) * 100}%` }} /><i className="l" style={{ width: `${(c.late / n) * 100}%` }} /></div>}
      <div className="row2">
        <Link className="due" href={`/p/${c.id}`}>{open ? `${open} open${c.late ? ` · ${c.late} late` : ""}` : "No open items"} →</Link>
      </div>
    </div>
  );
}
