import { NextResponse } from "next/server";
import { safeEqual } from "@/server/crypto";
import { runDueWork } from "@/server/jobs/worker";

export const maxDuration = 60;

/** Background worker entry point, called by Vercel Cron with `Authorization: Bearer $CRON_SECRET`. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) return new NextResponse("Unauthorized", { status: 401 });
  const result = await runDueWork({ budgetMs: 50_000, maxOrgs: 200 });
  return NextResponse.json(result);
}
