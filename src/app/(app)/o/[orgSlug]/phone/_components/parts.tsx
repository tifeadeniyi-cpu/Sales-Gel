import Link from "next/link";
import { PhoneIncoming, PhoneOutgoing } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { LinkTabs } from "@/components/ui/tabs";

export function formatDuration(sec: number | null | undefined) {
  if (sec === null || sec === undefined) return "—";
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

const OUTCOME: Record<string, { label: string; tone: "success" | "danger" | "warning" | "neutral" | "info" }> = {
  answered: { label: "Answered", tone: "success" },
  missed: { label: "Missed", tone: "danger" },
  voicemail: { label: "Voicemail", tone: "warning" },
  no_answer: { label: "No answer", tone: "neutral" },
  busy: { label: "Busy", tone: "neutral" },
  failed: { label: "Failed", tone: "danger" },
  canceled: { label: "Canceled", tone: "neutral" },
};
export function OutcomeBadge({ outcome, status }: { outcome: string | null; status: string }) {
  if (!outcome) return <Badge tone="info">{status === "in_progress" ? "On call" : "Ringing"}</Badge>;
  const o = OUTCOME[outcome] ?? { label: outcome, tone: "neutral" as const };
  return <Badge tone={o.tone}>{o.label}</Badge>;
}

export function DirectionIcon({ direction }: { direction: string }) {
  return direction === "inbound"
    ? <PhoneIncoming className="size-4 text-info" aria-label="Inbound" />
    : <PhoneOutgoing className="size-4 text-primary" aria-label="Outbound" />;
}

export type PhoneSection = "overview" | "calls" | "voicemail" | "settings";
export function PhoneSubnav({ orgSlug, active, canManage, newVoicemails }: { orgSlug: string; active: PhoneSection; canManage: boolean; newVoicemails?: number }) {
  const base = `/o/${orgSlug}/phone`;
  const tabs = [
    { key: "overview", label: "Overview", href: base },
    { key: "calls", label: "Calls", href: `${base}/calls` },
    { key: "voicemail", label: newVoicemails ? `Voicemail (${newVoicemails})` : "Voicemail", href: `${base}/voicemail` },
  ];
  if (canManage) tabs.push({ key: "settings", label: "Numbers & settings", href: `${base}/settings` });
  return <div className="mb-6"><LinkTabs active={active} tabs={tabs} /></div>;
}

export function CustomerOrNumber({ orgSlug, customerId, name, number }: { orgSlug: string; customerId: string | null; name: string | null; number: string }) {
  return customerId && name
    ? <span><Link href={`/o/${orgSlug}/customers/${customerId}`} className="font-medium text-primary hover:underline">{name}</Link> <span className="text-xs text-muted-foreground">{number}</span></span>
    : <span className="font-medium tabular-nums">{number}</span>;
}
