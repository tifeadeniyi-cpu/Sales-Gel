import { NextResponse, type NextRequest } from "next/server";
import { handleDialResult, handleRecording, handleStatus, handleVoice, verified, voicemailDone, type Params } from "@/domains/phone/voice";
import { kickWorker } from "@/server/jobs/kick";
import { appUrl } from "@/server/app-url";
import { logger } from "@/server/logger";

export const maxDuration = 30;

const HOOKS = new Set(["voice", "status", "dial-result", "recording", "voicemail-done"]);
const xml = (body: string, status = 200) => new NextResponse(body, { status, headers: { "content-type": "text/xml; charset=utf-8" } });

/** Twilio voice webhooks. Each request is verified against the workspace subaccount's signature before anything happens. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ accountId: string; hook: string }> }) {
  const { accountId, hook } = await params;
  if (!HOOKS.has(hook)) return new NextResponse("Not found", { status: 404 });
  const form = await req.formData();
  const p: Params = {};
  for (const [k, v] of form.entries()) if (typeof v === "string") p[k] = v;
  // Twilio signs the exact public URL it called, including the query string.
  const url = `${appUrl()}${req.nextUrl.pathname}${req.nextUrl.search}`;
  const account = await verified(accountId, url, p, req.headers.get("x-twilio-signature"));
  if (!account) return new NextResponse("Forbidden", { status: 403 });
  const q = req.nextUrl.searchParams;
  try {
    switch (hook) {
      case "voice": return xml(await handleVoice(account, p));
      case "dial-result": return xml(await handleDialResult(account, p, q));
      case "voicemail-done": return xml(voicemailDone());
      case "status": { await handleStatus(account, p, q); kickWorker(account.organizationId); return new NextResponse(null, { status: 204 }); }
      case "recording": { await handleRecording(account, p, q); return new NextResponse(null, { status: 204 }); }
    }
  } catch (err) {
    logger.error({ accountId, hook, err: err instanceof Error ? err.message : String(err) }, "telephony webhook failed");
    if (hook === "voice" || hook === "dial-result") return xml('<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Polly.Joanna">Sorry, something went wrong. Please try again later.</Say><Hangup/></Response>');
    return new NextResponse(null, { status: 500 });
  }
  return new NextResponse(null, { status: 204 });
}
