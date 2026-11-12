import { and, eq, inArray } from "drizzle-orm";
import type { Tx } from "@/server/db/client";
import { supportTickets } from "./schema";

/** Customer-merge mover: tickets follow the surviving customer; undo moves them back. */
export const ticketsMergeMover = {
  key: "tickets",
  async move(tx: Tx, orgId: string, from: string, to: string) {
    const rows = await tx.update(supportTickets).set({ customerId: to }).where(and(eq(supportTickets.organizationId, orgId), eq(supportTickets.customerId, from))).returning({ id: supportTickets.id });
    return rows.map((r) => r.id);
  },
  async restore(tx: Tx, orgId: string, ids: string[], to: string) {
    if (!ids.length) return;
    await tx.update(supportTickets).set({ customerId: to }).where(and(eq(supportTickets.organizationId, orgId), inArray(supportTickets.id, ids)));
  },
};
