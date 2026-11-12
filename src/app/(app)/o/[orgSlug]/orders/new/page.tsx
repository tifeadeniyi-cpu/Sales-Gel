import Link from "next/link";
import { forbidden } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { getCustomer, listAssignableMembers } from "@/domains/customers/service";
import { getLead } from "@/domains/sales/service";
import { canAny, can } from "@/server/authz/guards";
import { requireOrgContext } from "@/server/authz/request";
import { OrderWizard } from "../_components/order-wizard";

const UUID = /^[0-9a-f-]{36}$/i;

export default async function NewOrderPage({ params, searchParams }: { params: Promise<{ orgSlug: string }>; searchParams: Promise<{ customer?: string; lead?: string }> }) {
  const { orgSlug } = await params;
  const ctx = await requireOrgContext(orgSlug);
  if (!can(ctx, "orders.write")) forbidden();
  const sp = await searchParams;
  const lead = sp.lead && UUID.test(sp.lead) && canAny(ctx, "leads.read", "leads.read_assigned") ? await getLead(ctx, sp.lead) : null;
  const customerId = lead?.customerId ?? (sp.customer && UUID.test(sp.customer) ? sp.customer : null);
  const customer = customerId && canAny(ctx, "customers.read", "customers.read_assigned") ? await getCustomer(ctx, customerId) : null;
  const members = (await listAssignableMembers(ctx)).map((m) => ({ membershipId: m.membershipId, name: m.name }));
  return (
    <div className="mx-auto max-w-5xl">
      <Link href={`/o/${orgSlug}/orders`} className="text-sm text-primary hover:underline">← Orders</Link>
      <PageHeader title="New order" description="Record a sale taken by phone, in person, or on social media." />
      <OrderWizard
        orgSlug={orgSlug}
        defaultCurrency={ctx.defaultCurrency}
        members={members}
        canAssign
        presetCustomer={customer && customer.status !== "merged" ? { id: customer.id, label: customer.displayName, sub: `CUS-${customer.number}` } : null}
        customerCurrency={customer?.preferredCurrency ?? null}
        presetLead={lead ? { id: lead.id, label: `${lead.title} (LEAD-${lead.number})`, currency: lead.currency } : null}
      />
    </div>
  );
}
