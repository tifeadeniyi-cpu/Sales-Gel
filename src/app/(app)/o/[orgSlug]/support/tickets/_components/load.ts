import "server-only";
import { listAssignableMembers } from "@/domains/customers/service";
import { listTicketConfig } from "@/domains/support/service";
import type { OrgContext } from "@/server/authz/context";
import type { NewTicketLookups } from "./new-ticket-dialog";

export async function loadTicketLookups(ctx: OrgContext) {
  const [config, members] = await Promise.all([listTicketConfig(ctx), listAssignableMembers(ctx)]);
  const lookups: NewTicketLookups = {
    types: config.types.filter((t) => !t.archivedAt).map((t) => ({ id: t.id, name: t.name })),
    members: members.map((m) => ({ membershipId: m.membershipId, name: m.name })),
    canAssign: ctx.permissions.has("tickets.assign"),
    canLinkOrders: ctx.permissions.has("orders.read"),
  };
  return { config, lookups, statuses: config.statuses.filter((s) => !s.archivedAt).map((s) => ({ id: s.id, name: s.name, category: s.category })) };
}
