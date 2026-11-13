import "server-only";
import { and, desc, eq, ne } from "drizzle-orm";
import type { OrgContext } from "@/server/authz/context";
import { decryptJson, encryptJson } from "@/server/crypto";
import type { Tx } from "@/server/db/client";
import { db } from "@/server/db/client";
import { withScope, withTenant } from "@/server/db/tenant";
import { ForbiddenError } from "@/server/errors";
import { integrationConnections, integrationRoutes, jobs, paymentLinks, webhookEvents, type Provider } from "./schema";

export function canManageIntegrations(ctx: OrgContext) {
  return ctx.permissions.has("integrations.manage");
}
export function needManage(ctx: OrgContext) {
  if (!canManageIntegrations(ctx)) throw new ForbiddenError(undefined, "integrations.manage");
}

/** Public view of a connection — never includes credentials. */
export async function listConnections(ctx: OrgContext) {
  if (!ctx.permissions.has("integrations.read") && !canManageIntegrations(ctx)) throw new ForbiddenError(undefined, "integrations.read");
  return withTenant(ctx, async (tx) => {
    const rows = await tx
      .select({
        id: integrationConnections.id, provider: integrationConnections.provider, status: integrationConnections.status, externalAccountId: integrationConnections.externalAccountId,
        displayName: integrationConnections.displayName, settings: integrationConnections.settings, lastSyncAt: integrationConnections.lastSyncAt, lastError: integrationConnections.lastError,
        createdAt: integrationConnections.createdAt,
      })
      .from(integrationConnections)
      .where(and(eq(integrationConnections.organizationId, ctx.orgId), ne(integrationConnections.status, "disconnected")));
    const recentEvents = await tx
      .select({ id: webhookEvents.id, provider: webhookEvents.provider, topic: webhookEvents.topic, status: webhookEvents.status, error: webhookEvents.error, receivedAt: webhookEvents.receivedAt })
      .from(webhookEvents)
      .where(eq(webhookEvents.organizationId, ctx.orgId))
      .orderBy(desc(webhookEvents.receivedAt))
      .limit(15);
    const recentJobs = await tx
      .select({ id: jobs.id, type: jobs.type, status: jobs.status, attempts: jobs.attempts, lastError: jobs.lastError, runAt: jobs.runAt, finishedAt: jobs.finishedAt })
      .from(jobs)
      .where(and(eq(jobs.organizationId, ctx.orgId), ne(jobs.type, "task.reminder")))
      .orderBy(desc(jobs.createdAt))
      .limit(10);
    return { connections: rows, recentEvents, recentJobs };
  });
}

export async function activeConnection(tx: Tx, orgId: string, provider: Provider) {
  const [c] = await tx
    .select()
    .from(integrationConnections)
    .where(and(eq(integrationConnections.organizationId, orgId), eq(integrationConnections.provider, provider), ne(integrationConnections.status, "disconnected")));
  return c ?? null;
}

export function credentialsOf<T>(c: { credentials: string }) {
  return decryptJson<T>(c.credentials);
}

/** Creates or replaces the workspace's connection for a provider, plus its webhook route. */
export async function upsertConnection(
  tx: Tx,
  orgId: string,
  input: { id?: string; provider: Provider; externalAccountId: string; displayName: string; credentials: unknown; scopes?: string[]; settings?: Record<string, unknown>; userId: string | null },
) {
  const existing = await activeConnection(tx, orgId, input.provider);
  let id: string;
  if (existing) {
    await tx
      .update(integrationConnections)
      .set({ externalAccountId: input.externalAccountId, displayName: input.displayName, credentials: encryptJson(input.credentials), scopes: input.scopes ?? [], settings: { ...(existing.settings ?? {}), ...(input.settings ?? {}) }, status: "active", lastError: null, updatedAt: new Date() })
      .where(eq(integrationConnections.id, existing.id));
    id = existing.id;
  } else {
    const [row] = await tx
      .insert(integrationConnections)
      .values({ ...(input.id ? { id: input.id } : {}), organizationId: orgId, provider: input.provider, externalAccountId: input.externalAccountId, displayName: input.displayName, credentials: encryptJson(input.credentials), scopes: input.scopes ?? [], settings: input.settings ?? {}, connectedByUserId: input.userId })
      .returning({ id: integrationConnections.id });
    id = row.id;
  }
  await tx.delete(integrationRoutes).where(eq(integrationRoutes.connectionId, id));
  await tx.delete(integrationRoutes).where(and(eq(integrationRoutes.provider, input.provider), eq(integrationRoutes.externalAccountId, input.externalAccountId)));
  await tx.insert(integrationRoutes).values({ provider: input.provider, externalAccountId: input.externalAccountId, connectionId: id, organizationId: orgId });
  return id;
}

export async function updateConnectionCredentials(tx: Tx, connectionId: string, credentials: unknown) {
  await tx.update(integrationConnections).set({ credentials: encryptJson(credentials), updatedAt: new Date() }).where(eq(integrationConnections.id, connectionId));
}

export async function markConnectionError(orgId: string, connectionId: string, message: string) {
  await withScope({ orgId }, (tx) => tx.update(integrationConnections).set({ status: "error", lastError: message.slice(0, 1000), updatedAt: new Date() }).where(eq(integrationConnections.id, connectionId)));
}

export async function markDisconnected(tx: Tx, connectionId: string) {
  const [c] = await tx
    .update(integrationConnections)
    .set({ status: "disconnected", disconnectedAt: new Date(), updatedAt: new Date() })
    .where(eq(integrationConnections.id, connectionId))
    .returning({ provider: integrationConnections.provider });
  // Shopify keeps its route: privacy (compliance) webhooks keep arriving after uninstall and must still be honoured.
  if (c?.provider !== "shopify") await tx.delete(integrationRoutes).where(eq(integrationRoutes.connectionId, connectionId));
  await tx.update(paymentLinks).set({ status: "cancelled", updatedAt: new Date() }).where(and(eq(paymentLinks.connectionId, connectionId), eq(paymentLinks.status, "open")));
}

/** Resolves which workspace a webhook belongs to — before any tenant data is read. */
export async function resolveRoute(provider: Provider, by: { connectionId?: string; externalAccountId?: string }) {
  const [r] = await db
    .select()
    .from(integrationRoutes)
    .where(and(eq(integrationRoutes.provider, provider), by.connectionId ? eq(integrationRoutes.connectionId, by.connectionId) : eq(integrationRoutes.externalAccountId, by.externalAccountId ?? "")));
  return r ?? null;
}
