import { forbidden } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { IMPORT_FIELDS, MAX_IMPORT_BYTES, MAX_IMPORT_ROWS } from "@/domains/customers/import-export";
import { requireOrgContext } from "@/server/authz/request";
import { can } from "@/server/authz/guards";
import { ImportWizard } from "./import-wizard";

export default async function ImportPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const ctx = await requireOrgContext(orgSlug);
  if (!can(ctx, "customers.import") || !can(ctx, "customers.write")) forbidden();
  return (
    <>
      <PageHeader title="Import customers" description="Bring in customers from a spreadsheet, your store export or another CRM." />
      <ImportWizard orgSlug={orgSlug} fields={{ ...IMPORT_FIELDS }} maxRows={MAX_IMPORT_ROWS} maxBytes={MAX_IMPORT_BYTES} />
    </>
  );
}
