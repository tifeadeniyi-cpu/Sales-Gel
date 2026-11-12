import Link from "next/link";
import { Search } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { searchCustomers } from "@/domains/customers/service";
import { requireOrgContext } from "@/server/authz/request";
import { canAny } from "@/server/authz/guards";

/** Global search. Every result set is tenant scoped and permission filtered by its domain service. */
export default async function SearchPage({ params, searchParams }: { params: Promise<{ orgSlug: string }>; searchParams: Promise<{ q?: string }> }) {
  const { orgSlug } = await params;
  const ctx = await requireOrgContext(orgSlug);
  const q = ((await searchParams).q ?? "").trim().slice(0, 120);
  const canCustomers = canAny(ctx, "customers.read", "customers.read_assigned");
  const customers = canCustomers && q.length >= 2 ? await searchCustomers(ctx, q, 25) : [];
  return (
    <>
      <PageHeader title="Search" description={q ? `Results for “${q}”` : "Search customers by name, email, phone, social handle or customer number."} />
      <form role="search" className="mb-6 flex max-w-xl gap-2">
        <input name="q" defaultValue={q} type="search" aria-label="Search" autoFocus className="h-10 flex-1 rounded-md border bg-card px-3 text-sm" placeholder="Search…" />
        <button className="h-10 rounded-md bg-primary px-4 text-sm font-medium text-white">Search</button>
      </form>
      {q.length < 2 ? (
        <EmptyState icon={<Search className="size-8" />} title="Type at least 2 characters" />
      ) : !canCustomers ? (
        <EmptyState title="Nothing you can search yet" description="Your role doesn't include access to customers." />
      ) : customers.length === 0 ? (
        <EmptyState icon={<Search className="size-8" />} title="No matches" description="Leads, orders and tickets become searchable as those modules ship." />
      ) : (
        <Card>
          <div className="border-b px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Customers ({customers.length})</div>
          <ul className="divide-y">
            {customers.map((c) => (
              <li key={c.id}>
                <Link href={`/o/${orgSlug}/customers/${c.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{c.displayName}</div>
                    <div className="truncate text-xs text-muted-foreground">CUS-{c.number}{c.primaryEmail ? ` · ${c.primaryEmail}` : ""}{c.primaryPhone ? ` · ${c.primaryPhone}` : ""}</div>
                  </div>
                  {c.status !== "active" && <Badge tone={c.status === "archived" ? "inactive" : "warning"}>{c.status}</Badge>}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
