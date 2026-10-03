import "./finance.css";
import { requireSession } from "@/lib/auth";
import * as D from "@/lib/data";
import { today } from "@/lib/time";
import Costs from "@/components/Costs";
import { Glyph, HeaderVec } from "@/components/brand";

export default async function FinancePage() {
  await requireSession();
  const [costs, projects, prefs] = await Promise.all([D.getCosts({ all: true }), D.getProjects(), D.getPrefs()]);
  const topIds = new Set(D.splitFeatured(projects).featured.map((p) => p.id));
  const active = costs.filter((c) => c.active);
  return (
    <>
      <div className="hello">
        <div>
          <h1 className="page"><Glyph n="finance" />Finance</h1>
          <p className="sub">What every project and your independent subscriptions cost you each month: hosting, domains, tools, API plans. Entered by hand; each project page has the same list under its Finance tab.</p>
        </div>
        <HeaderVec n="finance" />
        <div className="when">{active.length} active cost{active.length === 1 ? "" : "s"} · {projects.length} projects</div>
      </div>
      <Costs costs={costs} projects={projects.map((p) => ({ id: p.id, name: p.name, color: D.displayColor(p, topIds) }))} currency={prefs.finance_currency || "USD"} today={today()} />
    </>
  );
}
