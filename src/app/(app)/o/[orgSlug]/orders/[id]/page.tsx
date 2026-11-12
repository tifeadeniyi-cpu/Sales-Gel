import Link from "next/link";
import { forbidden, notFound } from "next/navigation";
import { getOrder, getOrderTimeline } from "@/domains/commerce/orders";
import { can } from "@/server/authz/guards";
import { requireOrgContext } from "@/server/authz/request";
import { orderNo } from "../_components/labels";
import { OrderBadges, OrderFulfillmentCard, OrderItemsCard, OrderMoneyCard, OrderSideCard, OrderTimeline, OrderToolbar } from "../_components/order-view";

export default async function OrderPage({ params }: { params: Promise<{ orgSlug: string; id: string }> }) {
  const { orgSlug, id } = await params;
  const ctx = await requireOrgContext(orgSlug);
  if (!can(ctx, "orders.read")) forbidden();
  const o = /^[0-9a-f-]{36}$/i.test(id) ? await getOrder(ctx, id) : null;
  if (!o) notFound();
  const timeline = await getOrderTimeline(ctx, o.id);
  return (
    <>
      <Link href={`/o/${orgSlug}/orders`} className="text-sm text-primary hover:underline">← Orders</Link>
      <div className="mb-6 mt-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{orderNo(o.number)}</h1>
          <div className="mt-1"><OrderBadges o={o} /></div>
        </div>
        <OrderToolbar ctx={ctx} orgSlug={orgSlug} o={o} />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <OrderItemsCard o={o} />
          <OrderMoneyCard ctx={ctx} orgSlug={orgSlug} o={o} />
          <OrderFulfillmentCard ctx={ctx} orgSlug={orgSlug} o={o} />
        </div>
        <div className="space-y-6">
          <OrderSideCard ctx={ctx} orgSlug={orgSlug} o={o} />
          <OrderTimeline ctx={ctx} events={timeline} />
        </div>
      </div>
    </>
  );
}
