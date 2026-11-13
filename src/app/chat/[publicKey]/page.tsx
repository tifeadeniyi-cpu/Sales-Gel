import type { Metadata } from "next";
import { getWidgetConfig } from "@/domains/inbox/webchat";
import { ChatWindow } from "./chat-window";

export const metadata: Metadata = { title: "Chat", robots: { index: false, follow: false } };

export default async function ChatPage({ params, searchParams }: { params: Promise<{ publicKey: string }>; searchParams: Promise<{ page?: string }> }) {
  const { publicKey } = await params;
  const { page } = await searchParams;
  const cfg = await getWidgetConfig(publicKey);
  if (!cfg) return <main className="grid h-dvh place-items-center p-6 text-center text-sm text-muted-foreground">Chat isn&apos;t available right now.</main>;
  return <ChatWindow publicKey={publicKey} cfg={cfg} page={page ?? null} />;
}
