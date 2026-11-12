"use client";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { InlineSelect, InlineText } from "@/components/app/inline-field";
import { useUrlParams } from "@/components/app/use-url-params";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import type { TaskDetail } from "@/domains/tasks/service";
import { formatDateTime, formatRelative } from "@/lib/utils";
import { addCommentAction, deleteCommentAction, deleteTaskAction, updateTaskAction } from "../actions";
import { RECURRENCE_LABEL, TASK_STATUS, toLocalInput } from "./labels";
import { TaskCheck } from "./task-check";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] items-center gap-2 py-1">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

export function TaskDetailPanel({ orgSlug, task: t, members, currentUserId, currentMembershipId, canWrite, canDelete }: { orgSlug: string; task: TaskDetail; members: { membershipId: string; name: string }[]; currentUserId: string; currentMembershipId: string; canWrite: boolean; canDelete: boolean }) {
  const save = (field: string) => (value: string | null) => updateTaskAction(orgSlug, t.id, { [field]: field === "dueAt" && value ? new Date(value).toISOString() : value });
  const [body, setBody] = useState("");
  const [mentions, setMentions] = useState<string[]>([]);
  const [pending, start] = useTransition();
  const { set } = useUrlParams();
  const done = t.status === "done";

  return (
    <div className="space-y-6 p-5">
      <div className="flex items-start gap-3">
        <div className="pt-1"><TaskCheck orgSlug={orgSlug} id={t.id} title={t.title} done={done} disabled={!canWrite} /></div>
        <div className="flex-1">
          <InlineText label="Title" value={t.title} onSave={save("title")} disabled={!canWrite} className="text-base font-medium" />
          <p className="text-xs text-muted-foreground">Created by {t.creatorName ?? "a former member"} {formatRelative(t.createdAt)}{t.completedAt ? ` · completed ${formatRelative(t.completedAt)}` : ""}</p>
        </div>
      </div>
      <dl>
        <Row label="Status">
          {done ? <span className="text-sm text-success">Done</span> : (
            <InlineSelect label="Status" value={t.status} options={[{ value: "todo", label: TASK_STATUS.todo }, { value: "in_progress", label: TASK_STATUS.in_progress }]} onSave={save("status")} disabled={!canWrite} />
          )}
        </Row>
        <Row label="Assignee"><InlineSelect label="Assignee" value={t.assigneeMembershipId} options={members.map((m) => ({ value: m.membershipId, label: m.name }))} emptyLabel="Unassigned" onSave={save("assigneeMembershipId")} disabled={!canWrite} /></Row>
        <Row label="Due">
          <InlineText label="Due" type="date" value={t.dueAt ? toLocalInput(t.dueAt).slice(0, 10) : null} display={(v) => (v ? formatDateTime(t.dueAt ?? v) : "No due date")} onSave={(v) => updateTaskAction(orgSlug, t.id, { dueAt: v ? new Date(`${v}T${t.dueAt ? toLocalInput(t.dueAt).slice(11) : "09:00"}`).toISOString() : null })} disabled={!canWrite} />
          {t.overdue && <span className="text-xs font-medium text-danger">Overdue</span>}
        </Row>
        <Row label="Priority"><InlineSelect label="Priority" value={t.priority} options={["low", "medium", "high", "urgent"].map((p) => ({ value: p, label: p[0].toUpperCase() + p.slice(1) }))} onSave={save("priority")} disabled={!canWrite} /></Row>
        <Row label="Repeat"><InlineSelect label="Repeat" value={t.recurrence} options={Object.entries(RECURRENCE_LABEL).map(([value, label]) => ({ value, label }))} onSave={save("recurrence")} disabled={!canWrite} /></Row>
        <Row label="Related to">
          {t.relations.length === 0 ? <span className="text-sm text-muted-foreground">—</span> : (
            <ul className="flex flex-wrap gap-1 text-sm">
              {t.relations.map((r) => (
                <li key={`${r.type}${r.id}`}>
                  {r.visible ? <Link href={`/o/${orgSlug}/${r.type === "customer" ? "customers" : "leads"}/${r.id}`} className="rounded-full border px-2 py-0.5 text-xs hover:bg-muted">{r.label}</Link> : <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">{r.label}</span>}
                </li>
              ))}
            </ul>
          )}
        </Row>
      </dl>
      <section>
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Details</h3>
        <InlineText label="Details" value={t.description} onSave={save("description")} disabled={!canWrite} placeholder="Add details…" />
      </section>
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Comments</h3>
        <ul className="mb-3 space-y-3">
          {t.comments.length === 0 && <li className="text-sm text-muted-foreground">No comments yet.</li>}
          {t.comments.map((c) => (
            <li key={c.id} className="rounded-md border p-3">
              <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium text-ink">{c.authorName ?? "Former member"}</span> {formatRelative(c.createdAt)}
                {c.authorUserId === currentUserId && (
                  <button type="button" className="ml-auto rounded p-0.5 hover:bg-muted" aria-label="Delete comment" onClick={() => start(async () => { const r = await deleteCommentAction(orgSlug, c.id); if (!r.ok) toast.error(r.error); })}><Trash2 className="size-3.5" /></button>
                )}
              </div>
              <p className="whitespace-pre-wrap text-sm">{c.body}</p>
            </li>
          ))}
        </ul>
        <form
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await addCommentAction(orgSlug, t.id, body, mentions);
              if (r.ok) { setBody(""); setMentions([]); } else toast.error(r.error);
            });
          }}
        >
          <label htmlFor={`comment-${t.id}`} className="sr-only">Comment</label>
          <Textarea id={`comment-${t.id}`} rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write a comment…" />
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="Mention a teammate" className="h-8 rounded border bg-card px-2 text-xs" value="" onChange={(e) => e.target.value && !mentions.includes(e.target.value) && setMentions([...mentions, e.target.value])}>
              <option value="">@ Mention…</option>
              {members.filter((m) => m.membershipId !== currentMembershipId).map((m) => <option key={m.membershipId} value={m.membershipId}>{m.name}</option>)}
            </select>
            {mentions.map((id) => (
              <button key={id} type="button" onClick={() => setMentions(mentions.filter((x) => x !== id))} className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary" aria-label={`Remove mention`}>
                @{members.find((m) => m.membershipId === id)?.name} ×
              </button>
            ))}
            <Button type="submit" size="sm" className="ml-auto" disabled={pending || !body.trim()}>Comment</Button>
          </div>
        </form>
      </section>
      {canDelete && (
        <ConfirmDialog
          trigger={<Button variant="ghost" size="sm" className="text-danger"><Trash2 /> Delete task</Button>}
          title="Delete this task?"
          description="It's removed from every record it's linked to. The deletion is recorded in their timelines."
          confirmLabel="Delete task"
          onConfirm={async () => { const r = await deleteTaskAction(orgSlug, t.id); if (r.ok) set({ open: null }); return r; }}
          successMessage="Task deleted"
        />
      )}
    </div>
  );
}
