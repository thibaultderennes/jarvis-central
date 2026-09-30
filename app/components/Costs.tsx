"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import { createCost, editCost, removeCost } from "@/lib/actions";
import type { Cost } from "@/lib/data";

type P = { id: string; name: string; color: string };
type Props = { costs: Cost[]; projects: P[]; project?: string | null; currency: string; today: string };
type Period = Cost["period"];

const PERIODS: Period[] = ["week", "month", "year"];
const monthly = (c: Cost) => (c.period === "week" ? (c.amount * 52) / 12 : c.period === "year" ? c.amount / 12 : c.amount);
const money = (v: number, cur: string) => `${v.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;
const fmt = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("en-CA", { timeZone: "UTC", month: "short", day: "numeric" });
const daysTo = (a: string, b: string) => Math.round((+new Date(b + "T12:00:00Z") - +new Date(a + "T12:00:00Z")) / 864e5);
const nextDate = (c: Cost, today: string): string | null => {
  // A renewal date in the past rolls forward by the billing period until it lands on or after today.
  if (!c.next_renewal) return null;
  let d = new Date(c.next_renewal + "T12:00:00Z");
  for (let i = 0; i < 400 && d.toISOString().slice(0, 10) < today; i++) {
    if (c.period === "week") d.setUTCDate(d.getUTCDate() + 7);
    else if (c.period === "month") d.setUTCMonth(d.getUTCMonth() + 1);
    else d.setUTCFullYear(d.getUTCFullYear() + 1);
  }
  return d.toISOString().slice(0, 10);
};
/** Totals per currency (no conversion): monthly and yearly equivalents. */
const totals = (list: Cost[]) => {
  const t: Record<string, number> = {};
  for (const c of list) t[c.currency] = (t[c.currency] || 0) + monthly(c);
  return Object.entries(t).sort((a, b) => b[1] - a[1]);
};

/**
 * Recurring costs. `project` undefined = every cost with a per-project breakdown (the Finance page);
 * a project id = that project's costs (its Finance tab); null = costs that belong to no project.
 */
export default function Costs({ costs, projects, project, currency, today }: Props) {
  const [list, setList] = useState(costs);
  useEffect(() => setList(costs), [costs]);
  const [, start] = useTransition();
  const [err, setErr] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const pmap = useMemo(() => Object.fromEntries(projects.map((p) => [p.id, p])), [projects]);
  const run = (fn: () => Promise<unknown>) => start(async () => { try { setErr(""); await fn(); } catch { setErr("Couldn't save that. Try again."); } });

  const scoped = list.filter((c) => (project === undefined ? true : project === null ? !c.project_id : c.project_id === project));
  const active = scoped.filter((c) => c.active);
  const shown = (showInactive ? scoped : active).slice().sort((a, b) => (a.project_id || "~").localeCompare(b.project_id || "~") || monthly(b) - monthly(a));
  const tot = totals(active);
  const renewals = active.map((c) => ({ c, on: nextDate(c, today) })).filter((x): x is { c: Cost; on: string } => !!x.on && daysTo(today, x.on) <= 30)
    .sort((a, b) => a.on.localeCompare(b.on));

  // Breakdown per project (monthly, per currency): only on the all-projects view.
  const breakdown = useMemo(() => {
    if (project !== undefined) return [];
    const by = new Map<string, Record<string, number>>();
    for (const c of active) { const k = c.project_id || ""; const t = by.get(k) || {}; t[c.currency] = (t[c.currency] || 0) + monthly(c); by.set(k, t); }
    const main = tot[0]?.[0] || currency;
    return [...by.entries()].map(([k, t]) => ({ key: k || "__independent", label: k ? pmap[k]?.name || k : "Independent", color: k ? pmap[k]?.color || "other" : "other", v: t[main] || 0, others: Object.entries(t).filter(([cur]) => cur !== main), main }))
      .sort((a, b) => b.v - a.v);
  }, [active, project, pmap, tot, currency]);
  const bmax = Math.max(1, ...breakdown.map((b) => b.v));

  const patch = (c: Cost, p: Partial<Cost>) => {
    setList((l) => l.map((x) => (x.id === c.id ? { ...x, ...p } : x)));
    run(() => editCost(c.id, p));
  };
  const remove = (c: Cost) => {
    setConfirm(null); setEditing(null);
    setList((l) => l.filter((x) => x.id !== c.id));
    run(() => removeCost(c.id));
  };

  return (
    <div className="costs">
      {err && <div className="due late" role="alert">{err}</div>}
      <div className="cost-tiles">
        <div className="panel ctile">
          <span className="lbl">Per month</span>
          {tot.length ? tot.map(([cur, v]) => <span key={cur} className="v">{money(v, cur)}</span>) : <span className="v">—</span>}
          <span className="s">{active.length} active cost{active.length === 1 ? "" : "s"}</span>
        </div>
        <div className="panel ctile">
          <span className="lbl">Per year</span>
          {tot.length ? tot.map(([cur, v]) => <span key={cur} className="v">{money(v * 12, cur)}</span>) : <span className="v">—</span>}
          <span className="s">Weekly and yearly amounts normalised</span>
        </div>
        <div className="panel ctile">
          <span className="lbl">Renewing in 30 days</span>
          <span className="v">{renewals.length}</span>
          <span className="s">{renewals.length ? `Next: ${renewals[0].c.name} · ${fmt(renewals[0].on)}` : "Nothing with a renewal date coming up"}</span>
        </div>
      </div>

      {project === undefined && (
        <section className="panel">
          <div className="ph"><h2 className="ph-t">Per project</h2><span className="sp" /><span className="hint">Monthly equivalent{tot.length > 1 ? ` in ${tot[0][0]}; other currencies listed beside` : ""}</span></div>
          {breakdown.length ? (
            <div className="pb" role="list">
              {breakdown.map((b) => (
                <div className="hbar" key={b.key} role="listitem" data-c={b.color}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "flex", gap: 7, alignItems: "center" }}><i className="dot" />{b.label}</span>
                  <span className="track"><span className="fill" style={{ width: `${(b.v / bmax) * 100}%` }} /></span>
                  <span className="v" title={b.others.length ? b.others.map(([cur, v]) => money(v, cur)).join(" + ") : undefined}>{b.v ? money(b.v, b.main) : b.others.map(([cur, v]) => money(v, cur)).join(" + ")}</span>
                </div>
              ))}
            </div>
          ) : <div className="empty">No costs yet. Add the first one below.</div>}
        </section>
      )}

      {renewals.length > 0 && (
        <section className="panel">
          <div className="ph"><h2 className="ph-t">Upcoming renewals</h2><span className="sp" /><span className="hint">Next 30 days</span></div>
          <div className="renewals">
            {renewals.map(({ c, on }) => {
              const n = daysTo(today, on);
              return (
                <div key={c.id} className="renew" data-c={c.project_id ? pmap[c.project_id]?.color || "other" : "other"}>
                  <i className="dot" />
                  <span className="t"><b>{c.name}</b><small>{c.project_id ? pmap[c.project_id]?.name || c.project_id : "Independent"} · {money(c.amount, c.currency)}/{c.period}</small></span>
                  <span className={`due${n <= 3 ? " soon" : ""}`}>{n === 0 ? "today" : n === 1 ? "tomorrow" : `in ${n} days`} · {fmt(on)}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="panel">
        <div className="ph">
          <h2 className="ph-t">{project === undefined ? "All costs" : project === null ? "Independent costs" : "Costs"}</h2><span className="sp" />
          {scoped.length > active.length && (
            <label className="toggle" style={{ fontSize: 12.5 }}>
              <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
              Show inactive ({scoped.length - active.length})
            </label>
          )}
          <span className="hint">Click a row to edit</span>
        </div>
        <div className="cost-table" role="table">
          <div className="crow-h" role="row">
            <span>Name</span><span>Project</span><span className="r">Amount</span><span className="r">Per month</span><span>Renews</span><span />
          </div>
          {!shown.length && <div className="empty">{scoped.length ? "Every cost here is inactive." : "No recurring costs yet."}</div>}
          {shown.map((c) => (
            editing === c.id
              ? <EditRow key={c.id} c={c} projects={projects} lockProject={typeof project === "string"} onSave={(p) => { patch(c, p); setEditing(null); }} onCancel={() => setEditing(null)}
                  onDelete={() => (confirm === c.id ? remove(c) : setConfirm(c.id))} confirming={confirm === c.id} onToggleActive={() => patch(c, { active: !c.active })} />
              : (
                <button key={c.id} type="button" className={`crow-c${c.active ? "" : " inactive"}`} role="row" data-c={c.project_id ? pmap[c.project_id]?.color || "other" : "other"} onClick={() => { setEditing(c.id); setConfirm(null); }}>
                  <span className="n"><b>{c.name}</b>{c.notes && <small>{c.notes}</small>}</span>
                  <span className="p"><i className="dot" />{c.project_id ? pmap[c.project_id]?.name || c.project_id : "Independent"}</span>
                  <span className="r mono">{money(c.amount, c.currency)}<small>/{c.period}</small></span>
                  <span className="r mono">{money(monthly(c), c.currency)}</span>
                  <span className="due">{(() => { const on = nextDate(c, today); return on ? fmt(on) : ""; })()}</span>
                  <span className="pill">{c.active ? c.period : "inactive"}</span>
                </button>
              )
          ))}
        </div>
        <AddRow projects={projects} project={project} currency={tot[0]?.[0] || currency} run={run} />
      </section>
    </div>
  );
}

function EditRow({ c, projects, lockProject, onSave, onCancel, onDelete, confirming, onToggleActive }: {
  c: Cost; projects: P[]; lockProject: boolean; onSave: (p: Partial<Cost>) => void; onCancel: () => void; onDelete: () => void; confirming: boolean; onToggleActive: () => void;
}) {
  const [f, setF] = useState({ name: c.name, amount: String(c.amount), currency: c.currency, period: c.period as Period, project_id: c.project_id || "", next_renewal: c.next_renewal || "", notes: c.notes });
  const save = () => {
    const amount = Number(f.amount);
    if (!f.name.trim() || !Number.isFinite(amount) || amount < 0) return;
    onSave({ name: f.name.trim(), amount, currency: f.currency.toUpperCase().slice(0, 3) || c.currency, period: f.period, project_id: f.project_id || null, next_renewal: f.next_renewal || null, notes: f.notes });
  };
  return (
    <form className="crow-e" role="row" onSubmit={(e) => { e.preventDefault(); save(); }} onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}>
      <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} aria-label="Name" autoFocus />
      <select className="select" value={f.project_id} disabled={lockProject} onChange={(e) => setF({ ...f, project_id: e.target.value })} aria-label="Project">
        <option value="">Independent</option>
        {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <span className="amt">
        <input className="input" type="number" min={0} step="0.01" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} aria-label="Amount" />
        <input className="input cur" value={f.currency} maxLength={3} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} aria-label="Currency" />
        <select className="select" value={f.period} onChange={(e) => setF({ ...f, period: e.target.value as Period })} aria-label="Billing period">
          {PERIODS.map((p) => <option key={p} value={p}>per {p}</option>)}
        </select>
      </span>
      <input className="input" type="date" value={f.next_renewal} onChange={(e) => setF({ ...f, next_renewal: e.target.value })} aria-label="Next renewal" />
      <input className="input notes" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Notes (optional)" aria-label="Notes" />
      <span className="acts">
        <button className="btn sm" type="submit">Save</button>
        <button className="btn ghost sm" type="button" onClick={onCancel}>Cancel</button>
        <button className="btn ghost sm" type="button" onClick={onToggleActive} title={c.active ? "Keep it on the list, out of the totals" : "Count it again"}>{c.active ? "Set inactive" : "Set active"}</button>
        <button className={`btn ghost sm${confirming ? " danger" : ""}`} type="button" onClick={onDelete} aria-label={confirming ? `Confirm delete ${c.name}` : `Delete ${c.name}`}>{confirming ? "Delete for good?" : "×"}</button>
      </span>
    </form>
  );
}

function AddRow({ projects, project, currency, run }: { projects: P[]; project?: string | null; currency: string; run: (fn: () => Promise<unknown>) => void }) {
  const blank = { name: "", amount: "", currency, period: "month" as Period, project_id: typeof project === "string" ? project : "", next_renewal: "", notes: "" };
  const [f, setF] = useState(blank);
  useEffect(() => setF((x) => ({ ...x, currency })), [currency]);
  return (
    <form className="addrow cost-add" onSubmit={(e) => {
      e.preventDefault();
      const amount = Number(f.amount);
      if (!f.name.trim() || !Number.isFinite(amount) || amount < 0) return;
      const body = { name: f.name.trim(), amount, currency: f.currency.toUpperCase().slice(0, 3) || currency, period: f.period, project_id: f.project_id || null, next_renewal: f.next_renewal || null, notes: f.notes };
      setF({ ...blank, currency: body.currency });
      run(() => createCost(body));
    }}>
      <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Add a cost: hosting, a domain, an API plan…" aria-label="Cost name" />
      <input className="input" type="number" min={0} step="0.01" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="Amount" aria-label="Amount" style={{ width: 96 }} />
      <input className="input cur" value={f.currency} maxLength={3} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} aria-label="Currency" />
      <select className="select" value={f.period} onChange={(e) => setF({ ...f, period: e.target.value as Period })} aria-label="Billing period">
        {PERIODS.map((p) => <option key={p} value={p}>per {p}</option>)}
      </select>
      {typeof project !== "string" && (
        <select className="select" value={f.project_id} onChange={(e) => setF({ ...f, project_id: e.target.value })} aria-label="Project">
          <option value="">Independent</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      )}
      <input className="input" type="date" value={f.next_renewal} onChange={(e) => setF({ ...f, next_renewal: e.target.value })} aria-label="Next renewal (optional)" title="Next renewal (optional)" />
      <input className="input notes" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Notes" aria-label="Notes (optional)" />
      <button className="btn sm" disabled={!f.name.trim() || f.amount === ""}>Add</button>
    </form>
  );
}
