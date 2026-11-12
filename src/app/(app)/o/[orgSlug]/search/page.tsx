import Link from "next/link";
import { Search } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { listOrders } from "@/domains/commerce/orders";
import { searchCustomers } from "@/domains/customers/service";
import { listLeads } from "@/domains/sales/service";
import { listTickets } from "@/domains/support/service";
import { formatMoney } from "@/lib/money";
import { canAny } from "@/server/authz/guards";
import { requireOrgContext } from "@/server/authz/request";

interface Hit { id: string; href: string; title: string; sub: string; badge?: string }

/** Global search, grouped by record type. Every result set is tenant scoped and permission filtered by its domain service. */
export default async function SearchPage({ params, searchParams }: { params: Promise<{ orgSlug: string }>; searchParams: Promise<{ q?: string }> }) {
  const { orgSlug } = await params;
  const ctx = await requireOrgContext(orgSlug);
  const q = ((await searchParams).q ?? "").trim().slice(0, 120);
  const base = `/o/${orgSlug}`;
  const ok = q.length >= 2;
  const [cs, ls, os, ts] = await Promise.all([
    ok && canAny(ctx, "customers.read", "customers.read_assigned") ? searchCustomers(ctx, q, 10) : null,
    ok && canAny(ctx, "leads.read", "leads.read_assigned") ? listLeads(ctx, { q, status: "all" }, 10) : null,
    ok && ctx.permissions.has("orders.read") ? listOrders(ctx, { q, pageSize: 25 }).then((r) => r.rows.slice(0, 10)) : null,
    ok && canAny(ctx, "tickets.read", "tickets.read_assigned") ? listTickets(ctx, { view: "all", q, pageSize: 25 }).then((r) => r.rows.slice(0, 10)) : null,
  ]);
  const groups: { label: string; hits: Hit[] }[] = [
    { label: "Contacts", hits: (cs ?? []).map((c) => ({ id: c.id, href: `${base}/customers/${c.id}`, title: c.displayName, sub: [`CUS-${c.number}`, c.primaryEmail, c.primaryPhone].filter(Boolean).join(" · "), badge: c.status !== "active" ? c.status : undefined })) },
    { label: "Leads & deals", hits: (ls ?? []).map((l) => ({ id: l.id, href: `${base}/leads/${l.id}`, title: l.title, sub: [`LEAD-${l.number}`, l.customerName, l.stage?.name, l.valueAmount !== null ? formatMoney(l.valueAmount, l.currency) : null].filter(Boolean).join(" · "), badge: l.status !== "open" ? l.status : undefined })) },
    { label: "Orders", hits: (os ?? []).map((o) => ({ id: o.id, href: `${base}/orders/${o.id}`, title: `ORD-${o.number}`, sub: [o.customerName, o.totalAmount !== null ? formatMoney(o.totalAmount, o.currency) : null].filter(Boolean).join(" · "), badge: o.paymentStatus.replace("_", " ") })) },
    { label: "Tickets", hits: (ts ?? []).map((t) => ({ id: t.id, href: `${base}/support/tickets/${t.id}`, title: `TCK-${t.number} · ${t.subject}`, sub: [t.customerName, t.statusName].filter(Boolean).join(" · "), badge: t.priority === "urgent" || t.priority === "high" ? t.priority : undefined })) },
  ];
  const searchable = [cs, ls, os, ts].some((x) => x !== null) || !ok;
  const total = groups.reduce((a, g) => a + g.hits.length, 0);
  return (
    <>
      <PageHeader title="Search" description={q ? `Results for “${q}”` : "Find contacts, leads and deals, orders and tickets."} />
      <form role="search" className="mb-6 flex max-w-xl gap-2">
        <input name="q" defaultValue={q} type="search" aria-label="Search" autoFocus className="h-10 flex-1 rounded-md border bg-card px-3 text-sm" placeholder="Name, email, phone, ORD-, TCK- or LEAD- number…" />
        <button className="h-10 rounded-md bg-primary px-4 text-sm font-medium text-white">Search</button>
      </form>
      {!ok ? (
        <EmptyState icon={<Search className="size-8" />} title="Type at least 2 characters" />
      ) : !searchable ? (
        <EmptyState title="Nothing you can search yet" description="Your role doesn't include access to contacts, deals, orders or tickets." />
      ) : total === 0 ? (
        <EmptyState icon={<Search className="size-8" />} title="No matches" description="Conversations become searchable when the Inbox is connected." />
      ) : (
        <div className="space-y-4">
          {groups.filter((g) => g.hits.length).map((g) => (
            <Card key={g.label} className="overflow-hidden">
              <h2 className="border-b bg-muted/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.label} ({g.hits.length})</h2>
              <ul className="divide-y">
                {g.hits.map((h) => (
                  <li key={h.id}>
                    <Link href={h.href} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40">
                      <div className="min-w-0 flex-1"><div className="truncate font-medium">{h.title}</div><div className="truncate text-xs text-muted-foreground">{h.sub}</div></div>
                      {h.badge && <Badge tone="neutral">{h.badge}</Badge>}
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
