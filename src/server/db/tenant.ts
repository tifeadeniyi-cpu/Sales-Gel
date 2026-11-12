import "server-only";
import { sql } from "drizzle-orm";
import { db, type Tx } from "./client";

export interface DbScope {
  orgId?: string | null;
  userId?: string | null;
  inviteTokenHash?: string | null;
}

/**
 * Runs `fn` in a transaction with the RLS session variables set (transaction-local).
 * Every tenant read/write must go through this. Queries that forget an
 * organization filter still cannot see another tenant's rows.
 */
export async function withScope<T>(scope: DbScope, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`
      select
        set_config('app.org_id', ${scope.orgId ?? ""}, true),
        set_config('app.user_id', ${scope.userId ?? ""}, true),
        set_config('app.invite_token_hash', ${scope.inviteTokenHash ?? ""}, true)
    `);
    return fn(tx);
  });
}

/** Org-scoped transaction for an authenticated member. */
export function withTenant<T>(ctx: { orgId: string; userId: string }, fn: (tx: Tx) => Promise<T>) {
  return withScope({ orgId: ctx.orgId, userId: ctx.userId }, fn);
}
