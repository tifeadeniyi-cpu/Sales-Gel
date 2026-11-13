"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { runAction, str } from "@/server/actions";
import { requireOrgContext } from "@/server/authz/request";
import { kickWorker } from "@/server/jobs/kick";
import { connectStripe, disconnectStripe } from "@/domains/integrations/stripe";
import { disconnectShopify, SHOPIFY_STATE_COOKIE, startShopifyConnect, syncShopifyNow } from "@/domains/integrations/shopify/connect";

const done = (slug: string) => revalidatePath(`/o/${slug}/integrations`);

export async function connectStripeAction(orgSlug: string, apiKey: string) {
  const ctx = await requireOrgContext(orgSlug);
  const res = await runAction(() => connectStripe(ctx, { apiKey }));
  if (res.ok) done(orgSlug);
  return res;
}

export async function disconnectStripeAction(orgSlug: string) {
  const ctx = await requireOrgContext(orgSlug);
  const res = await runAction(() => disconnectStripe(ctx));
  if (res.ok) done(orgSlug);
  return res;
}

/** Returns Shopify's authorize URL; the browser navigates there. */
export async function startShopifyAction(orgSlug: string, fd: FormData) {
  const ctx = await requireOrgContext(orgSlug);
  return runAction(async () => {
    const r = startShopifyConnect(ctx, { shop: str(fd, "shop") ?? "" });
    (await cookies()).set(SHOPIFY_STATE_COOKIE, r.cookie, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/integrations/shopify", maxAge: r.maxAge });
    return { url: r.url };
  });
}

export async function disconnectShopifyAction(orgSlug: string) {
  const ctx = await requireOrgContext(orgSlug);
  const res = await runAction(() => disconnectShopify(ctx));
  if (res.ok) done(orgSlug);
  return res;
}

export async function syncShopifyAction(orgSlug: string) {
  const ctx = await requireOrgContext(orgSlug);
  const res = await runAction(() => syncShopifyNow(ctx));
  if (res.ok) { kickWorker(ctx.orgId, 20_000); done(orgSlug); }
  return res;
}
