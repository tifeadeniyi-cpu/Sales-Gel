import "server-only";
import { and, eq } from "drizzle-orm";
import type Stripe from "stripe";
import { withScope } from "@/server/db/tenant";
import { enqueue } from "@/server/jobs/queue";
import type { JobContext } from "@/server/jobs/registry";
import { integrationConnections, webhookEvents, type Provider } from "./schema";

/**
 * Stores a verified delivery exactly once (provider event id per connection) and queues it.
 * Returns duplicate=true for redeliveries, which are acknowledged without reprocessing.
 */
export async function recordWebhook(orgId: string, e: { connectionId: string; provider: Provider; providerEventId: string; topic: string; payload: Record<string, unknown> }) {
  return withScope({ orgId }, async (tx) => {
    const [row] = await tx
      .insert(webhookEvents)
      .values({ organizationId: orgId, connectionId: e.connectionId, provider: e.provider, providerEventId: e.providerEventId, topic: e.topic, signatureVerified: true, payload: e.payload })
      .onConflictDoNothing()
      .returning({ id: webhookEvents.id });
    if (!row) return { duplicate: true as const, id: null };
    await enqueue(tx, orgId, "integration.webhook", { webhookEventId: row.id }, { idempotencyKey: `webhook:${row.id}`, maxAttempts: 6 });
    return { duplicate: false as const, id: row.id };
  });
}

export async function processWebhookJob(job: JobContext) {
  const id = String(job.payload.webhookEventId);
  try {
    await withScope({ orgId: job.orgId }, async (tx) => {
      const [ev] = await tx.select().from(webhookEvents).where(and(eq(webhookEvents.organizationId, job.orgId), eq(webhookEvents.id, id))).for("update");
      if (!ev || ev.status === "processed" || ev.status === "ignored") return;
      const [conn] = await tx.select({ id: integrationConnections.id, status: integrationConnections.status }).from(integrationConnections).where(eq(integrationConnections.id, ev.connectionId));
      let outcome: "processed" | "ignored" = "ignored";
      if (conn && conn.status !== "disconnected") {
        if (ev.provider === "stripe") {
          const { applyStripeEvent } = await import("./stripe");
          outcome = await applyStripeEvent(tx, job.orgId, ev.connectionId, ev.payload as unknown as Stripe.Event);
        } else if (ev.provider === "shopify") {
          const { applyShopifyWebhook } = await import("./shopify/sync");
          outcome = await applyShopifyWebhook(tx, job.orgId, ev.connectionId, ev.topic, ev.payload);
        }
      }
      await tx.update(webhookEvents).set({ status: outcome, attempts: ev.attempts + 1, processedAt: new Date(), error: null }).where(eq(webhookEvents.id, id));
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await withScope({ orgId: job.orgId }, (tx) => tx.update(webhookEvents).set({ status: "failed", error: msg.slice(0, 2000), attempts: job.attempt }).where(eq(webhookEvents.id, id)));
    throw err; // the job retries with backoff; a later success overwrites the failure
  }
}
