import { NextResponse, type NextRequest } from "next/server";
import { voicemailAudio } from "@/domains/phone/calls";
import { requireOrgContext } from "@/server/authz/request";
import { AppError } from "@/server/errors";

/** Voicemail audio, streamed through the app with the caller's permissions (Twilio credentials stay server-side). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ orgSlug: string; voicemailId: string }> }) {
  const { orgSlug, voicemailId } = await params;
  const ctx = await requireOrgContext(orgSlug);
  try {
    const audio = await voicemailAudio(ctx, voicemailId);
    return new NextResponse(new Uint8Array(audio), { headers: { "content-type": "audio/mpeg", "cache-control": "private, no-store", "content-length": String(audio.length) } });
  } catch (e) {
    if (e instanceof AppError) return new NextResponse(e.message, { status: e.status });
    throw e;
  }
}
