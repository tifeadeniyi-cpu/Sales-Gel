import type { Channel } from "./schema";

export const CHANNEL_LABELS: Record<Channel, string> = { webchat: "Web chat", email: "Email", whatsapp: "WhatsApp", messenger: "Messenger", instagram: "Instagram" };
export const STATUS_LABELS = { open: "Open", pending: "Pending", closed: "Closed" } as const;
export const INBOX_VIEWS = ["mine", "unassigned", "open", "pending", "closed", "all"] as const;
export const VIEW_LABELS: Record<(typeof INBOX_VIEWS)[number], string> = { mine: "Mine", unassigned: "Unassigned", open: "All open", pending: "Pending", closed: "Closed", all: "All" };
export const DELIVERY_LABELS: Record<string, string> = { received: "Received", queued: "Sending…", sent: "Sent", delivered: "Delivered", read: "Read", failed: "Failed" };
/** Channels with a 24-hour customer-service window for free-form replies. */
export const WINDOWED: Channel[] = ["whatsapp", "messenger", "instagram"];
