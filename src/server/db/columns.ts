import { timestamp, uuid } from "drizzle-orm/pg-core";
import { newId } from "@/lib/ids";

/** Primary key: app-generated UUIDv7 (time ordered, index friendly). */
export const id = () => uuid("id").primaryKey().$defaultFn(newId);

/** Tenant column. Every org-owned table has it, plus UNIQUE (organization_id, id). */
export const organizationId = () => uuid("organization_id").notNull();

export const createdAt = () =>
  timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();

export const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow()
    .$onUpdateFn(() => new Date());

export const tsz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
