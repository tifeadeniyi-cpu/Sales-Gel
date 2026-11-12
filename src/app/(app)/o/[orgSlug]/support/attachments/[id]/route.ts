import { NextResponse } from "next/server";
import { getTicketAttachment } from "@/domains/support/service";
import { requireOrgContext } from "@/server/authz/request";

const INLINE = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf"]);

export async function GET(req: Request, { params }: { params: Promise<{ orgSlug: string; id: string }> }) {
  const { orgSlug, id } = await params;
  const ctx = await requireOrgContext(orgSlug);
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("Not found", { status: 404 });
  const f = await getTicketAttachment(ctx, id).catch(() => null);
  if (!f || !f.content) return new NextResponse("Not found", { status: 404 });
  const download = new URL(req.url).searchParams.has("download") || !INLINE.has(f.mimeType);
  const name = encodeURIComponent(f.filename);
  return new NextResponse(new Uint8Array(f.content), {
    headers: {
      "Content-Type": f.mimeType,
      "Content-Length": String(f.size),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${name}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
