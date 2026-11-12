import Link from "next/link";
import { forbidden } from "next/navigation";
import { Plus, ShoppingBag } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { Pagination } from "@/components/app/pagination";
import { RecordDrawer } from "@/components/app/record-drawer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getCommerceStats, getOrder, listOrders } from "@/domains/commerce/orders";
import { ORDER_VIEWS, type OrderFilters } from "@/domains/commerce/validation";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { can } from "@/server/authz/guards";
import { requireOrgContext } from "@/server/authz/request";
import { ValidationError } from "@/server/errors";
import { VIEW_LABELS, orderNo } from "./_components/labels";
import { OrderTable } from "./_components/order-table";
import { OrderBadges, OrderItemsCard, OrderSideCard, OrderToolbar } from "./_components/order-view";

type SP = Record<string, string | undefined>;
const moneyText = (t: Record<string, number> | null, fallbackCurrency: string) => (t === null ? "Hidden" : Object.entries(t).map(([c, v]) => formatMoney(v, c)).join(" · ") || formatMoney(0, fallbackCurrency));

export default async function OrdersPage({ params, searchParams }: { params: Promise<{ orgSlug: string }>; searchParams: Promise<SP> }) {
  const { orgSlug } = await params;
  const ctx = await requireOrgContext(orgSlug);
  if (!can(ctx, "orders.read")) forbidden();
  const sp = await searchParams;
  const filters: OrderFilters = { view: (sp.view as OrderFilters["view"]) ?? "all", q: sp.q, customer: sp.customer, from: sp.from, to: sp.to, moneyFrom: sp.moneyFrom, moneyTo: sp.moneyTo, assignee: sp.assignee, page: sp.page ?? 1, pageSize: sp.pageSize ?? 25 };
  let data;
  try {
    data = await listOrders(ctx, filters);
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    data = await listOrders(ctx, {});
  }
  const stats = await getCommerceStats(ctx);
  const base = `/o/${orgSlug}/orders`;
  const qs = (patch: SP) => {
    const u = new URLSearchParams(Object.entries({ view: data.filters.view, q: data.filters.q, from: data.filters.from, to: data.filters.to, moneyFrom: data.filters.moneyFrom, moneyTo: data.filters.moneyTo, assignee: data.filters.assignee, ...patch }).filter(([, v]) => v && v !== "all") as [string, string][]);
    const s = u.toString();
    return s ? `${base}?${s}` : base;
  };

  let drawer = null;
  const openId = sp.open && /^[0-9a-f-]{36}$/i.test(sp.open) ? sp.open : null;
  if (openId) {
    const o = await getOrder(ctx, openId);
    if (o) {
      const ids = data.rows.map((r) => r.id);
      const idx = ids.indexOf(o.id);
      drawer = (
        <RecordDrawer title={orderNo(o.number)} subtitle={<OrderBadges o={o} />} fullHref={`${base}/${o.id}`} prevId={idx > 0 ? ids[idx - 1] : null} nextId={idx >= 0 && idx < ids.length - 1 ? ids[idx + 1] : null}>
          <div className="space-y-4 p-5">
            <OrderToolbar ctx={ctx} orgSlug={orgSlug} o={o} />
            <OrderItemsCard o={o} />
            <OrderSideCard ctx={ctx} orgSlug={orgSlug} o={o} />
          </div>
        </RecordDrawer>
      );
    }
  }

  const noneAtAll = data.total === 0 && data.filters.view === "all" && !data.filters.q && !data.filters.customer && !data.filters.from && !data.filters.moneyFrom && !data.filters.assignee;
  return (
    <>
      <PageHeader
        title="Orders & Sales"
        description="Manual and online orders, payments and fulfillment."
        actions={can(ctx, "orders.write") && <Button asChild><Link href={`${base}/new`}><Plus /> New order</Link></Button>}
      />
      {stats && (
        <div className="mb-4 grid gap-3 sm:grid-cols-4">
          {[
            ["Net revenue (30 days)", moneyText(stats.netRevenue, ctx.defaultCurrency), "Payments received minus refunds"],
            ["Orders (30 days)", String(stats.ordersBooked), "Excludes cancelled"],
            ["Awaiting payment", String(stats.unpaidOrders), "Open, unpaid or partially paid"],
            ["Awaiting fulfillment", String(stats.pendingOrders), "Open, not fully fulfilled"],
          ].map(([l, v, hint]) => (
            <Card key={l}><CardContent className="p-4"><div className="text-xs text-muted-foreground">{l}</div><div className="truncate text-xl font-semibold" title={v}>{v}</div><div className="text-xs text-muted-foreground">{hint}</div></CardContent></Card>
          ))}
        </div>
      )}
      <nav className="mb-3 flex gap-1 overflow-x-auto border-b" aria-label="Order views">
        {ORDER_VIEWS.map((v) => (
          <Link key={v} href={qs({ view: v, page: undefined })} aria-current={data.filters.view === v ? "page" : undefined}
            className={cn("whitespace-nowrap border-b-2 px-3 py-2 text-sm", data.filters.view === v ? "border-primary font-medium text-primary" : "border-transparent text-muted-foreground hover:text-ink")}>
            {VIEW_LABELS[v]}
          </Link>
        ))}
      </nav>
      {(data.filters.from || data.filters.moneyFrom || data.filters.assignee) && (
        <p className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="rounded-full bg-primary/10 px-3 py-1 text-primary">
            {data.filters.moneyFrom ? "Orders with payments or refunds in the dashboard period" : data.filters.from ? "Orders placed in the dashboard period" : "Filtered"}
            {data.filters.assignee ? " · one team member" : ""}
          </span>
          <Link href={qs({ from: undefined, to: undefined, moneyFrom: undefined, moneyTo: undefined, assignee: undefined, page: undefined })} className="text-primary hover:underline">Clear</Link>
        </p>
      )}
      <form className="mb-4 flex gap-2" action={base}>
        {data.filters.view !== "all" && <input type="hidden" name="view" value={data.filters.view} />}
        <Input name="q" defaultValue={data.filters.q} placeholder="Search order number or customer…" className="max-w-sm" aria-label="Search orders" />
        <Button type="submit" variant="outline">Search</Button>
        {(data.filters.q || data.filters.customer) && <Button asChild variant="ghost"><Link href={qs({ q: undefined, customer: undefined })}>Clear</Link></Button>}
      </form>
      {noneAtAll ? (
        <EmptyState
          icon={<ShoppingBag className="size-8" />}
          title="No orders yet"
          description="Create an order for sales you take by phone, in person or on social media. Store sync (Shopify, WooCommerce) arrives in Phase 6."
          action={can(ctx, "orders.write") && <Button asChild><Link href={`${base}/new`}><Plus /> New order</Link></Button>}
        />
      ) : (
        <Card className="overflow-hidden">
          {data.rows.length ? <OrderTable rows={data.rows} /> : <p className="p-6 text-sm text-muted-foreground">No orders in this view.</p>}
        </Card>
      )}
      {data.pageCount > 1 && <div className="mt-4"><Pagination page={data.page} pageCount={data.pageCount} total={data.total} pageSize={data.pageSize} hrefFor={(p) => qs({ page: String(p) })} /></div>}
      {drawer}
    </>
  );
}
