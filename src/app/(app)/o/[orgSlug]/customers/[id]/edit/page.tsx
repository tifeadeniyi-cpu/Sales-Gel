import { forbidden, notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { customerToInput } from "@/domains/customers/form-input";
import { getCustomer } from "@/domains/customers/service";
import { requireOrgContext } from "@/server/authz/request";
import { can } from "@/server/authz/guards";
import { CustomerForm } from "../../_components/customer-form";
import { customerPerms, loadCustomerLookups } from "../../_components/load";

export default async function EditCustomerPage({ params }: { params: Promise<{ orgSlug: string; id: string }> }) {
  const { orgSlug, id } = await params;
  const ctx = await requireOrgContext(orgSlug);
  if (!can(ctx, "customers.write")) forbidden();
  const c = /^[0-9a-f-]{36}$/i.test(id) ? await getCustomer(ctx, id) : null;
  if (!c) notFound();
  if (c.status === "merged") redirect(`/o/${orgSlug}/customers/${c.mergedIntoId}`);
  const { members, customFields } = await loadCustomerLookups(ctx);
  return (
    <>
      <PageHeader title={`Edit ${c.displayName}`} description={`CUS-${c.number}`} />
      <CustomerForm orgSlug={orgSlug} customerId={c.id} initial={customerToInput(c)} members={members} customFields={customFields} canAssign={customerPerms(ctx).assign} />
    </>
  );
}
