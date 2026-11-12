import "server-only";
import { and, asc, count, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { user } from "@/server/auth/schema";
import { audit, diff, emit } from "@/server/audit/audit";
import { SYSTEM_ROLES, type Permission, type SystemRoleKey } from "@/server/authz/catalog";
import { authorize, type OrgContext } from "@/server/authz/context";
import type { Tx } from "@/server/db/client";
import { isUniqueViolation } from "@/server/db/errors";
import { withScope, withTenant } from "@/server/db/tenant";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { parseInput } from "@/server/validate";
import { newId } from "@/lib/ids";
import { randomToken, sha256 } from "@/lib/crypto";
import { notify } from "@/domains/platform/notifications";
import { ensureDefaultPipeline } from "@/domains/sales/service";
import {
  invitations,
  memberships,
  organizations,
  rolePermissions,
  roles,
  teamMembers,
  teams,
} from "./schema";
import {
  changeRoleSchema,
  createOrganizationSchema,
  inviteMemberSchema,
  roleSchema,
  teamSchema,
  updateOrganizationSchema,
  type CreateOrganizationInput,
  type UpdateOrganizationInput,
} from "./validation";

const INVITE_TTL_DAYS = 7;

interface Actor {
  id: string;
  email: string;
}

/* ───────────────────────── Organizations ───────────────────────── */

async function seedSystemRoles(tx: Tx, orgId: string) {
  const ids = {} as Record<SystemRoleKey, string>;
  for (const [key, def] of Object.entries(SYSTEM_ROLES) as [SystemRoleKey, (typeof SYSTEM_ROLES)[SystemRoleKey]][]) {
    const roleId = newId();
    ids[key] = roleId;
    await tx.insert(roles).values({
      id: roleId,
      organizationId: orgId,
      key,
      name: def.name,
      description: def.description,
      isSystem: true,
    });
    if (def.permissions.length) {
      await tx
        .insert(rolePermissions)
        .values(def.permissions.map((p) => ({ organizationId: orgId, roleId, permissionKey: p })));
    }
  }
  return ids;
}

export async function createOrganization(actor: Actor, input: CreateOrganizationInput) {
  const data = parseInput(createOrganizationSchema, input);
  const orgId = newId();
  try {
    return await withScope({ orgId, userId: actor.id }, async (tx) => {
      await tx.insert(organizations).values({
        id: orgId,
        slug: data.slug,
        name: data.name,
        businessType: data.businessType ?? null,
        timezone: data.timezone,
        defaultCurrency: data.defaultCurrency,
        createdByUserId: actor.id,
      });
      const roleIds = await seedSystemRoles(tx, orgId);
      const membershipId = newId();
      await tx.insert(memberships).values({
        id: membershipId,
        organizationId: orgId,
        userId: actor.id,
        roleId: roleIds.owner,
      });
      await ensureDefaultPipeline(tx, orgId);
      const ctx = { orgId, userId: actor.id };
      await audit(tx, ctx, { action: "organization.created", entityType: "organization", entityId: orgId, metadata: { name: data.name, slug: data.slug } });
      await emit(tx, orgId, "organization.created", { organizationId: orgId });
      return { id: orgId, slug: data.slug };
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ValidationError("That workspace URL is taken.", { slug: ["That workspace URL is taken — try another."] });
    }
    throw err;
  }
}

export async function listMyOrganizations(userId: string) {
  return withScope({ userId }, (tx) =>
    tx
      .select({ id: organizations.id, slug: organizations.slug, name: organizations.name, roleId: memberships.roleId })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
      .where(and(eq(memberships.userId, userId), eq(memberships.status, "active"), eq(organizations.status, "active")))
      .orderBy(asc(organizations.name)),
  );
}

export async function getOrganization(ctx: OrgContext) {
  return withTenant(ctx, async (tx) => {
    const [org] = await tx.select().from(organizations).where(eq(organizations.id, ctx.orgId));
    if (!org) throw new NotFoundError();
    return org;
  });
}

export async function updateOrganization(ctx: OrgContext, input: UpdateOrganizationInput) {
  authorize(ctx, "org.settings.manage");
  const data = parseInput(updateOrganizationSchema, input);
  return withTenant(ctx, async (tx) => {
    const [before] = await tx.select().from(organizations).where(eq(organizations.id, ctx.orgId)).for("update");
    if (!before) throw new NotFoundError();
    const [after] = await tx.update(organizations).set(data).where(eq(organizations.id, ctx.orgId)).returning();
    const changes = diff(before, data);
    if (Object.keys(changes).length) {
      await audit(tx, ctx, { action: "organization.updated", entityType: "organization", entityId: ctx.orgId, changes });
    }
    return after;
  });
}

/* ───────────────────────── Members ───────────────────────── */

export async function listMembers(ctx: OrgContext) {
  authorize(ctx, "members.read");
  return withTenant(ctx, async (tx) => {
    const rows = await tx
      .select({
        membershipId: memberships.id,
        userId: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
        status: memberships.status,
        joinedAt: memberships.joinedAt,
        roleId: roles.id,
        roleKey: roles.key,
        roleName: roles.name,
      })
      .from(memberships)
      .innerJoin(user, eq(user.id, memberships.userId))
      .innerJoin(roles, and(eq(roles.id, memberships.roleId), eq(roles.organizationId, memberships.organizationId)))
      .where(eq(memberships.organizationId, ctx.orgId))
      .orderBy(asc(memberships.status), asc(user.name));
    const teamRows = await tx
      .select({ membershipId: teamMembers.membershipId, teamId: teams.id, teamName: teams.name })
      .from(teamMembers)
      .innerJoin(teams, eq(teams.id, teamMembers.teamId))
      .where(eq(teamMembers.organizationId, ctx.orgId));
    return rows.map((r) => ({
      ...r,
      teams: teamRows.filter((t) => t.membershipId === r.membershipId).map((t) => ({ id: t.teamId, name: t.teamName })),
    }));
  });
}

async function loadMembership(tx: Tx, ctx: OrgContext, membershipId: string) {
  const [m] = await tx
    .select({ id: memberships.id, userId: memberships.userId, status: memberships.status, roleId: memberships.roleId, roleKey: roles.key, roleName: roles.name })
    .from(memberships)
    .innerJoin(roles, eq(roles.id, memberships.roleId))
    .where(and(eq(memberships.id, membershipId), eq(memberships.organizationId, ctx.orgId)))
    .for("update", { of: memberships });
  if (!m) throw new NotFoundError("Member not found.");
  return m;
}

async function loadRole(tx: Tx, ctx: OrgContext, roleId: string) {
  const [r] = await tx.select().from(roles).where(and(eq(roles.id, roleId), eq(roles.organizationId, ctx.orgId)));
  if (!r) throw new ValidationError("Choose a valid role.", { roleId: ["Choose a valid role."] });
  return r;
}

/** Throws if the change would leave the org without an active Owner. */
async function assertOwnerRemains(tx: Tx, ctx: OrgContext, excludingMembershipId: string) {
  const [{ n }] = await tx
    .select({ n: count() })
    .from(memberships)
    .innerJoin(roles, eq(roles.id, memberships.roleId))
    .where(
      and(
        eq(memberships.organizationId, ctx.orgId),
        eq(roles.key, "owner"),
        eq(roles.isSystem, true),
        eq(memberships.status, "active"),
        ne(memberships.id, excludingMembershipId),
      ),
    );
  if (n === 0) throw new ConflictError("An organization must keep at least one active Owner.");
}

function assertCanTouchOwner(ctx: OrgContext, targetRoleKey: string) {
  if (targetRoleKey === "owner" && ctx.roleKey !== "owner") {
    throw new ForbiddenError("Only an Owner can change another Owner or grant the Owner role.");
  }
}

export async function changeMemberRole(ctx: OrgContext, input: { membershipId: string; roleId: string }) {
  authorize(ctx, "members.manage");
  const data = parseInput(changeRoleSchema, input);
  return withTenant(ctx, async (tx) => {
    const member = await loadMembership(tx, ctx, data.membershipId);
    const role = await loadRole(tx, ctx, data.roleId);
    if (member.roleId === role.id) return;
    assertCanTouchOwner(ctx, member.roleKey);
    assertCanTouchOwner(ctx, role.key);
    if (member.roleKey === "owner") await assertOwnerRemains(tx, ctx, member.id);
    await tx.update(memberships).set({ roleId: role.id }).where(eq(memberships.id, member.id));
    await audit(tx, ctx, {
      action: "member.role_changed",
      entityType: "membership",
      entityId: member.id,
      changes: { role: { from: member.roleName, to: role.name } },
    });
    if (member.userId !== ctx.userId) {
      await notify(tx, {
        orgId: ctx.orgId,
        recipientUserId: member.userId,
        type: "member.role_changed",
        title: `Your role is now ${role.name}`,
        body: `${ctx.orgName}: your access has been updated.`,
        link: `/o/${ctx.orgSlug}`,
      });
    }
  });
}

export async function setMemberStatus(ctx: OrgContext, membershipId: string, status: "active" | "deactivated") {
  authorize(ctx, "members.manage");
  return withTenant(ctx, async (tx) => {
    const member = await loadMembership(tx, ctx, membershipId);
    if (member.status === status) return;
    assertCanTouchOwner(ctx, member.roleKey);
    if (status === "deactivated") {
      if (member.userId === ctx.userId) throw new ConflictError("You can't deactivate yourself.");
      if (member.roleKey === "owner") await assertOwnerRemains(tx, ctx, member.id);
    }
    await tx
      .update(memberships)
      .set({ status, deactivatedAt: status === "deactivated" ? new Date() : null })
      .where(eq(memberships.id, member.id));
    await audit(tx, ctx, {
      action: status === "deactivated" ? "member.deactivated" : "member.reactivated",
      entityType: "membership",
      entityId: member.id,
      changes: { status: { from: member.status, to: status } },
    });
  });
}

export async function removeMember(ctx: OrgContext, membershipId: string) {
  authorize(ctx, "members.manage");
  return withTenant(ctx, async (tx) => {
    const member = await loadMembership(tx, ctx, membershipId);
    assertCanTouchOwner(ctx, member.roleKey);
    if (member.roleKey === "owner") await assertOwnerRemains(tx, ctx, member.id);
    // Phase 2+: records owned/assigned by this membership are reassigned or set null via FKs before removal.
    await tx.delete(memberships).where(eq(memberships.id, member.id));
    await audit(tx, ctx, { action: "member.removed", entityType: "membership", entityId: member.id, metadata: { userId: member.userId, role: member.roleName } });
  });
}

/* ───────────────────────── Invitations ───────────────────────── */

export async function inviteMember(ctx: OrgContext, input: { email: string; roleId: string }) {
  authorize(ctx, "members.manage");
  const data = parseInput(inviteMemberSchema, input);
  return withTenant(ctx, async (tx) => {
    const role = await loadRole(tx, ctx, data.roleId);
    assertCanTouchOwner(ctx, role.key);

    const [existingMember] = await tx
      .select({ id: memberships.id })
      .from(memberships)
      .innerJoin(user, eq(user.id, memberships.userId))
      .where(and(eq(memberships.organizationId, ctx.orgId), sql`lower(${user.email}) = ${data.email}`));
    if (existingMember) throw new ValidationError("Already a member.", { email: ["This person is already a member."] });

    // Revoke any previous pending invite for the same email, then issue a fresh one.
    await tx
      .update(invitations)
      .set({ status: "revoked" })
      .where(and(eq(invitations.organizationId, ctx.orgId), eq(invitations.email, data.email), eq(invitations.status, "pending")));

    const token = randomToken();
    const id = newId();
    await tx.insert(invitations).values({
      id,
      organizationId: ctx.orgId,
      email: data.email,
      roleId: role.id,
      tokenHash: sha256(token),
      invitedByUserId: ctx.userId,
      expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000),
    });
    await audit(tx, ctx, { action: "invitation.created", entityType: "invitation", entityId: id, metadata: { email: data.email, role: role.name } });
    await emit(tx, ctx.orgId, "invitation.created", { invitationId: id, email: data.email });
    // The raw token is returned exactly once; only its hash is stored.
    return { id, token, email: data.email, roleName: role.name };
  });
}

export async function listInvitations(ctx: OrgContext) {
  authorize(ctx, "members.read");
  return withTenant(ctx, (tx) =>
    tx
      .select({
        id: invitations.id,
        email: invitations.email,
        status: invitations.status,
        expiresAt: invitations.expiresAt,
        createdAt: invitations.createdAt,
        roleName: roles.name,
      })
      .from(invitations)
      .innerJoin(roles, eq(roles.id, invitations.roleId))
      .where(and(eq(invitations.organizationId, ctx.orgId), eq(invitations.status, "pending")))
      .orderBy(desc(invitations.createdAt)),
  ).then((rows) => {
    const now = Date.now();
    return rows.map((r) => ({ ...r, expired: r.expiresAt.getTime() < now }));
  });
}

export async function revokeInvitation(ctx: OrgContext, invitationId: string) {
  authorize(ctx, "members.manage");
  return withTenant(ctx, async (tx) => {
    const [inv] = await tx
      .update(invitations)
      .set({ status: "revoked" })
      .where(and(eq(invitations.id, invitationId), eq(invitations.organizationId, ctx.orgId), eq(invitations.status, "pending")))
      .returning({ id: invitations.id, email: invitations.email });
    if (!inv) throw new NotFoundError("Invitation not found or no longer pending.");
    await audit(tx, ctx, { action: "invitation.revoked", entityType: "invitation", entityId: inv.id, metadata: { email: inv.email } });
  });
}

/** Public lookup used by the /invite/[token] page. Only the holder of the token can see it. */
export async function getInvitationByToken(token: string) {
  const tokenHash = sha256(token);
  return withScope({ inviteTokenHash: tokenHash }, async (tx) => {
    const [inv] = await tx
      .select({ id: invitations.id, orgId: invitations.organizationId, email: invitations.email, status: invitations.status, expiresAt: invitations.expiresAt, roleId: invitations.roleId })
      .from(invitations)
      .where(eq(invitations.tokenHash, tokenHash));
    if (!inv) return null;
    // Org name and role name need org scope; switch scope within a new transaction.
    return inv;
  }).then(async (inv) => {
    if (!inv) return null;
    const meta = await withScope({ orgId: inv.orgId }, async (tx) => {
      const [org] = await tx.select({ name: organizations.name, slug: organizations.slug }).from(organizations).where(eq(organizations.id, inv.orgId));
      const [role] = await tx.select({ name: roles.name }).from(roles).where(eq(roles.id, inv.roleId));
      return { orgName: org?.name ?? "", orgSlug: org?.slug ?? "", roleName: role?.name ?? "" };
    });
    const expired = inv.expiresAt.getTime() < Date.now();
    return { ...inv, ...meta, expired, usable: inv.status === "pending" && !expired };
  });
}

export async function acceptInvitation(actor: Actor, token: string) {
  const inv = await getInvitationByToken(token);
  if (!inv || !inv.usable) throw new NotFoundError("This invitation is invalid or has expired.");
  if (inv.email.toLowerCase() !== actor.email.toLowerCase()) {
    throw new ForbiddenError(`This invitation was sent to ${inv.email}. Sign in with that email to accept it.`);
  }
  return withScope({ orgId: inv.orgId, userId: actor.id }, async (tx) => {
    // Re-check under lock to prevent double acceptance.
    const [locked] = await tx.select().from(invitations).where(eq(invitations.id, inv.id)).for("update");
    if (!locked || locked.status !== "pending" || locked.expiresAt.getTime() < Date.now()) {
      throw new NotFoundError("This invitation is invalid or has expired.");
    }
    const [existing] = await tx
      .select({ id: memberships.id, status: memberships.status })
      .from(memberships)
      .where(and(eq(memberships.organizationId, inv.orgId), eq(memberships.userId, actor.id)));
    let membershipId: string;
    if (existing) {
      membershipId = existing.id;
      await tx.update(memberships).set({ status: "active", roleId: locked.roleId, deactivatedAt: null }).where(eq(memberships.id, existing.id));
    } else {
      membershipId = newId();
      await tx.insert(memberships).values({ id: membershipId, organizationId: inv.orgId, userId: actor.id, roleId: locked.roleId });
    }
    await tx
      .update(invitations)
      .set({ status: "accepted", acceptedAt: new Date(), acceptedByUserId: actor.id })
      .where(eq(invitations.id, inv.id));
    const ctx = { orgId: inv.orgId, userId: actor.id };
    await audit(tx, ctx, { action: "invitation.accepted", entityType: "invitation", entityId: inv.id, metadata: { membershipId } });
    if (locked.invitedByUserId && locked.invitedByUserId !== actor.id) {
      await notify(tx, {
        orgId: inv.orgId,
        recipientUserId: locked.invitedByUserId,
        type: "member.joined",
        title: `${actor.email} joined ${inv.orgName}`,
        link: `/o/${inv.orgSlug}/team`,
      });
    }
    return { orgSlug: inv.orgSlug };
  });
}

/* ───────────────────────── Roles ───────────────────────── */

export async function listRoles(ctx: OrgContext) {
  authorize(ctx, "members.read");
  return withTenant(ctx, async (tx) => {
    const roleRows = await tx.select().from(roles).where(eq(roles.organizationId, ctx.orgId)).orderBy(desc(roles.isSystem), asc(roles.createdAt));
    const perms = await tx.select().from(rolePermissions).where(eq(rolePermissions.organizationId, ctx.orgId));
    const counts = await tx
      .select({ roleId: memberships.roleId, n: count() })
      .from(memberships)
      .where(eq(memberships.organizationId, ctx.orgId))
      .groupBy(memberships.roleId);
    const systemOrder = Object.keys(SYSTEM_ROLES);
    const rank = (r: (typeof roleRows)[number]) => (r.isSystem ? systemOrder.indexOf(r.key) : systemOrder.length);
    roleRows.sort((x, y) => rank(x) - rank(y) || x.name.localeCompare(y.name));
    return roleRows.map((r) => ({
      ...r,
      permissions: perms.filter((p) => p.roleId === r.id).map((p) => p.permissionKey as Permission),
      memberCount: counts.find((c) => c.roleId === r.id)?.n ?? 0,
    }));
  });
}

function customRoleKey(name: string) {
  return `custom_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40)}_${newId().slice(-6)}`;
}

export async function createRole(ctx: OrgContext, input: { name: string; description?: string; permissions: string[] }) {
  authorize(ctx, "roles.manage");
  const data = parseInput(roleSchema, input);
  if (data.permissions.includes("billing.manage") && ctx.roleKey !== "owner") {
    throw new ForbiddenError("Only an Owner can grant billing access.");
  }
  return withTenant(ctx, async (tx) => {
    const id = newId();
    await tx.insert(roles).values({ id, organizationId: ctx.orgId, key: customRoleKey(data.name), name: data.name, description: data.description ?? null });
    if (data.permissions.length) {
      await tx.insert(rolePermissions).values(data.permissions.map((p) => ({ organizationId: ctx.orgId, roleId: id, permissionKey: p })));
    }
    await audit(tx, ctx, { action: "role.created", entityType: "role", entityId: id, metadata: { name: data.name, permissions: data.permissions } });
    return { id };
  });
}

export async function updateRole(ctx: OrgContext, roleId: string, input: { name: string; description?: string; permissions: string[] }) {
  authorize(ctx, "roles.manage");
  const data = parseInput(roleSchema, input);
  return withTenant(ctx, async (tx) => {
    const role = await loadRole(tx, ctx, roleId);
    if (role.key === "owner") throw new ForbiddenError("The Owner role can't be edited.");
    const before = (await tx.select().from(rolePermissions).where(eq(rolePermissions.roleId, role.id))).map((p) => p.permissionKey);
    const grantingBilling = data.permissions.includes("billing.manage") && !before.includes("billing.manage");
    if (grantingBilling && ctx.roleKey !== "owner") throw new ForbiddenError("Only an Owner can grant billing access.");
    if (role.id === ctx.roleId && before.includes("roles.manage") && !data.permissions.includes("roles.manage")) {
      throw new ConflictError("You can't remove role management from your own role.");
    }
    await tx.update(roles).set({ name: role.isSystem ? role.name : data.name, description: data.description ?? null }).where(eq(roles.id, role.id));
    await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, role.id));
    if (data.permissions.length) {
      await tx.insert(rolePermissions).values(data.permissions.map((p) => ({ organizationId: ctx.orgId, roleId: role.id, permissionKey: p })));
    }
    const added = data.permissions.filter((p) => !before.includes(p));
    const removed = before.filter((p) => !data.permissions.includes(p));
    await audit(tx, ctx, { action: "role.updated", entityType: "role", entityId: role.id, metadata: { added, removed } });
  });
}

