import { NextResponse } from "next/server";
import { getConversationAttachment } from "@/domains/inbox/service";
import { requireOrgContext } from "@/server/authz/request";

export async function GET(_req: Request, { params }: { params: Promise<{ orgSlug: string; id: string }> }) {
  const { orgSlug, id } = await params;
  const ctx = await requireOrgContext(orgSlug);
  const a = await getConversationAttachment(ctx, id).catch(() => null);
  if (!a?.content) return new NextResponse("Not found", { status: 404 });
  const inline = /^(image\/(png|jpeg|gif|webp)|application\/pdf)$/.test(a.mimeType);
  return new NextResponse(new Uint8Array(a.content), {
    headers: {
      "content-type": a.mimeType, "x-content-type-options": "nosniff", "cache-control": "private, no-store",
      "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(a.filename)}`,
    },
  });
}
