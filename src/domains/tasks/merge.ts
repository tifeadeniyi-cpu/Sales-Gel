import { and, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/server/db/client";
import { taskRelations } from "./schema";

/** Customer-merge mover: task links move to the survivor unless the task is already linked to it. */
export const taskRelationsMergeMover = {
  key: "task_relations",
  async move(tx: Tx, orgId: string, from: string, to: string) {
    const rows = await tx
      .update(taskRelations)
      .set({ entityId: to })
      .where(
        and(
          eq(taskRelations.organizationId, orgId),
          eq(taskRelations.entityType, "customer"),
          eq(taskRelations.entityId, from),
          sql`not exists (select 1 from task_relations x where x.task_id = ${taskRelations.taskId} and x.entity_type = 'customer' and x.entity_id = ${to})`,
        ),
      )
      .returning({ taskId: taskRelations.taskId });
    return rows.map((r) => r.taskId);
  },
  async restore(tx: Tx, orgId: string, taskIds: string[], to: string, from?: string) {
    if (!taskIds.length || !from) return;
    await tx
      .update(taskRelations)
      .set({ entityId: to })
      .where(and(eq(taskRelations.organizationId, orgId), eq(taskRelations.entityType, "customer"), eq(taskRelations.entityId, from), inArray(taskRelations.taskId, taskIds)));
  },
};
