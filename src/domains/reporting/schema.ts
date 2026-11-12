import { type AnyPgColumn, foreignKey, jsonb, pgTable, text, unique, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "@/domains/identity/schema";
import { user } from "@/server/auth/schema";
import { createdAt, id, organizationId, updatedAt } from "@/server/db/columns";

const orgFk = (name: string, t: { organizationId: AnyPgColumn }) =>
  foreignKey({ name, columns: [t.organizationId], foreignColumns: [organizations.id] }).onDelete("cascade");

export interface DashboardWidgetPref { key: string; visible: boolean; width: "half" | "full" }

/** Dashboard layouts: one personal layout per member, plus an optional workspace default (user_id null). */
export const dashboardLayouts = pgTable(
  "dashboard_layouts",
  {
    id: id(),
    organizationId: organizationId(),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    widgets: jsonb("widgets").$type<DashboardWidgetPref[]>().notNull(),
    updatedByUserId: text("updated_by_user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("dashboard_layouts_org_id_uq").on(t.organizationId, t.id),
    uniqueIndex("dashboard_layouts_user_uq").on(t.organizationId, t.userId).where(sql`${t.userId} is not null`),
    uniqueIndex("dashboard_layouts_default_uq").on(t.organizationId).where(sql`${t.userId} is null`),
    orgFk("dashboard_layouts_org_fk", t),
  ],
);
