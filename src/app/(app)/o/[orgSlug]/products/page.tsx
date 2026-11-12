import Link from "next/link";
import { forbidden } from "next/navigation";
import { Package, Plus } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, NativeSelect } from "@/components/ui/input";
import { listCategories, listProducts } from "@/domains/commerce/products";
import { formatMoney } from "@/lib/money";
import { can } from "@/server/authz/guards";
import { requireOrgContext } from "@/server/authz/request";

const STATUS_TONE = { active: "success", draft: "neutral", archived: "inactive" } as const;

export default async function ProductsPage({ params, searchParams }: { params: Promise<{ orgSlug: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { orgSlug } = await params;
  const ctx = await requireOrgContext(orgSlug);
  if (!can(ctx, "products.read")) forbidden();
  const sp = await searchParams;
  const status = ["active", "draft", "archived", "all"].includes(sp.status ?? "") ? sp.status : undefined;
  const q = sp.q?.slice(0, 120);
  const [rows, categories] = await Promise.all([listProducts(ctx, { q, status, category: sp.category || undefined }), listCategories(ctx)]);
  const base = `/o/${orgSlug}/products`;
  const canWrite = can(ctx, "products.write");
  const filtered = !!(q || status || sp.category);

  return (
    <>
      <PageHeader
        title="Products & Catalog"
        description="Products, variants and prices you sell. Prices are copied onto each order, so edits never change past orders."
        actions={canWrite && <Button asChild><Link href={`${base}/new`}><Plus /> New product</Link></Button>}
      />
      <form className="mb-4 flex flex-wrap gap-2" action={base}>
        <Input name="q" defaultValue={q} placeholder="Search name or SKU…" className="max-w-xs" aria-label="Search products" />
        <NativeSelect name="status" defaultValue={status ?? ""} className="w-40" aria-label="Status">
          <option value="">Active & draft</option>
          <option value="active">Active</option>
          <option value="draft">Draft</option>
          <option value="archived">Archived</option>
          <option value="all">All</option>
        </NativeSelect>
        {categories.length > 0 && (
          <NativeSelect name="category" defaultValue={sp.category ?? ""} className="w-44" aria-label="Category">
            <option value="">All categories</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </NativeSelect>
        )}
        <Button type="submit" variant="outline">Filter</Button>
        {filtered && <Button asChild variant="ghost"><Link href={base}>Clear</Link></Button>}
      </form>
      {rows.length === 0 ? (
        filtered ? <Card className="p-6 text-sm text-muted-foreground">No products match.</Card> : (
          <EmptyState
            icon={<Package className="size-8" />}
            title="No products yet"
            description="Add the products you sell so orders can be created from your catalog. Store sync (Shopify, WooCommerce) arrives in Phase 6."
            action={canWrite && <Button asChild><Link href={`${base}/new`}><Plus /> New product</Link></Button>}
          />
        )
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50">
                <tr>{["Product", "Category", "Variants", "Price", "Stock", "Status"].map((h) => <th key={h} className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((p) => (
                  <tr key={p.id} className="hover:bg-muted/30">
                    <td className="px-3 py-2.5">
                      <Link href={`${base}/${p.id}`} className="font-medium hover:underline">{p.name}</Link>
                      {p.skus.length > 0 && <div className="text-xs text-muted-foreground">{p.skus.slice(0, 3).join(", ")}{p.skus.length > 3 ? "…" : ""}</div>}
                    </td>
                    <td className="px-3 py-2.5">{p.category ?? "—"}</td>
                    <td className="px-3 py-2.5">{p.variantCount}</td>
                    <td className="px-3 py-2.5 font-medium">{p.minPrice === null ? "—" : p.minPrice === p.maxPrice ? formatMoney(p.minPrice, p.currency) : `${formatMoney(p.minPrice, p.currency)} – ${formatMoney(p.maxPrice, p.currency)}`}</td>
                    <td className="px-3 py-2.5">{p.inventory === null ? <span className="text-muted-foreground">Not tracked</span> : p.inventory}</td>
                    <td className="px-3 py-2.5"><Badge tone={STATUS_TONE[p.status as keyof typeof STATUS_TONE] ?? "neutral"}>{p.status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
