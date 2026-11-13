import "server-only";
import { and, asc, eq, lte, sql } from "drizzle-orm";
import { jobs, orgWorkSignals } from "@/domains/integrations/schema";
import { outboxEvents } from "@/domains/platform/schema";
import { db } from "@/server/db/client";
import { withScope } from "@/server/db/tenant";
import { logger } from "@/server/logger";
import { JOB_HANDLERS, OUTBOX_LISTENERS } from "./registry";

const LOCK_MS = 5 * 60_000;
const backoffMs = (attempt: number) => Math.min(60 * 60_000, 30_000 * 2 ** (attempt - 1)); // 30s, 1m, 2m … ≤ 1h

export interface WorkerResult { orgs: number; jobs: number; failed: number; outbox: number }

async function runOrg(orgId: string, deadline: number, res: WorkerResult) {
  // Claim due jobs (also reclaims jobs whose lock expired after a crash).
  const claimed = await withScope({ orgId }, (tx) =>
    tx.execute<{ id: string; type: string; payload: Record<string, unknown>; attempts: number; max_attempts: number }>(sql`
      update ${jobs} set status = 'running', attempts = attempts + 1, locked_until = now() + ${`${LOCK_MS} milliseconds`}::interval
      where id in (
        select id from ${jobs}
        where organization_id = ${orgId} and run_at <= now()
          and (status = 'pending' or (status = 'running' and locked_until < now()))
        order by run_at limit 10 for update skip locked)
      returning id, type, payload, attempts, max_attempts`),
  );
  for (const j of claimed) {
    if (Date.now() > deadline) {
      await withScope({ orgId }, (tx) => tx.update(jobs).set({ status: "pending", lockedUntil: null, attempts: sql`${jobs.attempts} - 1` }).where(eq(jobs.id, j.id)));
      continue;
    }
    const handler = JOB_HANDLERS[j.type];
    try {
      if (!handler) throw new Error(`No handler for job type ${j.type}`);
      await handler({ orgId, jobId: j.id, payload: j.payload, attempt: j.attempts });
      await withScope({ orgId }, (tx) => tx.update(jobs).set({ status: "done", finishedAt: new Date(), lockedUntil: null, lastError: null }).where(eq(jobs.id, j.id)));
      res.jobs++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const final = j.attempts >= j.max_attempts || !handler;
      await withScope({ orgId }, (tx) =>
        tx.update(jobs).set(final ? { status: "failed", finishedAt: new Date(), lockedUntil: null, lastError: msg.slice(0, 2000) } : { status: "pending", runAt: new Date(Date.now() + backoffMs(j.attempts)), lockedUntil: null, lastError: msg.slice(0, 2000) }).where(eq(jobs.id, j.id)),
      );
      logger.warn({ orgId, jobId: j.id, type: j.type, attempt: j.attempts, final, err: msg }, "job failed");
      res.failed++;
    }
  }

  // Relay outbox events to in-process listeners (e.g. scheduling reminders), then mark them done.
  const events = await withScope({ orgId }, (tx) =>
    tx.execute<{ id: string; type: string; payload: Record<string, unknown>; attempts: number }>(sql`
      update ${outboxEvents} set status = 'processing', attempts = attempts + 1
      where id in (select id from ${outboxEvents} where organization_id = ${orgId} and status = 'pending' and available_at <= now()
                   order by available_at limit 50 for update skip locked)
      returning id, type, payload, attempts`),
  );
  for (const e of events) {
    try {
      for (const l of OUTBOX_LISTENERS[e.type] ?? []) await l({ orgId, payload: e.payload });
      await withScope({ orgId }, (tx) => tx.update(outboxEvents).set({ status: "done", processedAt: new Date(), lastError: null }).where(eq(outboxEvents.id, e.id)));
      res.outbox++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await withScope({ orgId }, (tx) =>
        tx.update(outboxEvents).set(e.attempts >= 5 ? { status: "failed", lastError: msg } : { status: "pending", availableAt: new Date(Date.now() + backoffMs(e.attempts)), lastError: msg }).where(eq(outboxEvents.id, e.id)),
      );
    }
  }

  // Re-point the work signal at this org's next due item (or clear it).
  await withScope({ orgId }, async (tx) => {
    const [n] = await tx.execute<{ next: string | null }>(sql`
      select least(
        (select min(run_at) from ${jobs} where organization_id = ${orgId} and status = 'pending'),
        (select min(locked_until) from ${jobs} where organization_id = ${orgId} and status = 'running'),
        (select min(available_at) from ${outboxEvents} where organization_id = ${orgId} and status = 'pending')
      )::text as next`);
    if (n?.next) await tx.update(orgWorkSignals).set({ dueAt: new Date(n.next) }).where(eq(orgWorkSignals.organizationId, orgId));
    else await tx.delete(orgWorkSignals).where(eq(orgWorkSignals.organizationId, orgId));
  });
}

/** Processes due background work across workspaces, each inside its own tenant scope. */
export async function runDueWork(opts: { maxOrgs?: number; budgetMs?: number; orgId?: string } = {}): Promise<WorkerResult> {
  const deadline = Date.now() + (opts.budgetMs ?? 25_000);
  const res: WorkerResult = { orgs: 0, jobs: 0, failed: 0, outbox: 0 };
  const due = await db
    .select({ orgId: orgWorkSignals.organizationId })
    .from(orgWorkSignals)
    .where(and(lte(orgWorkSignals.dueAt, new Date()), opts.orgId ? eq(orgWorkSignals.organizationId, opts.orgId) : undefined))
    .orderBy(asc(orgWorkSignals.dueAt))
    .limit(opts.maxOrgs ?? 25);
  for (const { orgId } of due) {
    if (Date.now() > deadline) break;
    try {
      await runOrg(orgId, deadline, res);
      res.orgs++;
    } catch (err) {
      logger.error({ orgId, err: err instanceof Error ? err.message : String(err) }, "worker org pass failed");
    }
  }
  return res;
}

