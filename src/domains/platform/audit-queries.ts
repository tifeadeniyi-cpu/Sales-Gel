import "server-only";
import { and, desc, eq, lt } from "drizzle-orm";
import { user } from "@/server/auth/schema";
import { authorize, type OrgContext } from "@/server/authz/context";
import { withTenant } from "@/server/db/tenant";
import { auditLogs } from "./schema";

export async function listAuditLogs(
  ctx: OrgContext,
  opts: { entityType?: string; action?: string; before?: Date; limit?: number } = {},
) {
  authorize(ctx, "audit.read");
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  return withTenant(ctx, (tx) =>
    tx
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        entityType: auditLogs.entityType,
        entityId: auditLogs.entityId,
        changes: auditLogs.changes,
        metadata: auditLogs.metadata,
        ipAddress: auditLogs.ipAddress,
        createdAt: auditLogs.createdAt,
        actorName: user.name,
        actorEmail: user.email,
      })
      .from(auditLogs)
      .leftJoin(user, eq(user.id, auditLogs.actorUserId))
      .where(
        and(
          eq(auditLogs.organizationId, ctx.orgId),
          opts.entityType ? eq(auditLogs.entityType, opts.entityType) : undefined,
          opts.action ? eq(auditLogs.action, opts.action) : undefined,
          opts.before ? lt(auditLogs.createdAt, opts.before) : undefined,
        ),
      )
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit + 1),
  ).then((rows) => ({ rows: rows.slice(0, limit), hasMore: rows.length > limit }));
}
