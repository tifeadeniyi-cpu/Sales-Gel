import Link from "next/link";
import { forbidden } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { listCategories } from "@/domains/commerce/products";
import { can } from "@/server/authz/guards";
import { requireOrgContext } from "@/server/authz/request";
import { ProductForm } from "../_components/product-form";
import { emptyProduct } from "../_components/product-defaults";

export default async function NewProductPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const ctx = await requireOrgContext(orgSlug);
  if (!can(ctx, "products.write")) forbidden();
  return (
    <div className="mx-auto max-w-3xl">
      <Link href={`/o/${orgSlug}/products`} className="text-sm text-primary hover:underline">← Products</Link>
      <PageHeader title="New product" />
      <ProductForm orgSlug={orgSlug} initial={emptyProduct(ctx.defaultCurrency)} categories={await listCategories(ctx)} />
    </div>
  );
}
