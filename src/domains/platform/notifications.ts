import "server-only";
import { and, count, desc, eq, isNull, lt } from "drizzle-orm";
import type { OrgContext } from "@/server/authz/context";
import type { Tx } from "@/server/db/client";
import { withTenant } from "@/server/db/tenant";
import { notificationPreferences, notifications } from "./schema";

/** Event types users can configure. Later phases append to this list. */
export const NOTIFICATION_EVENTS = {
  "member.joined": "Someone accepts your invitation",
  "member.role_changed": "Your role changes",
  "customer.assigned": "A customer is assigned to you",
  "lead.assigned": "A lead is assigned to you",
  "task.assigned": "A task is assigned to you",
  "task.due": "A task assigned to you is due (reminder)",
  "task.overdue": "A task assigned to you becomes overdue",
  "payment.received": "A customer pays through a payment link",
  "mention": "You're mentioned in a comment",
  "conversation.assigned": "A conversation is assigned to you",
  "conversation.message": "A customer messages in a conversation assigned to you",
  "ticket.assigned": "A ticket is assigned to you",
  "ticket.escalated": "A ticket is escalated",
  "sla.warning": "An SLA is about to breach",
  "automation.failed": "An automation fails",
  "integration.error": "An integration reports an error",
} as const;
export type NotificationEvent = keyof typeof NOTIFICATION_EVENTS;

/**
 * Creates an in-app notification inside the caller's transaction, honoring the
 * recipient's preference for this event type (in-app is on by default).
 * Email delivery is queued in a later phase once an email provider is connected.
 */
export async function notify(
  tx: Tx,
  n: { orgId: string; recipientUserId: string; type: string; title: string; body?: string; link?: string; entityType?: string; entityId?: string },
): Promise<boolean> {
  const [pref] = await tx
    .select({ inApp: notificationPreferences.inApp })
    .from(notificationPreferences)
    .where(
      and(
        eq(notificationPreferences.organizationId, n.orgId),
        eq(notificationPreferences.userId, n.recipientUserId),
        eq(notificationPreferences.eventType, n.type),
      ),
    );
  if (pref && !pref.inApp) return false;
  await tx.insert(notifications).values({
    organizationId: n.orgId,
    recipientUserId: n.recipientUserId,
    type: n.type,
    title: n.title,
    body: n.body ?? null,
    link: n.link ?? null,
    entityType: n.entityType ?? null,
    entityId: n.entityId ?? null,
  });
  return true;
}

export async function listNotifications(ctx: OrgContext, opts: { unreadOnly?: boolean; limit?: number; before?: Date } = {}) {
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);
  return withTenant(ctx, (tx) =>
    tx
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.organizationId, ctx.orgId),
          eq(notifications.recipientUserId, ctx.userId),
          opts.unreadOnly ? isNull(notifications.readAt) : undefined,
          opts.before ? lt(notifications.createdAt, opts.before) : undefined,
        ),
      )
      .orderBy(desc(notifications.createdAt))
      .limit(limit),
  );
}

export async function unreadNotificationCount(ctx: OrgContext): Promise<number> {
  return withTenant(ctx, async (tx) => {
    const [row] = await tx
      .select({ n: count() })
      .from(notifications)
      .where(and(eq(notifications.organizationId, ctx.orgId), eq(notifications.recipientUserId, ctx.userId), isNull(notifications.readAt)));
    return row?.n ?? 0;
  });
}

/** Marks one (or all, when id omitted) of the caller's notifications read. Never touches others' notifications. */
export async function markNotificationsRead(ctx: OrgContext, id?: string) {
  return withTenant(ctx, async (tx) => {
    const res = await tx
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.organizationId, ctx.orgId),
          eq(notifications.recipientUserId, ctx.userId),
          isNull(notifications.readAt),
          id ? eq(notifications.id, id) : undefined,
        ),
      )
      .returning({ id: notifications.id });
    return res.length;
  });
}

export async function getNotificationPreferences(ctx: OrgContext) {
  const rows = await withTenant(ctx, (tx) =>
    tx
      .select()
      .from(notificationPreferences)
      .where(and(eq(notificationPreferences.organizationId, ctx.orgId), eq(notificationPreferences.userId, ctx.userId))),
  );
  return (Object.keys(NOTIFICATION_EVENTS) as NotificationEvent[]).map((event) => {
    const row = rows.find((r) => r.eventType === event);
    return { event, label: NOTIFICATION_EVENTS[event], inApp: row?.inApp ?? true, email: row?.email ?? false };
  });
}

export async function setNotificationPreference(ctx: OrgContext, event: string, value: { inApp: boolean; email: boolean }) {
  if (!(event in NOTIFICATION_EVENTS)) throw new Error("Unknown notification event");
  await withTenant(ctx, (tx) =>
    tx
      .insert(notificationPreferences)
      .values({ organizationId: ctx.orgId, userId: ctx.userId, eventType: event, inApp: value.inApp, email: value.email })
      .onConflictDoUpdate({
        target: [notificationPreferences.organizationId, notificationPreferences.userId, notificationPreferences.eventType],
        set: { inApp: value.inApp, email: value.email, updatedAt: new Date() },
      }),
  );
}
