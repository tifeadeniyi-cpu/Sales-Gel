import "server-only";
import { after } from "next/server";
import { logger } from "@/server/logger";
import { runDueWork } from "./worker";

/**
 * Drains a workspace's due background work after the current response is sent.
 * Keeps reminders and webhook processing timely without depending on frequent cron runs
 * (the daily cron is the safety net).
 */
export function kickWorker(orgId: string, budgetMs = 8_000) {
  if (process.env.WORKER_INLINE === "off") return;
  after(async () => {
    try {
      await runDueWork({ orgId, budgetMs, maxOrgs: 1 });
    } catch (err) {
      logger.warn({ orgId, err: err instanceof Error ? err.message : String(err) }, "inline worker run failed");
    }
  });
}
