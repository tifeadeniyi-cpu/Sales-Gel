import "server-only";
import { listAssignableMembers, listTags } from "@/domains/customers/service";
import { listCustomFields } from "@/domains/customers/custom-fields";
import type { OrgContext } from "@/server/authz/context";

/** Lookup data shared by customer screens. */
export async function loadCustomerLookups(ctx: OrgContext) {
  const [members, tags, customFields] = await Promise.all([listAssignableMembers(ctx), listTags(ctx), listCustomFields(ctx)]);
  return { members, tags, customFields };
}

export function customerPerms(ctx: OrgContext) {
  const p = ctx.permissions;
  return {
    write: p.has("customers.write"),
    archive: p.has("customers.archive"),
    assign: p.has("customers.read") && p.has("customers.write"),
    merge: p.has("customers.merge"),
    import: p.has("customers.import") && p.has("customers.write"),
    export: p.has("customers.export"),
    readAll: p.has("customers.read"),
  };
}
