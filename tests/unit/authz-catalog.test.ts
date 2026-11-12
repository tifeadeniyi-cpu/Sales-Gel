import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, PERMISSIONS, SYSTEM_ROLES } from "@/server/authz/catalog";
import { authorize, can, canReadRecord } from "@/server/authz/guards";
import { ForbiddenError } from "@/server/errors";

describe("permission catalog", () => {
  it("every key is domain.action and documented", () => {
    const doc = readFileSync("docs/02-authorization.md", "utf8");
    for (const key of ALL_PERMISSIONS) {
      expect(key).toMatch(/^[a-z]+(\.[a-z_]+)+$/);
      const documented = doc.includes(`\`${key}\``) || doc.includes(`/ \`${key}\``);
      expect(documented, `${key} missing from docs/02-authorization.md`).toBe(true);
    }
  });

  it("system roles reference only known permissions", () => {
    for (const [key, role] of Object.entries(SYSTEM_ROLES)) {
      for (const p of role.permissions) expect(p in PERMISSIONS, `${key}: ${p}`).toBe(true);
    }
  });

  it("owner has everything, admin everything but billing", () => {
    expect(SYSTEM_ROLES.owner.permissions).toEqual(ALL_PERMISSIONS);
    expect(SYSTEM_ROLES.admin.permissions).not.toContain("billing.manage");
    expect(SYSTEM_ROLES.admin.permissions.length).toBe(ALL_PERMISSIONS.length - 1);
  });

  it("support agents cannot refund, export customers, manage integrations or billing", () => {
    const p = SYSTEM_ROLES.support_agent.permissions;
    for (const denied of ["refunds.issue", "customers.export", "integrations.manage", "billing.manage", "tickets.read"] as const) {
      expect(p).not.toContain(denied);
    }
  });

  it("only owner and admin can issue refunds by default", () => {
    const holders = Object.entries(SYSTEM_ROLES).filter(([, r]) => r.permissions.includes("refunds.issue")).map(([k]) => k);
    expect(holders.sort()).toEqual(["admin", "owner"]);
  });

  it("read-only role has no write permissions", () => {
    for (const p of SYSTEM_ROLES.read_only.permissions) expect(p).toMatch(/\.read$/);
  });
});

describe("guards", () => {
  const ctx = { permissions: new Set(["tickets.read_assigned", "tickets.write"] as const), membershipId: "m1" };

  it("authorize throws ForbiddenError naming the permission", () => {
    expect(() => authorize(ctx, "tickets.write")).not.toThrow();
    try {
      authorize(ctx, "tickets.assign");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ForbiddenError);
      expect((e as ForbiddenError).permission).toBe("tickets.assign");
    }
  });

  it("can() is a pure check", () => {
    expect(can(ctx, "tickets.write")).toBe(true);
    expect(can(ctx, "refunds.issue")).toBe(false);
  });

  it("read_assigned only grants records the member owns or is assigned", () => {
    expect(canReadRecord(ctx, "tickets", { assigneeMembershipId: "m1" })).toBe(true);
    expect(canReadRecord(ctx, "tickets", { assigneeMembershipId: "m2" })).toBe(false);
    expect(canReadRecord(ctx, "tickets", {})).toBe(false);
    expect(canReadRecord(ctx, "leads", { ownerMembershipId: "m1" })).toBe(false);
    expect(canReadRecord({ permissions: new Set(["tickets.read"] as const), membershipId: "x" }, "tickets", {})).toBe(true);
  });
});
