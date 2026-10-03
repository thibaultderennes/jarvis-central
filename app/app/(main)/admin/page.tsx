import Link from "next/link";
import { requireSession } from "@/lib/auth";
import * as D from "@/lib/data";
import { TZ, fmtDate } from "@/lib/time";
import { OWNER, PLAN_WHEN, REVIEW_WHEN, VERSION } from "@/lib/instance";
import { PrefsForm, RescanButton, type Rescan } from "@/components/Admin";
import "./admin.css";

export default async function AdminPage() {
  await requireSession();
  const [projects, rescan, hb, prefs, subs] = await Promise.all([
    D.getProjects(true), D.kvGet<Rescan>("projects.rescan"), D.kvGet<{ at: string }>("worker.heartbeat"), D.getPrefs(), D.getCosts({ project: null }),
  ]);
  const rank = Object.fromEntries(D.splitFeatured(projects.filter((p) => !p.archived)).featured.map((p, i) => [p.id, i + 1]));
  const totals = subs.reduce<Record<string, number>>((acc, c) => ({ ...acc, [c.currency]: (acc[c.currency] || 0) + D.monthly(c) }), {});
  const currency = prefs.finance_currency || "USD";
  const configHint = "Set in jarvis.config.json on your Mac, then `node app/scripts/setup.mjs secrets` and redeploy.";

  return (
    <div className="admin">
      <div className="hello">
        <div>
          <h1 className="page">Admin</h1>
          <p className="sub">Everything about this Jarvis that isn&apos;t project work: your projects list, your account, subscriptions, and how the site behaves.</p>
        </div>
      </div>

      <section className="panel" aria-labelledby="h-projects">
        <div className="ph"><h2 className="ph-t" id="h-projects">Projects</h2><span className="sp" /><span className="hint">{projects.filter((p) => !p.archived).length} registered · {projects.filter((p) => p.archived).length} archived</span></div>
        <RescanButton state={rescan?.value || null} workerAt={hb?.value?.at || null} />
        <div className="note-line">A new folder in your projects folder becomes a project after a refresh. The scan runs on your Mac (the folders live there), through the Jarvis worker; existing projects are left untouched and nothing is ever deleted (a folder that is gone gets archived).</div>
        {projects.length > 0 && (
          <table>
            <thead><tr><th>Project</th><th>Kind</th><th>Folder</th><th>Top 3</th></tr></thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id} className={p.archived ? "archived" : undefined} data-c={p.color}>
                  <td><Link href={`/p/${p.id}`}><i className="dot" />{p.name}</Link>{p.archived && <span className="pill" style={{ marginLeft: 6 }}>archived</span>}</td>
                  <td>{p.kind}</td>
                  <td className="dir">{p.dir || "—"}</td>
                  <td>{rank[p.id] ? `slot ${rank[p.id]}` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel" aria-labelledby="h-account">
        <div className="ph"><h2 className="ph-t" id="h-account">Account</h2></div>
        <dl className="kv">
          <dt>Owner</dt><dd>{OWNER || "not set"}</dd>
          <dt>Timezone</dt><dd>{TZ}</dd>
          <dt>Sentient Dash</dt><dd>v{VERSION}</dd>
          <dt>Sign in</dt><dd>Password + authenticator app. To change them, update the site&apos;s environment variables and redeploy (see <code>docs/security.md</code> in the repo); there is no form for it here.</dd>
          <dt>Session</dt><dd><form action="/api/auth/logout" method="post"><button className="btn ghost sm">Sign out</button></form></dd>
        </dl>
      </section>

      <section className="panel" aria-labelledby="h-subs">
        <div className="ph"><h2 className="ph-t" id="h-subs">Subscriptions</h2><span className="sp" /><Link href="/finance" className="hint">Manage in Finance →</Link></div>
        {subs.length ? (
          <dl className="kv">
            <dt>Independent</dt><dd>{subs.length} recurring cost{subs.length > 1 ? "s" : ""} not tied to a project<small>{Object.entries(totals).map(([c, v]) => `${v.toFixed(2)} ${c}`).join(" + ")} per month</small></dd>
            <dt>Next renewals</dt><dd>{subs.filter((c) => c.next_renewal).sort((a, b) => a.next_renewal!.localeCompare(b.next_renewal!)).slice(0, 5).map((c) => <span key={c.id} style={{ display: "block" }}>{fmtDate(c.next_renewal!)} · {c.name} · {c.amount} {c.currency}/{c.period}</span>)}{!subs.some((c) => c.next_renewal) && "No renewal dates entered"}</dd>
          </dl>
        ) : <div className="empty">No independent subscriptions yet. Add subscriptions, domains, hosting and API spend on the <Link href="/finance">Finance</Link> page; the ones with no project show here.</div>}
      </section>

      <section className="panel" aria-labelledby="h-prefs">
        <div className="ph"><h2 className="ph-t" id="h-prefs">Personal info &amp; preferences</h2></div>
        <dl className="kv">
          <dt>Name</dt><dd>{OWNER || "not set"}<small>{configHint}</small></dd>
          <dt>Timezone</dt><dd>{TZ}<small>{configHint}</small></dd>
          <dt>Weekly reviews</dt><dd>{REVIEW_WHEN}<small>{configHint}</small></dd>
          <dt>Week planning</dt><dd>{PLAN_WHEN}<small>{configHint}</small></dd>
        </dl>
        <PrefsForm showDone={!!prefs.show_done_default} currency={currency} />
      </section>
    </div>
  );
}
