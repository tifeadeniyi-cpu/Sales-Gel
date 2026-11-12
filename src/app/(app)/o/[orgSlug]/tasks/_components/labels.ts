export const TASK_STATUS: Record<string, string> = { todo: "To do", in_progress: "In progress", done: "Done" };
export const RECURRENCE_LABEL: Record<string, string> = { none: "Doesn't repeat", daily: "Daily", weekly: "Weekly", monthly: "Monthly" };

export function toLocalInput(d: Date | string | null | undefined): string {
  if (!d) return "";
  const x = new Date(d);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}T${pad(x.getHours())}:${pad(x.getMinutes())}`;
}

export function dueLabel(d: Date | string | null, now = new Date()): string {
  if (!d) return "No due date";
  const x = new Date(d);
  const day = (a: Date) => new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const diff = Math.round((day(x) - day(now)) / 86_400_000);
  const time = x.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (diff === 0) return `Today ${time}`;
  if (diff === 1) return `Tomorrow ${time}`;
  if (diff === -1) return `Yesterday ${time}`;
  return x.toLocaleDateString([], { month: "short", day: "numeric", year: x.getFullYear() !== now.getFullYear() ? "numeric" : undefined });
}
