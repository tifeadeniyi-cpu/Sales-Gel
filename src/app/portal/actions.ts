"use server";
import { headers } from "next/headers";
import { replyPortalTicket, submitPortalTicket } from "@/domains/support/portal";
import { runAction } from "@/server/actions";

async function clientIp() {
  const h = await headers();
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "unknown").trim();
}

export async function submitPortalAction(slug: string, input: unknown) {
  const ip = await clientIp();
  return runAction(() => submitPortalTicket(slug, input, { ip }));
}

export async function replyPortalAction(slug: string, token: string, body: string) {
  const ip = await clientIp();
  return runAction(() => replyPortalTicket(slug, token, { body }, { ip }));
}
