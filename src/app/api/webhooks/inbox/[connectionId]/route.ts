import { NextResponse, type NextRequest } from "next/server";
import { receiveInboxWebhook, verifyInboxWebhook } from "@/domains/inbox/webhooks";
import { logger } from "@/server/logger";

export const maxDuration = 30;

/** Meta subscription check (hub.challenge). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ connectionId: string }> }) {
  const { connectionId } = await params;
  const challenge = await verifyInboxWebhook(connectionId, req.nextUrl.searchParams);
  if (challenge === null) return new NextResponse("Forbidden", { status: 403 });
  return new NextResponse(challenge, { status: 200, headers: { "content-type": "text/plain" } });
}

/** Inbound messages and delivery receipts from WhatsApp, Messenger, Instagram and Postmark. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ connectionId: string }> }) {
  const { connectionId } = await params;
  const raw = await req.text();
  try {
    const r = await receiveInboxWebhook(connectionId, raw, req.headers);
    return NextResponse.json({ ok: r.status === 200, processed: r.processed ?? 0 }, { status: r.status });
  } catch (err) {
    logger.error({ connectionId, err: err instanceof Error ? err.message : String(err) }, "inbox webhook failed");
    return NextResponse.json({ ok: false }, { status: 500 }); // provider retries
  }
}
