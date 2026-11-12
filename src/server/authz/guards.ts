import { ForbiddenError } from "@/server/errors";
import type { Permission } from "./catalog";

export function can(ctx: { permissions: ReadonlySet<Permission> }, permission: Permission): boolean {
  return ctx.permissions.has(permission);
}

export function canAny(ctx: { permissions: ReadonlySet<Permission> }, ...permissions: Permission[]): boolean {
  return permissions.some((p) => ctx.permissions.has(p));
}

export function authorize(ctx: { permissions: ReadonlySet<Permission> }, ...required: Permission[]): void {
  for (const p of required) {
    if (!ctx.permissions.has(p)) throw new ForbiddenError(undefined, p);
  }
}

type ScopedResource = "customers" | "leads" | "conversations" | "tickets";

/** Read access to a single record honoring `read` (all) vs `read_assigned` (own) scopes. */
export function canReadRecord(
  ctx: { permissions: ReadonlySet<Permission>; membershipId: string },
  resource: ScopedResource,
  record: { ownerMembershipId?: string | null; assigneeMembershipId?: string | null },
): boolean {
  if (ctx.permissions.has(`${resource}.read` as Permission)) return true;
  if (ctx.permissions.has(`${resource}.read_assigned` as Permission)) {
    return record.ownerMembershipId === ctx.membershipId || record.assigneeMembershipId === ctx.membershipId;
  }
  return false;
}
