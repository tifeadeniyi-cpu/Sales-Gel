import Link from "next/link";
import { forbidden } from "next/navigation";
import { KanbanSquare, Settings2 } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { RecordDrawer } from "@/components/app/record-drawer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getBoard, getLead, getLeadStats, listLeads, listPipelines, type LeadDetail } from "@/domains/sales/service";
import type { LeadFilters as Filters } from "@/domains/sales/validation";
import { listTasks } from "@/domains/tasks/service";
import { formatMoney } from "@/lib/money";
import { requireOrgContext } from "@/server/authz/request";
import { ValidationError } from "@/server/errors";
import { canAny } from "@/server/authz/guards";
import { RelatedTasks } from "../../tasks/_components/related-tasks";
import { Board } from "./board";
import { LeadFilters } from "./lead-filters";
import { LeadPanel } from "./lead-panel";
import { LeadTable } from "./lead-table";
import { NewLeadDialog } from "./new-lead-dialog";
import { LEAD_STATUS } from "./labels";
import { leadPerms, loadLeadLookups } from "./load";

type SP = Record<string, string | undefined>;

function money(t: Record<string, number>) {
  const parts = Object.entries(t).map(([c, v]) => formatMoney(v, c));
  return parts.length ? parts.join(" · ") : "—";
}

