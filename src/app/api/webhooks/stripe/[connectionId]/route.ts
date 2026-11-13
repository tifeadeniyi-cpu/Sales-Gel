import { NextResponse } from "next/server";
import { activeConnection, resolveRoute } from "@/domains/integrations/connections";
import { stripeSecretsFor, verifyStripeEvent } from "@/domains/integrations/stripe";
import { recordWebhook } from "@/domains/integrations/webhooks";
import { withScope } from "@/server/db/tenant";
import { kickWorker } from "@/server/jobs/kick";
import { logger } from "@/server/logger";

export const maxDuration = 30;

/** Stripe → SalesGel. Verify the signature with this connection's secret, store once, process in the background. */
export async function POST(req: Request, { params }: { params: Promise<{ connectionId: string }> }) {
  const { connectionId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(connectionId)) return new NextResponse("Not found", { status: 404 });
  const route = await resolveRoute("stripe", { connectionId });
  if (!route) return new NextResponse("Not found", { status: 404 });
  const raw = await req.text();
  const conn = await withScope({ orgId: route.organizationId }, (tx) => activeConnection(tx, route.organizationId, "stripe"));
  if (!conn || conn.id !== connectionId) return new NextResponse("Not found", { status: 404 });
  let event;
  try {
    event = verifyStripeEvent(raw, req.headers.get("stripe-signature"), stripeSecretsFor(conn).webhookSecret);
  } catch (err) {
    logger.warn({ connectionId, err: err instanceof Error ? err.message : String(err) }, "stripe webhook signature rejected");
    return new NextResponse("Invalid signature", { status: 400 });
  }
  const res = await recordWebhook(route.organizationId, { connectionId, provider: "stripe", providerEventId: event.id, topic: event.type, payload: event as unknown as Record<string, unknown> });
  if (!res.duplicate) kickWorker(route.organizationId, 15_000);
  return NextResponse.json({ received: true, duplicate: res.duplicate });
}
