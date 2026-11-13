"use server";
import { headers } from "next/headers";
import { startChat, visitorMessages, visitorSend } from "@/domains/inbox/webchat";
import { runAction } from "@/server/actions";

async function ip() {
  const h = await headers();
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "unknown").trim();
}
export async function startChatAction(key: string, input: unknown, page: string | null) {
  const addr = await ip();
  return runAction(() => startChat(key, input, { ip: addr, page }));
}
export async function pollChatAction(key: string, token: string) {
  return runAction(async () => (await visitorMessages(key, token)) ?? { gone: true as const });
}
export async function sendChatAction(key: string, token: string, body: string) {
  const addr = await ip();
  return runAction(() => visitorSend(key, token, { body }, { ip: addr }));
}
