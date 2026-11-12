import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { user } from "@/server/auth/schema";
import { roles } from "@/domains/identity/schema";
import { createOrganization, inviteMember, acceptInvitation } from "@/domains/identity/service";
import { loadOrgContext, type OrgContext } from "@/server/authz/context";
import { withScope } from "@/server/db/tenant";
import { newId } from "@/lib/ids";

let seq = 0;
const runId = Date.now().toString(36);

export async function createUser(name = "Test User") {
  seq += 1;
  const id = newId();
  const email = `user${seq}-${runId}@example.test`;
  await db.insert(user).values({ id, name: `${name} ${seq}`, email, emailVerified: true });
  return { id, email, name: `${name} ${seq}` };
}

export async function createOrgWithOwner(name = "Acme") {
  const owner = await createUser("Owner");
  seq += 1;
  const slug = `${name.toLowerCase()}-${runId}-${seq}`;
  await createOrganization(owner, { name, slug, defaultCurrency: "USD", timezone: "UTC" });
  const ctx = (await loadOrgContext(owner.id, slug))!;
  return { owner, ctx, slug };
}

export async function roleIdByKey(ctx: OrgContext, key: string) {
  const [r] = await withScope({ orgId: ctx.orgId }, (tx) => tx.select().from(roles).where(eq(roles.key, key)));
  return r.id;
}

/** Adds a new user to the org with the given system role through the real invitation flow. */
export async function addMember(ownerCtx: OrgContext, roleKey: string) {
  const member = await createUser(roleKey);
  const roleId = await roleIdByKey(ownerCtx, roleKey);
  const inv = await inviteMember(ownerCtx, { email: member.email, roleId });
  await acceptInvitation(member, inv.token);
  const ctx = (await loadOrgContext(member.id, ownerCtx.orgSlug))!;
  return { member, ctx };
}
