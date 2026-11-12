import { describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import postgres from "postgres";
import {
  acceptInvitation,
  changeMemberRole,
  createOrganization,
  createRole,
  createTeam,
  deleteRole,
  getInvitationByToken,
  inviteMember,
  listMembers,
  listMyOrganizations,
  listRoles,
  removeMember,
  revokeInvitation,
  setMemberStatus,
  setTeamMembers,
  updateOrganization,
  updateRole,
} from "@/domains/identity/service";
import { listAuditLogs } from "@/domains/platform/audit-queries";
import { loadOrgContext } from "@/server/authz/context";
import { ALL_PERMISSIONS } from "@/server/authz/catalog";
import { isPermissionDenied } from "@/server/db/errors";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { addMember, createOrgWithOwner, createUser, roleIdByKey } from "../support/factories";

describe("organization creation", () => {
  it("seeds system roles, an owner membership and an audit entry", async () => {
    const { ctx, owner } = await createOrgWithOwner("Seedco");
    expect(ctx.roleKey).toBe("owner");
    expect(ctx.permissions.size).toBe(ALL_PERMISSIONS.length);

    const rolesList = await listRoles(ctx);
    expect(rolesList.map((r) => r.key).sort()).toEqual(
      ["admin", "analyst", "marketing", "owner", "read_only", "sales_manager", "sales_rep", "support_agent", "support_manager"].sort(),
    );
    const supportAgent = rolesList.find((r) => r.key === "support_agent")!;
    expect(supportAgent.permissions).not.toContain("refunds.issue");
    expect(supportAgent.permissions).toContain("tickets.read_assigned");

    const audit = await listAuditLogs(ctx);
    expect(audit.rows.some((r) => r.action === "organization.created")).toBe(true);

    const mine = await listMyOrganizations(owner.id);
    expect(mine.map((o) => o.slug)).toContain(ctx.orgSlug);
  });

  it("rejects a taken slug with a field error", async () => {
    const { slug } = await createOrgWithOwner("Dupe");
    const other = await createUser();
    await expect(createOrganization(other, { name: "Dupe 2", slug })).rejects.toMatchObject({
      fieldErrors: { slug: [expect.stringContaining("taken")] },
    });
  });

  it("validates input", async () => {
    const u = await createUser();
    await expect(createOrganization(u, { name: "x", slug: "-bad-" })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("tenant isolation (Scenario 6 — identity layer)", () => {
  it("non-members cannot resolve another org's context", async () => {
    const a = await createOrgWithOwner("Alpha");
    const b = await createOrgWithOwner("Beta");
    expect(await loadOrgContext(a.owner.id, b.slug)).toBeNull();
    expect(await loadOrgContext(b.owner.id, a.slug)).toBeNull();
  });

  it("RLS hides other tenants' rows even when a query omits the org filter", async () => {
    const a = await createOrgWithOwner("RlsA");
    const b = await createOrgWithOwner("RlsB");
    const { withScope } = await import("@/server/db/tenant");
    const { roles, memberships } = await import("@/domains/identity/schema");
    const { auditLogs } = await import("@/domains/platform/schema");

    const seen = await withScope({ orgId: a.ctx.orgId, userId: a.owner.id }, async (tx) => ({
      roles: await tx.select({ org: roles.organizationId }).from(roles),
      audit: await tx.select({ org: auditLogs.organizationId }).from(auditLogs),
      members: await tx.select({ org: memberships.organizationId }).from(memberships),
    }));
    expect(seen.roles.length).toBeGreaterThan(0);
    for (const rows of Object.values(seen)) {
      expect(rows.every((r) => r.org === a.ctx.orgId)).toBe(true);
    }
    expect(seen.roles.some((r) => r.org === b.ctx.orgId)).toBe(false);

    // With no org scope at all, tenant tables are empty.
    const unscoped = await withScope({}, (tx) => tx.select().from(roles));
    expect(unscoped).toHaveLength(0);
  });

  it("RLS rejects writes into another tenant", async () => {
    const a = await createOrgWithOwner("WriteA");
    const b = await createOrgWithOwner("WriteB");
    const { withScope } = await import("@/server/db/tenant");
    const { teams } = await import("@/domains/identity/schema");
    await expect(
      withScope({ orgId: a.ctx.orgId, userId: a.owner.id }, (tx) =>
        tx.insert(teams).values({ organizationId: b.ctx.orgId, name: "Intruders" }),
      ),
    ).rejects.toThrow();
  });

  it("composite foreign keys block cross-tenant references even without RLS", async () => {
    const a = await createOrgWithOwner("FkA");
    const b = await createOrgWithOwner("FkB");
    const bRole = await roleIdByKey(b.ctx, "admin");
    const outsider = await createUser();
    // Connect as the owner/migration role (bypasses RLS) to prove the relational layer independently.
    const admin = postgres(process.env.DATABASE_URL_MIGRATE!, { max: 1, onnotice: () => {} });
    try {
      await expect(
        admin`insert into memberships (id, organization_id, user_id, role_id) values (gen_random_uuid(), ${a.ctx.orgId}, ${outsider.id}, ${bRole})`,
      ).rejects.toMatchObject({ code: "23503" });
    } finally {
      await admin.end();
    }
  });

  it("team membership rejects members from another org", async () => {
    const a = await createOrgWithOwner("TeamA");
    const b = await createOrgWithOwner("TeamB");
    const team = await createTeam(a.ctx, { name: "Support" });
    await expect(setTeamMembers(a.ctx, team.id, [b.ctx.membershipId])).rejects.toBeInstanceOf(ValidationError);
  });

  it("audit log is append-only for the app role", async () => {
    const a = await createOrgWithOwner("Append");
    const { withTenant } = await import("@/server/db/tenant");
    const { auditLogs } = await import("@/domains/platform/schema");
    await expect(
      withTenant(a.ctx, (tx) => tx.update(auditLogs).set({ action: "tampered" }).where(eq(auditLogs.organizationId, a.ctx.orgId))),
    ).rejects.toSatisfy(isPermissionDenied);
    await expect(
      withTenant(a.ctx, (tx) => tx.delete(auditLogs).where(eq(auditLogs.organizationId, a.ctx.orgId))),
    ).rejects.toSatisfy(isPermissionDenied);
  });
});

describe("invitations", () => {
  it("full flow: invite → lookup → accept → membership with role, inviter notified", async () => {
    const { ctx, owner } = await createOrgWithOwner("Invite");
    const invitee = await createUser();
    const roleId = await roleIdByKey(ctx, "sales_rep");
    const inv = await inviteMember(ctx, { email: invitee.email.toUpperCase(), roleId });

    const looked = await getInvitationByToken(inv.token);
    expect(looked).toMatchObject({ usable: true, orgName: "Invite", roleName: "Sales Representative" });
    expect(await getInvitationByToken("not-a-real-token")).toBeNull();

    const res = await acceptInvitation(invitee, inv.token);
    expect(res.orgSlug).toBe(ctx.orgSlug);
    const memberCtx = await loadOrgContext(invitee.id, ctx.orgSlug);
    expect(memberCtx?.roleKey).toBe("sales_rep");
    expect(memberCtx?.permissions.has("leads.read_assigned")).toBe(true);
    expect(memberCtx?.permissions.has("leads.read")).toBe(false);

    await expect(acceptInvitation(invitee, inv.token)).rejects.toBeInstanceOf(NotFoundError);

    const { listNotifications } = await import("@/domains/platform/notifications");
    const notes = await listNotifications(ctx);
    expect(notes.some((n) => n.type === "member.joined")).toBe(true);
    expect(owner.id).toBe(ctx.userId);
  });

  it("only the invited email can accept", async () => {
    const { ctx } = await createOrgWithOwner("Wrongmail");
    const invitee = await createUser();
    const stranger = await createUser();
    const inv = await inviteMember(ctx, { email: invitee.email, roleId: await roleIdByKey(ctx, "analyst") });
    await expect(acceptInvitation(stranger, inv.token)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("revoked invitations cannot be used and re-inviting revokes the old token", async () => {
    const { ctx } = await createOrgWithOwner("Revoke");
    const invitee = await createUser();
    const roleId = await roleIdByKey(ctx, "analyst");
    const first = await inviteMember(ctx, { email: invitee.email, roleId });
    const second = await inviteMember(ctx, { email: invitee.email, roleId });
    expect((await getInvitationByToken(first.token))?.usable).toBe(false);
    await revokeInvitation(ctx, second.id);
    await expect(acceptInvitation(invitee, second.token)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("refuses to invite an existing member", async () => {
    const { ctx, owner } = await createOrgWithOwner("Existing");
    await expect(inviteMember(ctx, { email: owner.email, roleId: await roleIdByKey(ctx, "admin") })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("permissions (Scenario 8 — identity layer)", () => {
  it("support agents cannot invite, manage roles, edit settings or read audit logs", async () => {
    const { ctx } = await createOrgWithOwner("Perms");
    const { ctx: agent } = await addMember(ctx, "support_agent");
    await expect(inviteMember(agent, { email: "x@example.test", roleId: agent.roleId })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createRole(agent, { name: "Hack", permissions: ["billing.manage"] })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(updateOrganization(agent, { name: "Pwned" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listAuditLogs(agent)).rejects.toBeInstanceOf(ForbiddenError);
    // but can read members
    expect((await listMembers(agent)).length).toBe(2);
  });

  it("admins cannot touch owners or grant the owner role", async () => {
    const { ctx } = await createOrgWithOwner("AdminLimits");
    const { ctx: admin } = await addMember(ctx, "admin");
    await expect(changeMemberRole(admin, { membershipId: ctx.membershipId, roleId: admin.roleId })).rejects.toBeInstanceOf(ForbiddenError);
    const { member: rep } = await addMember(ctx, "sales_rep");
    const repMembership = (await listMembers(ctx)).find((m) => m.userId === rep.id)!;
    await expect(
      changeMemberRole(admin, { membershipId: repMembership.membershipId, roleId: await roleIdByKey(ctx, "owner") }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    // admin can promote a rep to sales manager
    await changeMemberRole(admin, { membershipId: repMembership.membershipId, roleId: await roleIdByKey(ctx, "sales_manager") });
    expect((await loadOrgContext(rep.id, ctx.orgSlug))?.roleKey).toBe("sales_manager");
  });

  it("an org always keeps an active owner", async () => {
    const { ctx } = await createOrgWithOwner("LastOwner");
    await expect(changeMemberRole(ctx, { membershipId: ctx.membershipId, roleId: await roleIdByKey(ctx, "admin") })).rejects.toBeInstanceOf(ConflictError);
    await expect(removeMember(ctx, ctx.membershipId)).rejects.toBeInstanceOf(ConflictError);
    await expect(setMemberStatus(ctx, ctx.membershipId, "deactivated")).rejects.toBeInstanceOf(ConflictError);
  });

  it("deactivated members lose access immediately and can be reactivated", async () => {
    const { ctx } = await createOrgWithOwner("Deact");
    const { member, ctx: rep } = await addMember(ctx, "sales_rep");
    await setMemberStatus(ctx, rep.membershipId, "deactivated");
    expect(await loadOrgContext(member.id, ctx.orgSlug)).toBeNull();
    expect((await listMyOrganizations(member.id)).length).toBe(0);
    await setMemberStatus(ctx, rep.membershipId, "active");
    expect(await loadOrgContext(member.id, ctx.orgSlug)).not.toBeNull();
  });
});

describe("custom roles", () => {
  it("create, edit and delete with guards", async () => {
    const { ctx } = await createOrgWithOwner("Roles");
    const { id } = await createRole(ctx, { name: "Fulfillment", permissions: ["orders.read", "orders.write"] });
    await updateRole(ctx, id, { name: "Fulfillment Team", permissions: ["orders.read"] });
    const role = (await listRoles(ctx)).find((r) => r.id === id)!;
    expect(role.name).toBe("Fulfillment Team");
    expect(role.permissions).toEqual(["orders.read"]);

    const invitee = await createUser();
    const inv = await inviteMember(ctx, { email: invitee.email, roleId: id });
    await acceptInvitation(invitee, inv.token);
    const memberCtx = await loadOrgContext(invitee.id, ctx.orgSlug);
    expect([...memberCtx!.permissions]).toEqual(["orders.read"]);

    await expect(deleteRole(ctx, id)).rejects.toBeInstanceOf(ConflictError);
    await expect(updateRole(ctx, await roleIdByKey(ctx, "owner"), { name: "Xyz", permissions: [] })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(deleteRole(ctx, await roleIdByKey(ctx, "admin"))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("only owners may grant billing access", async () => {
    const { ctx } = await createOrgWithOwner("Billing");
    const { ctx: admin } = await addMember(ctx, "admin");
    await expect(createRole(admin, { name: "Finance", permissions: ["billing.manage"] })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createRole(ctx, { name: "Finance", permissions: ["billing.manage"] })).resolves.toBeTruthy();
  });

  it("rejects unknown permission keys", async () => {
    const { ctx } = await createOrgWithOwner("BadPerm");
    await expect(createRole(ctx, { name: "Weird", permissions: ["root.everything"] })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("organization settings", () => {
  it("updates persist and are audited with a field diff", async () => {
    const { ctx } = await createOrgWithOwner("Settings");
    const updated = await updateOrganization(ctx, { name: "Settings Renamed", defaultCurrency: "NGN", timezone: "Africa/Lagos" });
    expect(updated).toMatchObject({ name: "Settings Renamed", defaultCurrency: "NGN", timezone: "Africa/Lagos" });
    const audit = await listAuditLogs(ctx, { action: "organization.updated" });
    expect(audit.rows[0].changes).toMatchObject({ name: { from: "Settings", to: "Settings Renamed" } });
  });
});

void and;
void sql;
