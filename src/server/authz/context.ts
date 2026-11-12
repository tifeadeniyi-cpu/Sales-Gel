import "server-only";
import { and, eq } from "drizzle-orm";
import { memberships, organizations, rolePermissions, roles } from "@/domains/identity/schema";
import { withScope } from "@/server/db/tenant";
import { ALL_PERMISSIONS, isPermission, type Permission } from "./catalog";

export interface OrgContext {
  orgId: string;
  orgSlug: string;
  orgName: string;
  timezone: string;
  defaultCurrency: string;
  userId: string;
  membershipId: string;
  roleId: string;
  roleKey: string;
  roleName: string;
  permissions: ReadonlySet<Permission>;
  /** Request metadata for audit logs. */
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Resolves the caller's active membership in the org identified by `slug`.
 * Returns null when the org doesn't exist OR the user isn't an active member, so
 * callers can respond 404 and avoid revealing which org slugs exist.
 */
export async function loadOrgContext(userId: string, slug: string): Promise<OrgContext | null> {
  const row = await withScope({ userId }, async (tx) => {
    const [found] = await tx
      .select({
        orgId: organizations.id,
        orgSlug: organizations.slug,
        orgName: organizations.name,
        timezone: organizations.timezone,
        defaultCurrency: organizations.defaultCurrency,
        orgStatus: organizations.status,
        membershipId: memberships.id,
        roleId: memberships.roleId,
      })
      .from(organizations)
      .innerJoin(memberships, eq(memberships.organizationId, organizations.id))
      .where(and(eq(organizations.slug, slug), eq(memberships.userId, userId), eq(memberships.status, "active")))
      .limit(1);
    return found;
  });
  if (!row || row.orgStatus !== "active") return null;

  return withScope({ orgId: row.orgId, userId }, async (tx) => {
    const [role] = await tx.select().from(roles).where(eq(roles.id, row.roleId));
    if (!role) return null;
    let perms: Permission[];
    if (role.key === "owner" && role.isSystem) {
      perms = ALL_PERMISSIONS;
    } else {
      const rows = await tx
        .select({ key: rolePermissions.permissionKey })
        .from(rolePermissions)
        .where(eq(rolePermissions.roleId, role.id));
      perms = rows.map((r) => r.key).filter(isPermission);
    }
    return {
      orgId: row.orgId,
      orgSlug: row.orgSlug,
      orgName: row.orgName,
      timezone: row.timezone,
      defaultCurrency: row.defaultCurrency,
      userId,
      membershipId: row.membershipId,
      roleId: role.id,
      roleKey: role.key,
      roleName: role.name,
      permissions: new Set(perms),
    } satisfies OrgContext;
  });
}

export { authorize, can, canAny, canReadRecord } from "./guards";