export async function deleteRole(ctx: OrgContext, roleId: string) {
  authorize(ctx, "roles.manage");
  return withTenant(ctx, async (tx) => {
    const role = await loadRole(tx, ctx, roleId);
    if (role.isSystem) throw new ForbiddenError("System roles can't be deleted.");
    const [{ n }] = await tx.select({ n: count() }).from(memberships).where(eq(memberships.roleId, role.id));
    if (n > 0) throw new ConflictError(`Move the ${n} member(s) with this role to another role first.`);
    await tx.delete(roles).where(eq(roles.id, role.id));
    await audit(tx, ctx, { action: "role.deleted", entityType: "role", entityId: role.id, metadata: { name: role.name } });
  });
}

/* ───────────────────────── Teams ───────────────────────── */

export async function listTeams(ctx: OrgContext) {
  authorize(ctx, "members.read");
  return withTenant(ctx, async (tx) => {
    const rows = await tx.select().from(teams).where(eq(teams.organizationId, ctx.orgId)).orderBy(asc(teams.name));
    const members = await tx.select().from(teamMembers).where(eq(teamMembers.organizationId, ctx.orgId));
    return rows.map((t) => ({ ...t, membershipIds: members.filter((m) => m.teamId === t.id).map((m) => m.membershipId) }));
  });
}

