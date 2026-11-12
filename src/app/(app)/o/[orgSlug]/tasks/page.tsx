import { forbidden } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { RecordDrawer } from "@/components/app/record-drawer";
import { Card } from "@/components/ui/card";
import { getTask, getTaskStats, listTasks, type TaskFilters } from "@/domains/tasks/service";
import { listAssignableMembers } from "@/domains/customers/service";
import { requireOrgContext } from "@/server/authz/request";
import { ValidationError } from "@/server/errors";
import { can, canAny } from "@/server/authz/guards";
import { TaskBoard } from "./_components/task-board";
import { TaskCalendar } from "./_components/task-calendar";
import { TaskDetailPanel } from "./_components/task-detail";
import { TaskFormDialog } from "./_components/task-form-dialog";
import { TaskRow } from "./_components/task-row";
import { TaskToolbar } from "./_components/task-toolbar";

type SP = Record<string, string | undefined>;

export default async function TasksPage({ params, searchParams }: { params: Promise<{ orgSlug: string }>; searchParams: Promise<SP> }) {
  const { orgSlug } = await params;
  const ctx = await requireOrgContext(orgSlug);
  if (!can(ctx, "tasks.read")) forbidden();
  const sp = await searchParams;
  const view = sp.view ?? "list";
  const now = new Date();
  const month = sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const filters: TaskFilters = {
    scope: (sp.scope as TaskFilters["scope"]) ?? "mine",
    status: view === "board" ? "all" : ((sp.status as TaskFilters["status"]) ?? (view === "calendar" ? "all" : "open")),
    due: (sp.due as TaskFilters["due"]) ?? "any",
  };
  if (view === "calendar") {
    const [y, m] = month.split("-").map(Number);
    filters.from = new Date(Date.UTC(y, m - 2, 20));
    filters.to = new Date(Date.UTC(y, m, 12));
  }
  let tasks;
  try {
    tasks = await listTasks(ctx, filters);
  } catch (err) {
    // Only fall back for invalid filter values in the URL; real errors must surface.
    if (!(err instanceof ValidationError)) throw err;
    tasks = await listTasks(ctx, {});
  }
  const [stats, members] = await Promise.all([getTaskStats(ctx), listAssignableMembers(ctx)]);
  const canWrite = can(ctx, "tasks.write");
  const openId = sp.open && /^[0-9a-f-]{36}$/i.test(sp.open) ? sp.open : null;
  const detail = openId ? await getTask(ctx, openId) : null;
  const memberOpts = members.map((m) => ({ membershipId: m.membershipId, name: m.name }));

  return (
    <>
      <PageHeader
        title="Tasks & Activities"
        description={stats ? `${stats.dueToday} due today · ${stats.overdue} overdue · ${stats.open} open assigned to you` : undefined}
        actions={canWrite && (
          <TaskFormDialog orgSlug={orgSlug} members={memberOpts} currentMembershipId={ctx.membershipId} canSearchLeads={canAny(ctx, "leads.read", "leads.read_assigned")} canSearchCustomers={canAny(ctx, "customers.read", "customers.read_assigned")} />
        )}
      />
      <TaskToolbar />
      <Card className="mt-4 overflow-hidden">
        {view === "board" ? (
          <TaskBoard orgSlug={orgSlug} tasks={tasks} canWrite={canWrite} />
        ) : view === "calendar" ? (
          <TaskCalendar tasks={tasks} month={month} />
        ) : tasks.length === 0 ? (
          <div className="p-6"><EmptyState icon={<CheckCircle2 className="size-8" />} title="Nothing here" description="Tasks you create or are assigned will show up here." /></div>
        ) : (
          <ul className="divide-y">{tasks.map((t) => <TaskRow key={t.id} orgSlug={orgSlug} task={t} canWrite={canWrite} />)}</ul>
        )}
      </Card>
      {detail && (
        <RecordDrawer title="Task" fullHref={`/o/${orgSlug}/tasks?open=${detail.id}&scope=all`}>
          <TaskDetailPanel
            orgSlug={orgSlug}
            task={detail}
            members={memberOpts}
            currentUserId={ctx.userId}
            currentMembershipId={ctx.membershipId}
            canWrite={canWrite}
            canDelete={canWrite && (detail.createdByUserId === ctx.userId || detail.assigneeMembershipId === ctx.membershipId || can(ctx, "members.manage"))}
          />
        </RecordDrawer>
      )}
    </>
  );
}
