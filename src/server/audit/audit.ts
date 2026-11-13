import "server-only";
import { auditLogs, outboxEvents } from "@/domains/platform/schema";
import type { OrgContext } from "@/server/authz/context";
import type { Tx } from "@/server/db/client";

export type Changes = Record<string, { from: unknown; to: unknown }>;

/** Field-level diff of the keys present in `next`. Unchanged keys are omitted. */
export function diff<T extends Record<string, unknown>>(prev: Partial<T>, next: Partial<T>): Changes {
  const changes: Changes = {};
  for (const key of Object.keys(next)) {
    const a = prev[key];
    const b = next[key];
    const same = a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : JSON.stringify(a) === JSON.stringify(b);
    if (!same) changes[key] = { from: a ?? null, to: b ?? null };
  }
  return changes;
}

/** `userId: null` records the system (webhooks, scheduled jobs) as the actor. */
type AuditActor = { orgId: string; userId: string | null } & Partial<Pick<OrgContext, "ip" | "userAgent">>;

/** Writes an audit row inside the caller's transaction, so it commits or rolls back with the change. */
export async function audit(
  tx: Tx,
  ctx: AuditActor,
  entry: {
    action: string;
    entityType: string;
    entityId?: string | null;
    changes?: Changes;
    metadata?: Record<string, unknown>;
  },
) {
  await tx.insert(auditLogs).values({
    organizationId: ctx.orgId,
    actorUserId: ctx.userId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    changes: entry.changes && Object.keys(entry.changes).length ? entry.changes : null,
    metadata: entry.metadata ?? null,
    ipAddress: ctx.ip ?? null,
    userAgent: ctx.userAgent ?? null,
  });
}

/** Records a domain event in the transactional outbox (relayed to workers after commit; Phase 6). */
export async function emit(tx: Tx, orgId: string, type: string, payload: Record<string, unknown>) {
  await tx.insert(outboxEvents).values({ organizationId: orgId, type, payload });
}
