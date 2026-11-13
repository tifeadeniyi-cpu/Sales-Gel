import Link from "next/link";
import { forbidden, notFound } from "next/navigation";
import { getOrder, getOrderTimeline } from "@/domains/commerce/orders";
import { can, canAny } from "@/server/authz/guards";
import { listTickets } from "@/domains/support/service";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CATEGORY_TONE, PRIORITY } from "../../support/tickets/_components/labels";
import { loadTicketLookups } from "../../support/tickets/_components/load";
import { NewTicketButton } from "../../support/tickets/_components/new-ticket-dialog";
import { requireOrgContext } from "@/server/authz/request";
import { listPaymentLinks, stripeReady } from "@/domains/integrations/stripe";
import { PaymentLinks } from "../_components/payment-links";
import { orderNo, SOURCE_LABELS } from "../_components/labels";
import { OrderBadges, OrderFulfillmentCard, OrderItemsCard, OrderMoneyCard, OrderSideCard, OrderTimeline, OrderToolbar } from "../_components/order-view";

export default async function OrderPage({ params }: { params: Promise<{ orgSlug: string; id: string }> }) {
  const { orgSlug, id } = await params;
  const ctx = await requireOrgContext(orgSlug);
  if (!can(ctx, "orders.read")) forbidden();
  const o = /^[0-9a-f-]{36}$/i.test(id) ? await getOrder(ctx, id) : null;
  if (!o) notFound();
  const canTickets = canAny(ctx, "tickets.read", "tickets.read_assigned");
  const showLinks = o.financialsVisible && can(ctx, "orders.financials");
  const [links, ready] = showLinks ? await Promise.all([listPaymentLinks(ctx, o.id), stripeReady(ctx)]) : [[], false];
  const [timeline, tickets, ticketLookups] = await Promise.all([
    getOrderTimeline(ctx, o.id),
    canTickets ? listTickets(ctx, { view: "all", order: o.id }) : Promise.resolve(null),
    can(ctx, "tickets.write") ? loadTicketLookups(ctx) : Promise.resolve(null),
  ]);
  return (
    <>
      <Link href={`/o/${orgSlug}/orders`} className="text-sm text-primary hover:underline">← Orders</Link>
      <div className="mb-6 mt-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{orderNo(o.number)}{o.externalName && <span className="ml-2 text-base font-normal text-muted-foreground">{SOURCE_LABELS[o.source] ?? o.source} {o.externalName}</span>}</h1>
          <div className="mt-1"><OrderBadges o={o} /></div>
        </div>
        <OrderToolbar ctx={ctx} orgSlug={orgSlug} o={o} />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <OrderItemsCard o={o} />
          <OrderMoneyCard ctx={ctx} orgSlug={orgSlug} o={o} />
          {showLinks && o.orderStatus !== "cancelled" && (
            <Card>
              <CardHeader><CardTitle>Payment links</CardTitle></CardHeader>
              <CardContent>
                <PaymentLinks orgSlug={orgSlug} orderId={o.id} ready={ready} canCreate={can(ctx, "orders.write")} due={(o.totalAmount ?? 0) - ((o.paidAmount ?? 0) - (o.refundedAmount ?? 0))} currency={o.currency}
                  links={links.map((l) => ({ id: l.id, url: l.url, amount: l.amount, currency: l.currency, status: l.status, createdAt: l.createdAt.toISOString(), expiresAt: l.expiresAt?.toISOString() ?? null }))} />
              </CardContent>
            </Card>
          )}
          <OrderFulfillmentCard ctx={ctx} orgSlug={orgSlug} o={o} />
        </div>
        <div className="space-y-6">
          <OrderSideCard ctx={ctx} orgSlug={orgSlug} o={o} />
          {tickets && (
            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle>Support tickets</CardTitle>
                {ticketLookups && <NewTicketButton size="sm" variant="outline" label="Create ticket" orgSlug={orgSlug} lookups={ticketLookups.lookups}
                  presetOrder={{ id: o.id, label: `ORD-${o.number}` }} presetCustomer={o.customerId && o.customerVisible ? { id: o.customerId, label: o.customerName ?? "Customer" } : null} />}
              </CardHeader>
              <CardContent>
                {tickets.rows.length === 0 ? <p className="text-sm text-muted-foreground">No tickets about this order.</p> : (
                  <ul className="divide-y text-sm">
                    {tickets.rows.map((t) => (
                      <li key={t.id} className="flex items-center gap-2 py-2">
                        <Link href={`/o/${orgSlug}/support/tickets/${t.id}`} className="min-w-0 flex-1 truncate hover:underline"><span className="text-muted-foreground">TCK-{t.number}</span> {t.subject}</Link>
                        <Badge tone={PRIORITY[t.priority].tone}>{PRIORITY[t.priority].label}</Badge>
                        <Badge tone={CATEGORY_TONE[t.statusCategory]}>{t.statusName}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}
          <OrderTimeline ctx={ctx} events={timeline} />
        </div>
      </div>
    </>
  );
}