export async function createTeam(ctx: OrgContext, input: { name: string; description?: string }) {
  authorize(ctx, "teams.manage");
  const data = parseInput(teamSchema, input);
  try {
    return await withTenant(ctx, async (tx) => {
      const id = newId();
      await tx.insert(teams).values({ id, organizationId: ctx.orgId, name: data.name, description: data.description ?? null });
      await audit(tx, ctx, { action: "team.created", entityType: "team", entityId: id, metadata: { name: data.name } });
      return { id };
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ValidationError("Team exists.", { name: ["A team with this name already exists."] });
    throw err;
  }
}

export async function setTeamMembers(ctx: OrgContext, teamId: string, membershipIds: string[]) {
  authorize(ctx, "teams.manage");
  const unique = [...new Set(membershipIds)];
  return withTenant(ctx, async (tx) => {
    const [team] = await tx.select().from(teams).where(and(eq(teams.id, teamId), eq(teams.organizationId, ctx.orgId)));
    if (!team) throw new NotFoundError("Team not found.");
    if (unique.length) {
      const valid = await tx.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.organizationId, ctx.orgId), inArray(memberships.id, unique)));
      if (valid.length !== unique.length) throw new ValidationError("Unknown member.", { membershipIds: ["One or more members are invalid."] });
    }
    const before = (await tx.select().from(teamMembers).where(eq(teamMembers.teamId, team.id))).map((m) => m.membershipId);
    await tx.delete(teamMembers).where(eq(teamMembers.teamId, team.id));
    if (unique.length) {
      await tx.insert(teamMembers).values(unique.map((membershipId) => ({ organizationId: ctx.orgId, teamId: team.id, membershipId })));
    }
    await audit(tx, ctx, {
      action: "team.members_changed",
      entityType: "team",
      entityId: team.id,
      metadata: { added: unique.filter((m) => !before.includes(m)), removed: before.filter((m) => !unique.includes(m)) },
    });
  });
}

export async function deleteTeam(ctx: OrgContext, teamId: string) {
  authorize(ctx, "teams.manage");
  return withTenant(ctx, async (tx) => {
    const [team] = await tx.delete(teams).where(and(eq(teams.id, teamId), eq(teams.organizationId, ctx.orgId))).returning();
    if (!team) throw new NotFoundError("Team not found.");
    await audit(tx, ctx, { action: "team.deleted", entityType: "team", entityId: team.id, metadata: { name: team.name } });
  });
}
