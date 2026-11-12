"use client";
import { CalendarDays, Columns3, List } from "lucide-react";
import { NativeSelect } from "@/components/ui/input";
import { useUrlParams } from "@/components/app/use-url-params";
import { cn } from "@/lib/utils";

export function TaskToolbar() {
  const { params, set } = useUrlParams();
  const scope = params.get("scope") ?? "mine";
  const view = params.get("view") ?? "list";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <nav className="flex rounded-md border bg-card p-0.5" aria-label="Task scope">
        {[["mine", "My tasks"], ["all", "All tasks"], ["created", "Created by me"]].map(([k, l]) => (
          <button key={k} type="button" aria-pressed={scope === k} onClick={() => set({ scope: k === "mine" ? null : k })} className={cn("rounded px-3 py-1 text-sm", scope === k ? "bg-primary text-white" : "text-ink/70 hover:bg-muted")}>{l}</button>
        ))}
      </nav>
      <NativeSelect aria-label="Status" className="h-8 w-auto text-xs" value={params.get("status") ?? "open"} onChange={(e) => set({ status: e.target.value === "open" ? null : e.target.value })}>
        <option value="open">Open</option><option value="done">Completed</option><option value="all">All</option>
      </NativeSelect>
      <NativeSelect aria-label="Due" className="h-8 w-auto text-xs" value={params.get("due") ?? "any"} onChange={(e) => set({ due: e.target.value === "any" ? null : e.target.value })}>
        <option value="any">Any due date</option><option value="overdue">Overdue</option><option value="today">Due today</option><option value="week">Next 7 days</option><option value="none">No due date</option>
      </NativeSelect>
      <div className="ml-auto flex rounded-md border bg-card p-0.5">
        {([["list", List, "List view"], ["board", Columns3, "Board view"], ["calendar", CalendarDays, "Calendar view"]] as const).map(([k, Icon, l]) => (
          <button key={k} type="button" aria-label={l} aria-pressed={view === k} onClick={() => set({ view: k === "list" ? null : k })} className={cn("rounded p-1.5", view === k && "bg-muted")}><Icon className="size-4" /></button>
        ))}
      </div>
    </div>
  );
}
