import { CHANNELS, CUSTOMER_SOURCES, SOURCE_LABELS } from "@/domains/customers/validation";

export const SOURCE_OPTIONS = CUSTOMER_SOURCES.map((s) => ({ value: s, label: SOURCE_LABELS[s] }));
export const CHANNEL_LABELS: Record<(typeof CHANNELS)[number], string> = {
  email: "Email", phone: "Phone call", whatsapp: "WhatsApp", instagram: "Instagram", facebook: "Facebook", sms: "SMS",
};
export const CHANNEL_OPTIONS = CHANNELS.map((c) => ({ value: c, label: CHANNEL_LABELS[c] }));
export const TYPE_OPTIONS = [{ value: "person", label: "Person" }, { value: "business", label: "Business" }];
export const CURRENCY_OPTIONS = ["USD", "CAD", "GBP", "EUR", "NGN", "GHS", "KES", "ZAR", "AUD"].map((c) => ({ value: c, label: c }));
export const PROVIDER_LABELS: Record<string, string> = { instagram: "Instagram", facebook: "Facebook", whatsapp: "WhatsApp", tiktok: "TikTok", x: "X", shopify: "Shopify", other: "Other" };

export const MARKETING: Record<string, { label: string; tone: "success" | "danger" | "inactive" }> = {
  subscribed: { label: "Subscribed", tone: "success" },
  unsubscribed: { label: "Unsubscribed", tone: "danger" },
  unknown: { label: "No consent", tone: "inactive" },
};

export const STATUS: Record<string, { label: string; tone: "success" | "warning" | "inactive" | "info" }> = {
  active: { label: "Active", tone: "success" },
  provisional: { label: "Provisional", tone: "warning" },
  archived: { label: "Archived", tone: "inactive" },
  merged: { label: "Merged", tone: "info" },
};

export const TAG_TONES: Record<string, string> = {
  teal: "bg-primary/10 text-primary border-primary/20",
  gold: "bg-highlight/15 text-[#7a5a2c] border-highlight/30",
  blue: "bg-info/10 text-info border-info/20",
  green: "bg-success/10 text-success border-success/20",
  red: "bg-danger/10 text-danger border-danger/20",
  gray: "bg-muted text-ink border-border",
  purple: "bg-purple-100 text-purple-800 border-purple-200",
};

export function sourceLabel(s: string | null) {
  return s ? (SOURCE_LABELS as Record<string, string>)[s] ?? s : "—";
}
