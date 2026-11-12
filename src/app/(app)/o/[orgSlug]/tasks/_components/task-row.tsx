"use client";
import Link from "next/link";
import { Repeat } from "lucide-react";
import { useUrlParams } from "@/components/app/use-url-params";
import { Badge } from "@/components/ui/badge";
import type { TaskView } from "@/domains/tasks/service";
import { cn } from "@/lib/utils";
import { TaskCheck } from "./task-check";
import { dueLabel } from "./labels";

const PRIORITY_TONE: Record<string, "inactive" | "info" | "warning" | "danger"> = { low: "inactive", medium: "info", high: "warning", urgent: "danger" };

export function TaskRow({ orgSlug, task: t, canWrite, compact, href }: { orgSlug: string; task: TaskView; canWrite: boolean; compact?: boolean; href?: string }) {
  const { set } = useUrlParams();
  const done = t.status === "done";
  const body = (
    <>
      <div className={cn("truncate text-sm", done && "text-muted-foreground line-through")}>{t.title}</div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
        <span className={cn(t.overdue && "font-medium text-danger")}>{t.overdue ? `Overdue · ${dueLabel(t.dueAt)}` : dueLabel(t.dueAt)}</span>
        {t.recurrence !== "none" && <span className="inline-flex items-center gap-0.5"><Repeat className="size-3" /> {t.recurrence}</span>}
        {!compact && <span>· {t.assigneeName ?? "Unassigned"}</span>}
        {!compact && t.relations.map((r) => <span key={`${r.type}${r.id}`}>· {r.label}</span>)}
      </div>
    </>
  );
  return (
    <li className="flex items-start gap-3 px-4 py-2.5 hover:bg-muted/30">
      <div className="pt-0.5"><TaskCheck orgSlug={orgSlug} id={t.id} title={t.title} done={done} disabled={!canWrite} /></div>
      {href ? (
        <Link href={href} className="min-w-0 flex-1">{body}</Link>
      ) : (
        <button type="button" onClick={() => set({ open: t.id })} className="min-w-0 flex-1 text-left">{body}</button>
      )}
      {t.priority !== "medium" && !done && <Badge tone={PRIORITY_TONE[t.priority]}>{t.priority}</Badge>}
    </li>
  );
}