export async function PipelinePage({ params, searchParams, mode }: { params: Promise<{ orgSlug: string }>; searchParams: Promise<SP>; mode: "leads" | "deals" }) {
  const { orgSlug } = await params;
  const ctx = await requireOrgContext(orgSlug);
  if (!canAny(ctx, "leads.read", "leads.read_assigned")) forbidden();
  const sp = await searchParams;
  const perms = leadPerms(ctx);
  const view = mode === "deals" ? "board" : "list";
  const filters: Filters = { pipeline: sp.pipeline, owner: sp.owner, q: sp.q, from: view === "list" ? sp.from : undefined, to: view === "list" ? sp.to : undefined, stage: view === "list" ? sp.stage : undefined, status: (sp.status as Filters["status"]) ?? (view === "board" ? "all" : "open") };
  const safe = async <T,>(fn: () => Promise<T>, fallback: () => Promise<T>) => {
    try {
      return await fn();
    } catch (err) {
      // Only fall back for invalid filter values in the URL; real errors must surface.
      if (!(err instanceof ValidationError)) throw err;
      return fallback();
    }
  };
  const [board, stats, pipelines, lookups] = await Promise.all([
    safe(() => getBoard(ctx, filters), () => getBoard(ctx, {})),
    getLeadStats(ctx),
    listPipelines(ctx),
    loadLeadLookups(ctx),
  ]);
  const rows = view === "list" ? await safe(() => listLeads(ctx, { ...filters, pipeline: board.pipeline.id }), () => listLeads(ctx, {})) : [];
  const base = `/o/${orgSlug}/leads`;

  let drawer = null;
  const openId = sp.open && /^[0-9a-f-]{36}$/i.test(sp.open) ? sp.open : null;
  if (openId) {
    const lead: LeadDetail | null = await getLead(ctx, openId);
    if (lead) {
      const ids = view === "board" ? board.stages.flatMap((s) => s.leads.map((l) => l.id)) : rows.map((r) => r.id);
      const idx = ids.indexOf(lead.id);
      const tasks = perms.tasks ? await listTasks(ctx, { scope: "all", status: "all", entityType: "lead", entityId: lead.id }) : [];
      drawer = (
        <RecordDrawer
          title={lead.title}
          subtitle={<>LEAD-{lead.number} · <Badge tone={LEAD_STATUS[lead.status].tone}>{LEAD_STATUS[lead.status].label}</Badge></>}
          fullHref={`${base}/${lead.id}`}
          prevId={idx > 0 ? ids[idx - 1] : null}
          nextId={idx >= 0 && idx < ids.length - 1 ? ids[idx + 1] : null}
        >
          <div className="space-y-6 p-5">
            <LeadPanel key={lead.id + lead.stageId + lead.status} orgSlug={orgSlug} lead={lead} members={lookups.members} canWrite={perms.write} canAssign={perms.assign} />
            {perms.tasks && (
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tasks</h3>
                <RelatedTasks orgSlug={orgSlug} tasks={tasks} members={lookups.members} currentMembershipId={ctx.membershipId} relation={{ type: "lead", id: lead.id, label: lead.title }} canWrite={perms.tasksWrite} canSearchLeads canSearchCustomers={perms.customers} />
              </section>
            )}
          </div>
        </RecordDrawer>
      );
    }
  }

  const empty = board.stages.every((s) => s.leads.length === 0);
  const stageFilter = sp.stage && board.stages.some((s) => s.id === sp.stage) ? sp.stage : null;
  return (
    <>
      <PageHeader
        title={mode === "deals" ? "Deals" : "Leads"}
        description={mode === "deals" ? "Your pipeline: drag deals from first inquiry to won." : "Every opportunity in one list. Switch to Deals for the pipeline board."}
        actions={
          <>
            {perms.manage && <Button asChild variant="outline"><Link href={`${base}/settings`}><Settings2 /> Pipeline settings</Link></Button>}
            {perms.write && (
              <NewLeadDialog
                key={sp.new === "1" ? "new" : "btn"}
                defaultOpen={sp.new === "1"}
                orgSlug={orgSlug}
                pipelines={pipelines.map((p) => ({ id: p.id, name: p.name, stages: p.stages.map((s) => ({ id: s.id, name: s.name, category: s.category })) }))}
                defaultPipelineId={board.pipeline.id}
                members={lookups.members}
                defaultCurrency={ctx.defaultCurrency}
                canAssign={perms.assign}
              />
            )}
          </>
        }
      />
      {stats && (
        <div className="mb-4 grid gap-3 sm:grid-cols-4">
          {[
            ["Open leads", String(stats.active)],
            ["Pipeline value", money(stats.pipelineValue)],
            ["Weighted forecast", money(stats.weightedValue)],
            ["Win rate (90 days)", stats.winRate90 === null ? "—" : `${stats.winRate90}%`],
          ].map(([l, v]) => (
            <Card key={l}><CardContent className="p-4"><div className="text-xs text-muted-foreground">{l}</div><div className="truncate text-xl font-semibold" title={v}>{v}</div></CardContent></Card>
          ))}
        </div>
      )}
      <LeadFilters pipelines={board.pipelines} members={lookups.members} canSeeAll={ctx.permissions.has("leads.read")} view={view} />
      {view === "list" && (sp.from || sp.stage) && (
        <p className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="rounded-full bg-primary/10 px-3 py-1 text-primary">{sp.from ? "Leads created in the dashboard period" : "One stage"}</span>
          <Link href={`/o/${orgSlug}/leads`} className="text-primary hover:underline">Clear</Link>
        </p>
      )}
      <div className="mt-4">
        {empty && !filters.q && !filters.owner ? (
          <EmptyState
            icon={<KanbanSquare className="size-8" />}
            title="No leads yet"
            description="Create a lead for each inquiry or opportunity, then drag it through your pipeline."
          />
        ) : view === "board" ? (
          <>
            {stageFilter && (
              <p className="mb-3 text-sm">Showing one stage. <Link href={`/o/${orgSlug}/deals`} className="text-primary hover:underline">Show all stages</Link></p>
            )}
            <Board orgSlug={orgSlug} stages={stageFilter ? board.stages.filter((s) => s.id === stageFilter) : board.stages} canWrite={perms.write} />
          </>
        ) : (
          <Card className="overflow-hidden">{rows.length ? <LeadTable rows={rows} /> : <p className="p-6 text-sm text-muted-foreground">No leads match.</p>}</Card>
        )}
      </div>
      {drawer}
    </>
  );
}
