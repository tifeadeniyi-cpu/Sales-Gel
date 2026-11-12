"use client";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useUrlParams } from "@/components/app/use-url-params";
import type { TaskView } from "@/domains/tasks/service";
import { cn } from "@/lib/utils";

/** Month grid of tasks by due date (browser's local time). */
export function TaskCalendar({ tasks, month }: { tasks: TaskView[]; month: string }) {
  const { set, params } = useUrlParams();
  const [y, m] = month.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const start = new Date(first);
  start.setDate(1 - ((first.getDay() + 6) % 7)); // Monday start
  const days = Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  const key = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const byDay = new Map<string, TaskView[]>();
  for (const t of tasks) if (t.dueAt) { const k = key(new Date(t.dueAt)); byDay.set(k, [...(byDay.get(k) ?? []), t]); }
  const today = key(new Date());
  const shift = (n: number) => { const d = new Date(y, m - 1 + n, 1); set({ month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}` }); };
  const qs = (id: string) => { const p = new URLSearchParams(params.toString()); p.set("open", id); return `?${p.toString()}`; };

  return (
    <div className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <button type="button" onClick={() => shift(-1)} aria-label="Previous month" className="rounded p-1 hover:bg-muted"><ChevronLeft className="size-4" /></button>
        <h2 className="w-40 text-center font-semibold">{first.toLocaleDateString([], { month: "long", year: "numeric" })}</h2>
        <button type="button" onClick={() => shift(1)} aria-label="Next month" className="rounded p-1 hover:bg-muted"><ChevronRight className="size-4" /></button>
      </div>
      <div className="grid grid-cols-7 overflow-hidden rounded-lg border text-xs">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="border-b bg-muted/50 px-2 py-1 font-medium text-muted-foreground">{d}</div>)}
        {days.map((d) => {
          const items = byDay.get(key(d)) ?? [];
          return (
            <div key={d.toISOString()} className={cn("min-h-24 border-b border-r p-1", d.getMonth() !== m - 1 && "bg-muted/30 text-muted-foreground")}>
              <div className={cn("mb-1 inline-flex size-5 items-center justify-center rounded-full", key(d) === today && "bg-primary text-white")}>{d.getDate()}</div>
              <ul className="space-y-0.5">
                {items.slice(0, 3).map((t) => (
                  <li key={t.id}>
                    <Link href={qs(t.id)} scroll={false} className={cn("block truncate rounded px-1 py-0.5", t.status === "done" ? "bg-success/10 text-success line-through" : t.overdue ? "bg-danger/10 text-danger" : "bg-primary/10 text-primary")}>{t.title}</Link>
                  </li>
                ))}
                {items.length > 3 && <li className="px-1 text-muted-foreground">+{items.length - 3} more</li>}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
