import { CheckCircle2 } from "lucide-react";
import type { TaskView } from "@/domains/tasks/service";
import { TaskFormDialog, type Relation } from "./task-form-dialog";
import { TaskRow } from "./task-row";
import { Button } from "@/components/ui/button";

/** Tasks linked to a customer or lead; the same task records shown on the Tasks page. */
export function RelatedTasks({
  orgSlug,
  tasks,
  members,
  currentMembershipId,
  relation,
  canWrite,
  canSearchLeads,
  canSearchCustomers,
}: {
  orgSlug: string;
  tasks: TaskView[];
  members: { membershipId: string; name: string }[];
  currentMembershipId: string;
  relation: Relation;
  canWrite: boolean;
  canSearchLeads: boolean;
  canSearchCustomers: boolean;
}) {
  const open = tasks.filter((t) => t.status !== "done");
  const done = tasks.filter((t) => t.status === "done").slice(0, 5);
  return (
    <div className="space-y-3">
      {canWrite && (
        <TaskFormDialog
          orgSlug={orgSlug}
          members={members}
          currentMembershipId={currentMembershipId}
          presetRelations={[relation]}
          canSearchLeads={canSearchLeads}
          canSearchCustomers={canSearchCustomers}
          trigger={<Button size="sm" variant="outline"><CheckCircle2 /> Add task</Button>}
        />
      )}
      {tasks.length === 0 ? (
        <p className="text-sm text-muted-foreground">No tasks yet.</p>
      ) : (
        <ul className="-mx-4 divide-y">
          {[...open, ...done].map((t) => (
            <TaskRow key={t.id} orgSlug={orgSlug} task={t} canWrite={canWrite} compact href={`/o/${orgSlug}/tasks?open=${t.id}&scope=all`} />
          ))}
        </ul>
      )}
    </div>
  );
}
