import "server-only";
import { and, eq } from "drizzle-orm";
import { memberships, organizations } from "@/domains/identity/schema";
import { notify } from "@/domains/platform/notifications";
import type { Tx } from "@/server/db/client";
import { withScope } from "@/server/db/tenant";
import { enqueue } from "@/server/jobs/queue";
import type { JobContext } from "@/server/jobs/registry";
import { tasks } from "./schema";

/**
 * Schedules the reminder (at reminderAt) and the overdue notice (at dueAt) for a task.
 * Keys include the timestamps, so rescheduling creates fresh jobs and stale ones no-op.
 */
export async function scheduleTaskReminders(tx: Tx, orgId: string, t: { id: string; dueAt: Date | null; reminderAt: Date | null }) {
  const now = Date.now();
  if (t.reminderAt && t.reminderAt.getTime() > now - 60_000) {
    await enqueue(tx, orgId, "task.reminder", { taskId: t.id, kind: "due", at: t.reminderAt.toISOString() }, { runAt: t.reminderAt, idempotencyKey: `task:${t.id}:due:${t.reminderAt.toISOString()}`, maxAttempts: 3 });
  }
  if (t.dueAt && t.dueAt.getTime() > now - 60_000) {
    await enqueue(tx, orgId, "task.reminder", { taskId: t.id, kind: "overdue", at: t.dueAt.toISOString() }, { runAt: t.dueAt, idempotencyKey: `task:${t.id}:overdue:${t.dueAt.toISOString()}`, maxAttempts: 3 });
  }
}

export async function runTaskReminder(job: JobContext) {
  const { taskId, kind, at } = job.payload as { taskId: string; kind: "due" | "overdue"; at: string };
  await withScope({ orgId: job.orgId }, async (tx) => {
    const [t] = await tx.select().from(tasks).where(and(eq(tasks.organizationId, job.orgId), eq(tasks.id, taskId)));
    if (!t || t.status === "done" || !t.assigneeMembershipId) return;
    const current = kind === "due" ? t.reminderAt : t.dueAt;
    if (!current || current.toISOString() !== at) return; // rescheduled since; a newer job covers it
    const [m] = await tx.select({ userId: memberships.userId, status: memberships.status }).from(memberships).where(eq(memberships.id, t.assigneeMembershipId));
    if (!m || m.status !== "active") return;
    const [org] = await tx.select({ slug: organizations.slug }).from(organizations).where(eq(organizations.id, job.orgId));
    await notify(tx, {
      orgId: job.orgId,
      recipientUserId: m.userId,
      type: kind === "due" ? "task.due" : "task.overdue",
      title: kind === "due" ? `Reminder: ${t.title}` : `Overdue: ${t.title}`,
      link: `/o/${org.slug}/tasks?open=${t.id}&scope=all`,
      entityType: "task",
      entityId: t.id,
    });
  });
}
