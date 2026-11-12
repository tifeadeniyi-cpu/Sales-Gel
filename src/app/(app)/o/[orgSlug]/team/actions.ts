"use server";
import { revalidatePath } from "next/cache";
import { runAction, str, type ActionResult } from "@/server/actions";
import { requireOrgContext } from "@/server/authz/request";
import * as identity from "@/domains/identity/service";

const appUrl = () => process.env.NEXT_PUBLIC_APP_URL ?? process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
const refresh = (slug: string) => revalidatePath(`/o/${slug}`, "layout");

export async function inviteMemberAction(
  orgSlug: string,
  _prev: ActionResult<{ link: string; email: string; roleName: string }> | null,
  fd: FormData,
): Promise<ActionResult<{ link: string; email: string; roleName: string }>> {
  const ctx = await requireOrgContext(orgSlug);
  const res = await runAction(async () => {
    const inv = await identity.inviteMember(ctx, { email: str(fd, "email") ?? "", roleId: str(fd, "roleId") ?? "" });
    return { link: `${appUrl()}/invite/${inv.token}`, email: inv.email, roleName: inv.roleName };
  });
  if (res.ok) refresh(orgSlug);
  return res;
}

export async function revokeInvitationAction(orgSlug: string, invitationId: string) {
  const ctx = await requireOrgContext(orgSlug);
  const res = await runAction(() => identity.revokeInvitation(ctx, invitationId));
  if (res.ok) refresh(orgSlug);
  return res;
}

export async function changeMemberRoleAction(orgSlug: string, membershipId: string, roleId: string) {
  const ctx = await requireOrgContext(orgSlug);
  const res = await runAction(() => identity.changeMemberRole(ctx, { membershipId, roleId }));
  if (res.ok) refresh(orgSlug);
  return res;
}

export async function setMemberStatusAction(orgSlug: string, membershipId: string, status: "active" | "deactivated") {
  const ctx = await requireOrgContext(orgSlug);
  const res = await runAction(() => identity.setMemberStatus(ctx, membershipId, status));
  if (res.ok) refresh(orgSlug);
  return res;
}

export async function removeMemberAction(orgSlug: string, membershipId: string) {
  const ctx = await requireOrgContext(orgSlug);
  const res = await runAction(() => identity.removeMember(ctx, membershipId));
  if (res.ok) refresh(orgSlug);
  return res;
}

export interface RoleInput {
  name: string;
  description?: string;
  permissions: string[];
}

export async function saveRoleAction(orgSlug: string, roleId: string | null, input: RoleInput) {
  const ctx = await requireOrgContext(orgSlug);
  const res = await runAction(async () => {
    if (roleId) {
      await identity.updateRole(ctx, roleId, input);
      return { id: roleId };
    }
    return identity.createRole(ctx, input);
  });
  if (res.ok) refresh(orgSlug);
  return res;
}

export async function deleteRoleAction(orgSlug: string, roleId: string) {
  const ctx = await requireOrgContext(orgSlug);
  const res = await runAction(() => identity.deleteRole(ctx, roleId));
  if (res.ok) refresh(orgSlug);
  return res;
}

export async function createTeamAction(orgSlug: string, _prev: ActionResult<{ id: string }> | null, fd: FormData) {
  const ctx = await requireOrgContext(orgSlug);
  const res = await runAction(() => identity.createTeam(ctx, { name: str(fd, "name") ?? "", description: str(fd, "description") }), "Team created.");
  if (res.ok) refresh(orgSlug);
  return res;
}

export async function setTeamMembersAction(orgSlug: string, teamId: string, membershipIds: string[]) {
  const ctx = await requireOrgContext(orgSlug);
  const res = await runAction(() => identity.setTeamMembers(ctx, teamId, membershipIds));
  if (res.ok) refresh(orgSlug);
  return res;
}

export async function deleteTeamAction(orgSlug: string, teamId: string) {
  const ctx = await requireOrgContext(orgSlug);
  const res = await runAction(() => identity.deleteTeam(ctx, teamId));
  if (res.ok) refresh(orgSlug);
  return res;
}
