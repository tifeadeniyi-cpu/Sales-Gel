import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { completeShopifyConnect, readState, SHOPIFY_STATE_COOKIE } from "@/domains/integrations/shopify/connect";
import { getSessionUser } from "@/server/auth/session";
import { loadOrgContext } from "@/server/authz/context";
import { appUrl } from "@/server/app-url";
import { AppError } from "@/server/errors";
import { kickWorker } from "@/server/jobs/kick";
import { logger } from "@/server/logger";

export const maxDuration = 30;

/** Shopify OAuth callback. The signed state cookie says which workspace started the flow. */
export async function GET(req: NextRequest) {
  const jar = await cookies();
  const raw = jar.get(SHOPIFY_STATE_COOKIE)?.value;
  jar.delete(SHOPIFY_STATE_COOKIE);
  const state = readState(raw);
  const user = await getSessionUser();
  if (!user) return NextResponse.redirect(`${appUrl()}/sign-in`);
  if (!state) return NextResponse.redirect(`${appUrl()}/?shopify=expired`);
  const ctx = await loadOrgContext(user.id, state.slug);
  const back = (q: string) => NextResponse.redirect(`${appUrl()}/o/${state.slug}/integrations?${q}`);
  if (!ctx) return NextResponse.redirect(`${appUrl()}/`);
  try {
    await completeShopifyConnect(ctx, req.nextUrl.searchParams, raw);
    kickWorker(ctx.orgId, 20_000);
    return back("shopify=connected");
  } catch (err) {
    const msg = err instanceof AppError ? err.message : "Shopify connection failed. Try again.";
    if (!(err instanceof AppError)) logger.error({ err: err instanceof Error ? err.message : String(err) }, "shopify callback failed");
    return back(`shopify_error=${encodeURIComponent(msg)}`);
  }
}
