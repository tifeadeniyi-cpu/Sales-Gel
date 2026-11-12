import { forbidden } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { requireOrgContext } from "@/server/authz/request";
import { can } from "@/server/authz/guards";
import { CustomerForm } from "../_components/customer-form";
import { customerPerms, loadCustomerLookups } from "../_components/load";

export default async function NewCustomerPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const ctx = await requireOrgContext(orgSlug);
  if (!can(ctx, "customers.write")) forbidden();
  const { members, customFields } = await loadCustomerLookups(ctx);
  return (
    <>
      <PageHeader title="Add customer" description="Only one identifier is required. You can fill in the rest later." />
      <CustomerForm orgSlug={orgSlug} members={members} customFields={customFields} canAssign={customerPerms(ctx).assign} />
    </>
  );
}
