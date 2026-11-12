"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { InlineSelect } from "@/components/app/inline-field";
import { useUrlParams } from "@/components/app/use-url-params";
import { cn } from "@/lib/utils";
import { updateTaskAction } from "../tasks/actions";
import { TaskCheck } from "../tasks/_components/task-check";

export interface FollowUp {
  id: string; title: string; status: string; priority: string; dueAt: Date | null; overdue: boolean; assigneeMembershipId: string | null; assigneeName: string | null;
  relations: { type: string; id: string; label: string; visible: boolean }[];
}

const PRIORITIES = [{ value: "low", label: "Low" }, { value: "medium", label: "Medium" }, { value: "high", label: "High" }, { value: "urgent", label: "Urgent" }];

function toLocalInput(d: Date | null) {
  if (!d) return "";
  const x = new Date(d);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}T${pad(x.getHours())}:${pad(x.getMinutes())}`;
}
function dueText(d: Date | null) {
  if (!d) return "No due date";
  const x = new Date(d);
  const today = new Date();
  const same = x.toDateString() === today.toDateString();
  const time = x.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return same ? `Today ${time}` : `${x.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
}

/** Due date editor: saves on change, shows saving state, restores the previous value on failure. */
function DueField({ orgSlug, task, disabled }: { orgSlug: string; task: FollowUp; disabled: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(toLocalInput(task.dueAt));
  const [pending, start] = useTransition();
  if (disabled || !editing) {
    return (
      <button type="button" disabled={disabled} onClick={(e) => { e.stopPropagation(); setEditing(true); }} aria-label={`Due date for ${task.title}: ${dueText(task.dueAt)}${disabled ? "" : ", edit"}`}
        className={cn("rounded px-1 text-xs tabular-nums", task.overdue ? "font-medium text-danger" : "text-muted-foreground", !disabled && "hover:bg-muted")}>
        {task.overdue ? "Overdue · " : ""}{dueText(task.dueAt)}
      </button>
    );
  }
  const save = (next: string) => {
    const prev = value;
    setValue(next);
    start(async () => {
      const r = await updateTaskAction(orgSlug, task.id, { dueAt: next ? new Date(next).toISOString() : null });
      if (r.ok) { toast.success("Due date saved"); setEditing(false); router.refresh(); } else { setValue(prev); toast.error(r.error); }
    });
  };
  return (
    <input type="datetime-local" autoFocus aria-label={`Due date for ${task.title}`} disabled={pending} value={value}
      onClick={(e) => e.stopPropagation()} onChange={(e) => save(e.target.value)} onBlur={() => !pending && setEditing(false)}
      onKeyDown={(e) => e.key === "Escape" && setEditing(false)} className="h-7 rounded border px-1 text-xs" />
  );
}

export function FollowUps({ orgSlug, tasks, members, canWrite, status }: { orgSlug: string; tasks: FollowUp[]; members: { membershipId: string; name: string }[]; canWrite: boolean; status: "open" | "done" }) {
  const { set } = useUrlParams();
  const now = new Date();
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const groups = status === "done"
    ? [{ label: "Completed", items: tasks }]
    : [
        { label: "Overdue", items: tasks.filter((t) => t.overdue) },
        { label: "Due today", items: tasks.filter((t) => !t.overdue && t.dueAt && new Date(t.dueAt) < endOfToday) },
        { label: "Upcoming", items: tasks.filter((t) => !t.overdue && (!t.dueAt || new Date(t.dueAt) >= endOfToday)) },
      ];
  const memberOpts = members.map((m) => ({ value: m.membershipId, label: m.name }));

  return (
    <div>
      <div className="mb-3 flex rounded-lg border bg-muted/40 p-0.5 text-sm" role="group" aria-label="Task status">
        {(["open", "done"] as const).map((s) => (
          <button key={s} type="button" aria-pressed={status === s} onClick={() => set({ tasks: s === "open" ? null : s })}
            className={cn("flex-1 rounded-md px-3 py-1", status === s ? "bg-card font-medium shadow-sm" : "text-muted-foreground hover:text-ink")}>
            {s === "open" ? "To do" : "Completed"}
          </button>
        ))}
      </div>
      {tasks.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{status === "open" ? "You're all caught up. Add a follow-up to stay on top of customers and deals." : "No completed tasks yet."}</p>
      ) : (
        <div className="space-y-3">
          {groups.filter((g) => g.items.length).map((g) => (
            <section key={g.label} aria-label={g.label}>
              <h3 className={cn("mb-1 text-xs font-semibold uppercase tracking-wide", g.label === "Overdue" ? "text-danger" : "text-muted-foreground")}>{g.label} · {g.items.length}</h3>
              <ul className="divide-y rounded-lg border">
                {g.items.map((t) => (
                  <li key={t.id} className="flex items-start gap-3 px-3 py-2">
                    <div className="pt-0.5"><TaskCheck orgSlug={orgSlug} id={t.id} title={t.title} done={t.status === "done"} disabled={!canWrite} /></div>
                    <div className="min-w-0 flex-1">
                      <button type="button" onClick={() => set({ open: `task:${t.id}` })} className={cn("block max-w-full truncate text-left text-sm font-medium hover:underline", t.status === "done" && "text-muted-foreground line-through")}>{t.title}</button>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        {t.relations.map((r) => r.visible ? (
                          <Link key={`${r.type}${r.id}`} href={`/o/${orgSlug}/${r.type === "customer" ? "customers" : "leads"}/${r.id}`} className="text-primary hover:underline">{r.label}</Link>
                        ) : <span key={`${r.type}${r.id}`}>{r.label}</span>)}
                        <DueField orgSlug={orgSlug} task={t} disabled={!canWrite} />
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1 text-xs">
                      <InlineSelect label={`Priority for ${t.title}`} value={t.priority} options={PRIORITIES} disabled={!canWrite} onSave={(v) => updateTaskAction(orgSlug, t.id, { priority: v })} />
                      <InlineSelect label={`Assignee for ${t.title}`} value={t.assigneeMembershipId ?? ""} options={memberOpts} disabled={!canWrite} emptyLabel="Unassigned" onSave={(v) => updateTaskAction(orgSlug, t.id, { assigneeMembershipId: v || null })} />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
