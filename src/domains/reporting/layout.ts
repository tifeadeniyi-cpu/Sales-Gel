import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { audit } from "@/server/audit/audit";
import type { OrgContext } from "@/server/authz/context";
import { withTenant } from "@/server/db/tenant";
import { ForbiddenError } from "@/server/errors";
import { parseInput } from "@/server/validate";
import { dashboardLayouts } from "./schema";
import { DEFAULT_LAYOUT, normalizeLayout, WIDGETS, type WidgetPref } from "./widgets";

const layoutSchema = z
  .array(z.object({ key: z.enum(WIDGETS.map((w) => w.key) as [string, ...string[]]), visible: z.boolean(), width: z.enum(["half", "full"]) }))
  .max(WIDGETS.length)
  .refine((a) => new Set(a.map((x) => x.key)).size === a.length, "Each widget can appear once");

/** Personal layout → workspace default → built-in default. */
export async function getDashboardLayout(ctx: OrgContext) {
  return withTenant(ctx, async (tx) => {
    const rows = await tx.select().from(dashboardLayouts).where(eq(dashboardLayouts.organizationId, ctx.orgId));
    const mine = rows.find((r) => r.userId === ctx.userId);
    const workspace = rows.find((r) => r.userId === null);
    const source: "personal" | "workspace" | "default" = mine ? "personal" : workspace ? "workspace" : "default";
    return { widgets: normalizeLayout(mine?.widgets ?? workspace?.widgets ?? DEFAULT_LAYOUT), source, hasWorkspaceDefault: !!workspace };
  });
}

export async function saveDashboardLayout(ctx: OrgContext, input: WidgetPref[], scope: "personal" | "workspace") {
  if (scope === "workspace" && !ctx.permissions.has("org.settings.manage")) throw new ForbiddenError("Only administrators can set the workspace default.");
  const widgets = normalizeLayout(parseInput(layoutSchema, input));
  return withTenant(ctx, async (tx) => {
    const userId = scope === "personal" ? ctx.userId : null;
    const where = and(eq(dashboardLayouts.organizationId, ctx.orgId), userId ? eq(dashboardLayouts.userId, userId) : isNull(dashboardLayouts.userId));
    const [existing] = await tx.select({ id: dashboardLayouts.id }).from(dashboardLayouts).where(where);
    if (existing) await tx.update(dashboardLayouts).set({ widgets, updatedByUserId: ctx.userId, updatedAt: new Date() }).where(eq(dashboardLayouts.id, existing.id));
    else await tx.insert(dashboardLayouts).values({ organizationId: ctx.orgId, userId, widgets, updatedByUserId: ctx.userId });
    if (scope === "workspace") await audit(tx, ctx, { action: "dashboard.default_saved", entityType: "organization", entityId: ctx.orgId });
    return widgets;
  });
}

/** Drops the personal layout so the workspace default (or built-in) applies again. */
export async function resetDashboardLayout(ctx: OrgContext) {
  return withTenant(ctx, async (tx) => {
    await tx.delete(dashboardLayouts).where(and(eq(dashboardLayouts.organizationId, ctx.orgId), eq(dashboardLayouts.userId, ctx.userId)));
  });
}
