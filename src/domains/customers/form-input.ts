import type { CustomerDetail } from "./service";
import type { CustomerInput } from "./validation";

/** Converts a loaded customer into form input (used for partial edits like tags). */
export function customerToInput(c: CustomerDetail, override: Partial<CustomerInput> = {}): CustomerInput {
  return {
    type: c.type as "person" | "business",
    firstName: c.firstName,
    lastName: c.lastName,
    companyName: c.companyName,
    source: c.source as never,
    ownerMembershipId: c.ownerMembershipId,
    preferredChannel: c.preferredChannel as never,
    preferredCurrency: c.preferredCurrency,
    provisional: c.status === "provisional",
    emails: c.emails.map((e) => ({ email: e.email, label: e.label, isPrimary: e.isPrimary })),
    phones: c.phones.map((p) => ({ phone: p.phone, label: p.label, isPrimary: p.isPrimary })),
    identities: c.identities.filter((i) => i.handle && !i.externalId).map((i) => ({ provider: i.provider as never, handle: i.handle! })),
    addresses: c.addresses.map((a) => ({ kind: a.kind as "billing" | "shipping", label: a.label, line1: a.line1, line2: a.line2, city: a.city, region: a.region, postalCode: a.postalCode, country: a.country, isDefault: a.isDefault })),
    tagNames: c.tags.map((t) => t.name),
    customFields: c.customFields,
    ...override,
  };
}
