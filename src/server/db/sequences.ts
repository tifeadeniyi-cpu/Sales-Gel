import "server-only";
import { sql } from "drizzle-orm";
import { orgSequences } from "@/domains/identity/schema";
import type { Tx } from "./client";

/** Allocates the next per-org number for `key` (row-locked, gap-free within committed transactions). */
export async function nextNumber(tx: Tx, orgId: string, key: string, start = 1001): Promise<number> {
  const [row] = await tx
    .insert(orgSequences)
    .values({ organizationId: orgId, key, nextValue: start + 1 })
    .onConflictDoUpdate({
      target: [orgSequences.organizationId, orgSequences.key],
      set: { nextValue: sql`${orgSequences.nextValue} + 1` },
    })
    .returning({ next: orgSequences.nextValue });
  return row.next - 1;
}
