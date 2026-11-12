export const PRIORITY: Record<string, { label: string; tone: "inactive" | "info" | "warning" | "danger" }> = {
  low: { label: "Low", tone: "inactive" },
  medium: { label: "Medium", tone: "info" },
  high: { label: "High", tone: "warning" },
  urgent: { label: "Urgent", tone: "danger" },
};
export const PRIORITY_OPTIONS = Object.entries(PRIORITY).map(([value, v]) => ({ value, label: v.label }));
export const LEAD_STATUS: Record<string, { label: string; tone: "info" | "success" | "danger" }> = {
  open: { label: "Open", tone: "info" },
  won: { label: "Won", tone: "success" },
  lost: { label: "Lost", tone: "danger" },
};
export const STAGE_BAR: Record<string, string> = {
  teal: "bg-teal-ink", blue: "bg-primary", gold: "bg-highlight", purple: "bg-purple-500", gray: "bg-inactive", green: "bg-success", red: "bg-danger",
};
