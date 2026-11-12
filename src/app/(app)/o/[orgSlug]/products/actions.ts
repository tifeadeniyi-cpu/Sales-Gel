"use server";
import { revalidatePath } from "next/cache";
import { runAction } from "@/server/actions";
import { requireOrgContext } from "@/server/authz/request";
import * as svc from "@/domains/commerce/products";
import type { ProductInput } from "@/domains/commerce/validation";

const refresh = (slug: string) => revalidatePath(`/o/${slug}`, "layout");

export async function createProductAction(orgSlug: string, input: ProductInput) {
  const ctx = await requireOrgContext(orgSlug);
  const res = await runAction(() => svc.createProduct(ctx, input));
  if (res.ok) refresh(orgSlug);
  return res;
}
export async function updateProductAction(orgSlug: string, id: string, input: ProductInput) {
  const ctx = await requireOrgContext(orgSlug);
  const res = await runAction(() => svc.updateProduct(ctx, id, input));
  if (res.ok) refresh(orgSlug);
  return res;
}
export async function setProductStatusAction(orgSlug: string, id: string, status: "active" | "draft" | "archived") {
  const ctx = await requireOrgContext(orgSlug);
  const res = await runAction(() => svc.setProductStatus(ctx, id, status));
  if (res.ok) refresh(orgSlug);
  return res;
}
