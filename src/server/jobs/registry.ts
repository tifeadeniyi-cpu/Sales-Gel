import "server-only";

export interface JobContext { orgId: string; jobId: string; payload: Record<string, unknown>; attempt: number }
export type JobHandler = (job: JobContext) => Promise<void>;
export type OutboxListener = (e: { orgId: string; payload: Record<string, unknown> }) => Promise<void>;

/** Job handlers, loaded lazily so domain modules don't import each other at startup. */
export const JOB_HANDLERS: Record<string, JobHandler> = {
  "task.reminder": async (j) => (await import("@/domains/tasks/reminders")).runTaskReminder(j),
  "integration.webhook": async (j) => (await import("@/domains/integrations/webhooks")).processWebhookJob(j),
  "shopify.sync": async (j) => (await import("@/domains/integrations/shopify/sync")).runShopifySync(j),
  "support.sla_check": async (job) => (await import("@/domains/support/sla")).runSlaCheck(job),
  "shopify.setup": async (j) => (await import("@/domains/integrations/shopify/connect")).runShopifySetup(j),
};

/** Domain events relayed from the transactional outbox. Events without listeners are simply marked done. */
export const OUTBOX_LISTENERS: Record<string, OutboxListener[]> = {};
