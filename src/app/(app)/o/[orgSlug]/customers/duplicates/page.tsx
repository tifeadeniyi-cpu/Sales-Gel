import Link from "next/link";
import { forbidden } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { findDuplicateSuggestions } from "@/domains/customers/duplicates";
import { requireOrgContext } from "@/server/authz/request";
import { can } from "@/server/authz/guards";
import { DuplicatePair } from "./duplicate-pair";

export default async function DuplicatesPage({ params, searchParams }: { params: Promise<{ orgSlug: string }>; searchParams: Promise<{ customer?: string }> }) {
  const { orgSlug } = await params;
  const ctx = await requireOrgContext(orgSlug);
  if (!can(ctx, "customers.merge") || !can(ctx, "customers.read")) forbidden();
  const customer = (await searchParams).customer;
  const focus = customer && /^[0-9a-f-]{36}$/i.test(customer) ? customer : undefined;
  const pairs = await findDuplicateSuggestions(ctx, { customerId: focus, limit: 100 });
  return (
    <>
      <Link href={`/o/${orgSlug}/customers`} className="text-sm text-primary hover:underline">← Customers</Link>
      <PageHeader
        className="mt-3"
        title="Possible duplicates"
        description="Customers that share an email, phone number or social handle. Nothing is merged unless you choose to."
        actions={focus ? <Link href={`/o/${orgSlug}/customers/duplicates`} className="text-sm text-primary hover:underline">Show all suggestions</Link> : undefined}
      />
      {pairs.length === 0 ? (
        <EmptyState icon={<CheckCircle2 className="size-8 text-success" />} title="No duplicates found" description={focus ? "This customer doesn't share identifiers with anyone else." : "All your customers have unique emails, phones and handles."} />
      ) : (
        <ul className="space-y-3">
          {pairs.map((p) => <DuplicatePair key={`${p.a.id}-${p.b.id}`} orgSlug={orgSlug} a={p.a} b={p.b} reasons={p.reasons} values={p.values} />)}
        </ul>
      )}
    </>
  );
}
