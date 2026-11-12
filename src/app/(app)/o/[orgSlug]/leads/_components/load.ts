import "server-only";
import { listAssignableMembers } from "@/domains/customers/service";
import type { OrgContext } from "@/server/authz/context";

export async function loadLeadLookups(ctx: OrgContext) {
  const members = (await listAssignableMembers(ctx)).map((m) => ({ membershipId: m.membershipId, name: m.name }));
  return { members };
}

export function leadPerms(ctx: OrgContext) {
  const p = ctx.permissions;
  return { write: p.has("leads.write"), assign: p.has("leads.read") && p.has("leads.write"), manage: p.has("pipelines.manage"), tasks: p.has("tasks.read"), tasksWrite: p.has("tasks.write"), customers: p.has("customers.read") || p.has("customers.read_assigned") };
}
