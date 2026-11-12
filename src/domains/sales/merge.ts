import { and, eq, inArray } from "drizzle-orm";
import type { Tx } from "@/server/db/client";
import { leads } from "./schema";

/** Customer-merge mover: leads follow their customer to the surviving record. */
export const leadsMergeMover = {
  key: "leads",
  async move(tx: Tx, orgId: string, from: string, to: string) {
    const rows = await tx.update(leads).set({ customerId: to }).where(and(eq(leads.organizationId, orgId), eq(leads.customerId, from))).returning({ id: leads.id });
    return rows.map((r) => r.id);
  },
  async restore(tx: Tx, orgId: string, ids: string[], to: string) {
    if (ids.length) await tx.update(leads).set({ customerId: to }).where(and(eq(leads.organizationId, orgId), inArray(leads.id, ids)));
  },
};
