import { Camera, Globe, Mail, MessageCircle, MessagesSquare } from "lucide-react";
import type { Channel } from "@/domains/inbox/schema";
import { CHANNEL_LABELS } from "@/domains/inbox/labels";
import { cn } from "@/lib/utils";

const ICON = { webchat: Globe, email: Mail, whatsapp: MessageCircle, messenger: MessagesSquare, instagram: Camera } as const;
const TONE: Record<Channel, string> = { webchat: "bg-primary/10 text-primary", email: "bg-slate-100 text-slate-700", whatsapp: "bg-emerald-50 text-emerald-700", messenger: "bg-blue-50 text-blue-700", instagram: "bg-pink-50 text-pink-700" };

export function ChannelIcon({ channel, className }: { channel: Channel; className?: string }) {
  const I = ICON[channel];
  return (
    <span className={cn("inline-flex size-7 shrink-0 items-center justify-center rounded-full", TONE[channel], className)} title={CHANNEL_LABELS[channel]}>
      <I className="size-3.5" aria-hidden /><span className="sr-only">{CHANNEL_LABELS[channel]}</span>
    </span>
  );
}
