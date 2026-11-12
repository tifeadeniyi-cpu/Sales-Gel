import { and, eq, inArray } from "drizzle-orm";
import type { Tx } from "@/server/db/client";
import { orders } from "./schema";

/** Customer-merge mover: the merged customer's orders move to the survivor; undo moves them back. */
export const ordersMergeMover = {
  key: "orders",
  async move(tx: Tx, orgId: string, from: string, to: string) {
    const rows = await tx
      .update(orders)
      .set({ customerId: to })
      .where(and(eq(orders.organizationId, orgId), eq(orders.customerId, from)))
      .returning({ id: orders.id });
    return rows.map((r) => r.id);
  },
  async restore(tx: Tx, orgId: string, ids: string[], to: string) {
    if (!ids.length) return;
    await tx.update(orders).set({ customerId: to }).where(and(eq(orders.organizationId, orgId), inArray(orders.id, ids)));
  },
};
