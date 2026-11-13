/** Live state for display: the worker may lag, so "overdue" is computed from the clock too. */
export type SlaState = "none" | "met" | "on_track" | "at_risk" | "overdue" | "breached" | "paused";
export function slaClock(due: Date | null, done: boolean, breachedAt: Date | null, now = new Date(), opts: { paused?: boolean; met?: boolean; atRiskMinutes?: number } = {}): SlaState {
  if (breachedAt) return "breached";
  if (opts.met || done) return due || breachedAt ? "met" : "none";
  if (opts.paused) return "paused";
  if (!due) return "none";
  const left = due.getTime() - now.getTime();
  if (left <= 0) return "overdue";
  if (left <= (opts.atRiskMinutes ?? 60) * 60_000) return "at_risk";
  return "on_track";
}

export const SLA_LABEL: Record<SlaState, string> = { none: "No target", met: "Met", on_track: "On track", at_risk: "Due soon", overdue: "Overdue", breached: "Missed", paused: "Paused" };
export const SLA_TONE: Record<SlaState, "neutral" | "success" | "brand" | "warning" | "danger" | "inactive"> = { none: "inactive", met: "success", on_track: "brand", at_risk: "warning", overdue: "danger", breached: "danger", paused: "inactive" };
