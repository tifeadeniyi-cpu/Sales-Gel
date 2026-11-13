import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { resolveRoute } from "@/domains/integrations/connections";
import { integrationConnections } from "@/domains/integrations/schema";
import { normalizeShopDomain, shopifyConfig, verifyWebhookHmac } from "@/domains/integrations/shopify/client";
import { recordWebhook } from "@/domains/integrations/webhooks";
import { withScope } from "@/server/db/tenant";
import { kickWorker } from "@/server/jobs/kick";
import { logger } from "@/server/logger";

export const maxDuration = 30;
const COMPLIANCE_TOPICS = new Set(["customers/data_request", "customers/redact", "shop/redact"]);

/**
 * Shopify → SalesGel (app-specific and compliance topics). HMAC is checked against the app secret
 * before anything else; the shop domain routes the delivery to its workspace.
 */
export async function POST(req: Request) {
  const cfg = shopifyConfig();
  if (!cfg) return new NextResponse("Not configured", { status: 503 });
  const raw = await req.text();
  if (!verifyWebhookHmac(raw, req.headers.get("x-shopify-hmac-sha256"), cfg.clientSecret)) {
    logger.warn({ topic: req.headers.get("x-shopify-topic") }, "shopify webhook hmac rejected");
    return new NextResponse("Invalid signature", { status: 401 });
  }
  const topic = req.headers.get("x-shopify-topic") ?? "";
  const shop = normalizeShopDomain(req.headers.get("x-shopify-shop-domain") ?? "");
  const eventId = req.headers.get("x-shopify-webhook-id") ?? req.headers.get("x-shopify-event-id");
  if (!shop || !eventId || !topic) return new NextResponse("Bad request", { status: 400 });
  const route = await resolveRoute("shopify", { externalAccountId: shop });
  // Unknown shop (never connected, or already disconnected): acknowledge so Shopify stops retrying.
  if (!route) return NextResponse.json({ received: true, routed: false });
  const conn = await withScope({ orgId: route.organizationId }, async (tx) => {
    const [c] = await tx.select({ id: integrationConnections.id, status: integrationConnections.status }).from(integrationConnections).where(eq(integrationConnections.id, route.connectionId));
    return c ?? null;
  });
  if (!conn) return NextResponse.json({ received: true, routed: false });
  // After disconnect only privacy requests are still processed.
  if (conn.status === "disconnected" && !COMPLIANCE_TOPICS.has(topic)) return NextResponse.json({ received: true, routed: false });
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return new NextResponse("Bad request", { status: 400 });
  }
  const res = await recordWebhook(route.organizationId, { connectionId: conn.id, provider: "shopify", providerEventId: eventId, topic, payload });
  if (!res.duplicate) kickWorker(route.organizationId, 15_000);
  return NextResponse.json({ received: true, duplicate: res.duplicate });
}
