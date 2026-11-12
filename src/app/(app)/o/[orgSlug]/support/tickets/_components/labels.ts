type Tone = "neutral" | "brand" | "success" | "warning" | "danger" | "info" | "inactive" | "highlight";
export const PRIORITY: Record<string, { label: string; tone: Tone }> = {
  urgent: { label: "Urgent", tone: "danger" },
  high: { label: "High", tone: "warning" },
  normal: { label: "Normal", tone: "neutral" },
  low: { label: "Low", tone: "inactive" },
};
export const CATEGORY_TONE: Record<string, Tone> = {
  new: "brand", open: "info", pending_customer: "highlight", pending_internal: "highlight", escalated: "danger", resolved: "success", closed: "inactive",
};
export const ticketNo = (n: number) => `TCK-${n}`;
