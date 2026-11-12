"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useUrlParams } from "@/components/app/use-url-params";
import type { TaskView } from "@/domains/tasks/service";
import { cn } from "@/lib/utils";
import { setTaskDoneAction, updateTaskAction } from "../actions";
import { dueLabel, TASK_STATUS } from "./labels";

const COLS = ["todo", "in_progress", "done"] as const;

export function TaskBoard({ orgSlug, tasks: initial, canWrite }: { orgSlug: string; tasks: TaskView[]; canWrite: boolean }) {
  const [tasks, setTasks] = useState(initial);
  const [source, setSource] = useState(initial);
  if (source !== initial) {
    setSource(initial);
    setTasks(initial);
  }
  const [drag, setDrag] = useState<string | null>(null);
  const [, start] = useTransition();
  const { set } = useUrlParams();

  const move = (id: string, status: (typeof COLS)[number]) => {
    const t = tasks.find((x) => x.id === id);
    if (!t || t.status === status) return;
    const prev = tasks;
    setTasks(tasks.map((x) => (x.id === id ? { ...x, status } : x)));
    start(async () => {
      let res;
      if (status === "done") res = await setTaskDoneAction(orgSlug, id, true);
      else if (t.status === "done") {
        res = await setTaskDoneAction(orgSlug, id, false);
        if (res.ok && status === "in_progress") res = await updateTaskAction(orgSlug, id, { status });
      } else res = await updateTaskAction(orgSlug, id, { status });
      if (!res.ok) { setTasks(prev); toast.error(res.error); }
    });
  };

  return (
    <div className="grid gap-3 p-4 md:grid-cols-3">
      {COLS.map((c) => (
        <section key={c} aria-label={TASK_STATUS[c]} className="rounded-lg border bg-muted/40" onDragOver={(e) => canWrite && e.preventDefault()} onDrop={() => { if (drag) move(drag, c); setDrag(null); }}>
          <h2 className="border-b px-3 py-2 text-sm font-semibold">{TASK_STATUS[c]} <span className="text-xs font-normal text-muted-foreground">{tasks.filter((t) => t.status === c).length}</span></h2>
          <ul className="flex min-h-24 flex-col gap-2 p-2">
            {tasks.filter((t) => t.status === c).map((t) => (
              <li key={t.id} draggable={canWrite} onDragStart={() => setDrag(t.id)} onDragEnd={() => setDrag(null)} className={cn("rounded-md border bg-card p-2.5 shadow-xs", drag === t.id && "opacity-40")}>
                <button type="button" className="w-full text-left" onClick={() => set({ open: t.id })}>
                  <div className={cn("text-sm font-medium", c === "done" && "line-through text-muted-foreground")}>{t.title}</div>
                  <div className={cn("text-xs text-muted-foreground", t.overdue && "text-danger")}>{dueLabel(t.dueAt)} · {t.assigneeName ?? "Unassigned"}</div>
                </button>
                {canWrite && (
                  <select aria-label={`Move ${t.title}`} value={c} onChange={(e) => move(t.id, e.target.value as (typeof COLS)[number])} className="mt-1 w-full bg-transparent text-xs text-muted-foreground">
                    {COLS.map((x) => <option key={x} value={x}>{x === c ? TASK_STATUS[x] : `Move to ${TASK_STATUS[x]}`}</option>)}
                  </select>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
