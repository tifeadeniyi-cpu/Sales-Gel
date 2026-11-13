import "server-only";
import { jobs } from "@/domains/integrations/schema";
import type { Tx } from "@/server/db/client";

export interface EnqueueOptions { runAt?: Date; idempotencyKey?: string; maxAttempts?: number }

/** Enqueues a background job in the caller's transaction (so it exists only if the change commits). */
export async function enqueue(tx: Tx, orgId: string, type: string, payload: Record<string, unknown> = {}, opts: EnqueueOptions = {}) {
  const rows = await tx
    .insert(jobs)
    .values({ organizationId: orgId, type, payload, runAt: opts.runAt ?? new Date(), idempotencyKey: opts.idempotencyKey ?? null, maxAttempts: opts.maxAttempts ?? 5 })
    .onConflictDoNothing()
    .returning({ id: jobs.id });
  return rows[0]?.id ?? null;
}
