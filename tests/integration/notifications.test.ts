import { describe, expect, it } from "vitest";
import {
  getNotificationPreferences,
  listNotifications,
  markNotificationsRead,
  notify,
  setNotificationPreference,
  unreadNotificationCount,
} from "@/domains/platform/notifications";
import { withTenant } from "@/server/db/tenant";
import { addMember, createOrgWithOwner } from "../support/factories";

describe("notifications", () => {
  it("delivers, counts and marks read only the recipient's notifications", async () => {
    const { ctx } = await createOrgWithOwner("Notify");
    const { ctx: rep } = await addMember(ctx, "sales_rep");
    await withTenant(ctx, async (tx) => {
      await notify(tx, { orgId: ctx.orgId, recipientUserId: rep.userId, type: "task.assigned", title: "Call back Ada" });
      await notify(tx, { orgId: ctx.orgId, recipientUserId: rep.userId, type: "lead.assigned", title: "New lead" });
    });
    expect(await unreadNotificationCount(rep)).toBe(2);

    // The owner marking "all read" must not touch the rep's notifications.
    await markNotificationsRead(ctx);
    expect(await unreadNotificationCount(rep)).toBe(2);

    const [first] = await listNotifications(rep);
    expect(await markNotificationsRead(ctx, first.id)).toBe(0);
    expect(await markNotificationsRead(rep, first.id)).toBe(1);
    expect(await unreadNotificationCount(rep)).toBe(1);
    expect(await markNotificationsRead(rep)).toBe(1);
    expect(await unreadNotificationCount(rep)).toBe(0);
  });

  it("respects in-app preferences", async () => {
    const { ctx } = await createOrgWithOwner("Prefs");
    await setNotificationPreference(ctx, "task.assigned", { inApp: false, email: false });
    const prefs = await getNotificationPreferences(ctx);
    expect(prefs.find((p) => p.event === "task.assigned")?.inApp).toBe(false);
    const delivered = await withTenant(ctx, (tx) =>
      notify(tx, { orgId: ctx.orgId, recipientUserId: ctx.userId, type: "task.assigned", title: "Muted" }),
    );
    expect(delivered).toBe(false);
    expect(await unreadNotificationCount(ctx)).toBe(0);
  });

  it("notifications are tenant isolated", async () => {
    const a = await createOrgWithOwner("NotifA");
    const b = await createOrgWithOwner("NotifB");
    await withTenant(a.ctx, (tx) => notify(tx, { orgId: a.ctx.orgId, recipientUserId: a.ctx.userId, type: "mention", title: "A only" }));
    expect(await listNotifications(b.ctx)).toHaveLength(0);
    // Even writing a notification for org B from org A's scope fails.
    await expect(
      withTenant(a.ctx, (tx) => notify(tx, { orgId: b.ctx.orgId, recipientUserId: b.ctx.userId, type: "mention", title: "leak" })),
    ).rejects.toThrow();
  });
});
