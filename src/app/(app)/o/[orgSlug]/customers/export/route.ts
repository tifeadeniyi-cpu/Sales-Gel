import { NextResponse, type NextRequest } from "next/server";
import { exportCustomersCsv } from "@/domains/customers/import-export";
import { requireUser } from "@/server/auth/session";
import { loadOrgContext } from "@/server/authz/context";
import { AppError } from "@/server/errors";

export async function GET(req: NextRequest, { params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const user = await requireUser();
  const ctx = await loadOrgContext(user.id, orgSlug);
  if (!ctx) return new NextResponse("Not found", { status: 404 });
  const filters = Object.fromEntries([...req.nextUrl.searchParams.entries()].filter(([k]) => !["open", "layout", "page"].includes(k)));
  try {
    const { csv } = await exportCustomersCsv({ ...ctx, ip: req.headers.get("x-forwarded-for"), userAgent: req.headers.get("user-agent") }, { ...filters, page: 1, pageSize: 100 });
    const date = new Date().toISOString().slice(0, 10);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="customers-${orgSlug}-${date}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof AppError) return new NextResponse(err.message, { status: err.status });
    throw err;
  }
}
