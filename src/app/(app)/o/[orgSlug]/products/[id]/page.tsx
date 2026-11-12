import Link from "next/link";
import { forbidden, notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getProduct, listCategories } from "@/domains/commerce/products";
import { formatMoney, minorToInput } from "@/lib/money";
import { formatRelative } from "@/lib/utils";
import { can } from "@/server/authz/guards";
import { requireOrgContext } from "@/server/authz/request";
import { ORDER_STATUS } from "../../orders/_components/labels";
import { ProductForm } from "../_components/product-form";

export default async function ProductPage({ params, searchParams }: { params: Promise<{ orgSlug: string; id: string }>; searchParams: Promise<{ edit?: string }> }) {
  const { orgSlug, id } = await params;
  const ctx = await requireOrgContext(orgSlug);
  if (!can(ctx, "products.read")) forbidden();
  const p = /^[0-9a-f-]{36}$/i.test(id) ? await getProduct(ctx, id) : null;
  if (!p) notFound();
  const canWrite = can(ctx, "products.write");
  const editing = canWrite && (await searchParams).edit === "1";
  const base = `/o/${orgSlug}/products`;
  const live = p.variants.filter((v) => v.status !== "archived");
  const currency = live[0]?.currency ?? ctx.defaultCurrency;

  if (editing) {
    return (
      <div className="mx-auto max-w-3xl">
        <Link href={`${base}/${p.id}`} className="text-sm text-primary hover:underline">← {p.name}</Link>
        <h1 className="mb-4 mt-2 text-2xl font-semibold">Edit product</h1>
        <ProductForm
          orgSlug={orgSlug}
          currencyLocked
          categories={await listCategories(ctx)}
          initial={{
            id: p.id, name: p.name, description: p.description ?? "", category: p.category ?? "", brand: p.brand ?? "", imageUrl: p.imageUrl ?? "",
            status: p.status as "active" | "draft" | "archived", currency, tags: (p.tags ?? []).join(", "),
            variants: live.map((v) => ({ id: v.id, name: v.name, sku: v.sku ?? "", price: minorToInput(v.priceAmount, v.currency), inventoryQuantity: v.inventoryQuantity === null ? "" : String(v.inventoryQuantity) })),
          }}
        />
      </div>
    );
  }

  return (
    <>
      <Link href={base} className="text-sm text-primary hover:underline">← Products</Link>
      <div className="mb-6 mt-3 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-4">
          {p.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.imageUrl} alt="" className="size-16 rounded-lg border object-cover" />
          )}
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{p.name}</h1>
            <div className="mt-1 flex flex-wrap gap-2 text-sm text-muted-foreground">
              <Badge tone={p.status === "active" ? "success" : p.status === "archived" ? "inactive" : "neutral"}>{p.status}</Badge>
              {p.category && <span>{p.category}</span>}
              {p.brand && <span>· {p.brand}</span>}
            </div>
          </div>
        </div>
        {canWrite && <Link href={`${base}/${p.id}?edit=1`} className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted">Edit product</Link>}
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader><CardTitle>Variants</CardTitle></CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1">Variant</th><th>SKU</th><th>Price</th><th>Stock</th></tr></thead>
                <tbody className="divide-y">
                  {live.map((v) => (
                    <tr key={v.id}><td className="py-2">{v.name}</td><td>{v.sku ?? "—"}</td><td className="font-medium">{formatMoney(v.priceAmount, v.currency)}</td><td>{v.inventoryQuantity ?? <span className="text-muted-foreground">Not tracked</span>}</td></tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
          {p.description && <Card><CardHeader><CardTitle>Description</CardTitle></CardHeader><CardContent className="whitespace-pre-wrap text-sm">{p.description}</CardContent></Card>}
          {can(ctx, "orders.read") && (
            <Card>
              <CardHeader><CardTitle>Recent orders</CardTitle></CardHeader>
              <CardContent>
                {p.recentOrders.length === 0 ? <p className="text-sm text-muted-foreground">Not ordered yet.</p> : (
                  <ul className="divide-y text-sm">
                    {p.recentOrders.map((o, i) => (
                      <li key={`${o.orderId}-${i}`} className="flex items-center gap-2 py-2">
                        <Link href={`/o/${orgSlug}/orders/${o.orderId}`} className="font-medium hover:underline">ORD-{o.number}</Link>
                        <span className="flex-1 text-muted-foreground">{o.quantity} × {o.variantName ?? "Default"}</span>
                        <Badge tone={ORDER_STATUS[o.status]?.tone}>{ORDER_STATUS[o.status]?.label}</Badge>
                        {o.lineTotal !== null && <span className="w-24 text-right">{formatMoney(o.lineTotal, o.currency)}</span>}
                        <span className="w-24 text-right text-xs text-muted-foreground">{formatRelative(o.placedAt)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}
        </div>
        {can(ctx, "orders.read") && (
          <Card className="h-fit">
            <CardHeader><CardTitle>Sales</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              {p.sales.length === 0 ? <p className="text-muted-foreground">No sales yet.</p> : p.sales.map((s) => (
                <div key={s.currency} className="space-y-1">
                  <div className="flex justify-between"><span className="text-muted-foreground">Orders</span><span>{s.orders}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Units sold</span><span>{s.units}</span></div>
                  {s.revenue !== null && <div className="flex justify-between"><span className="text-muted-foreground">Booked ({s.currency})</span><span className="font-medium">{formatMoney(s.revenue, s.currency)}</span></div>}
                </div>
              ))}
              <p className="pt-2 text-xs text-muted-foreground">Excludes cancelled orders. Booked value is before refunds.</p>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
