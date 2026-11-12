"use client";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { useCallback, useState, useTransition } from "react";
import { toast } from "sonner";
import { FormField } from "@/components/app/form";
import { RecordPicker, type PickerOption } from "@/components/app/record-picker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { searchCustomersAction, searchLeadsAction } from "../../customers/actions";
import { createTaskAction } from "../actions";
import { RECURRENCE_LABEL } from "./labels";

export interface Relation extends PickerOption { type: "customer" | "lead" }

export function TaskFormDialog({
  orgSlug,
  members,
  currentMembershipId,
  presetRelations = [],
  trigger,
  canSearchLeads,
  canSearchCustomers,
}: {
  orgSlug: string;
  members: { membershipId: string; name: string }[];
  currentMembershipId: string;
  presetRelations?: Relation[];
  trigger?: React.ReactNode;
  canSearchLeads: boolean;
  canSearchCustomers: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const blank = { title: "", description: "", priority: "medium", assigneeMembershipId: currentMembershipId, dueAt: "", recurrence: "none" };
  const [form, setForm] = useState(blank);
  const [relations, setRelations] = useState<Relation[]>(presetRelations);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, start] = useTransition();
  const searchC = useCallback((q: string) => searchCustomersAction(orgSlug, q), [orgSlug]);
  const searchL = useCallback((q: string) => searchLeadsAction(orgSlug, q), [orgSlug]);

  const add = (type: "customer" | "lead") => (o: PickerOption | null) => {
    if (o && !relations.some((r) => r.type === type && r.id === o.id)) setRelations([...relations, { ...o, type }]);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setForm(blank); setRelations(presetRelations); setErrors({}); } }}>
      <DialogTrigger asChild>{trigger ?? <Button><Plus /> New task</Button>}</DialogTrigger>
      <DialogContent className="max-w-lg">
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const res = await createTaskAction(orgSlug, {
                title: form.title,
                description: form.description || null,
                priority: form.priority as never,
                assigneeMembershipId: form.assigneeMembershipId || null,
                dueAt: form.dueAt ? new Date(form.dueAt).toISOString() : null,
                recurrence: form.recurrence as never,
                relations: relations.map((r) => ({ type: r.type, id: r.id })),
              });
              if (res.ok) { toast.success("Task created"); setOpen(false); router.refresh(); }
              else setErrors(res.fieldErrors ?? { title: [res.error] });
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>New task</DialogTitle>
            <DialogDescription>Follow-ups and to-dos, linked to the records they&apos;re about.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <FormField label="Title" htmlFor="task-title" required errors={errors.title}>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Call back about delivery date" />
            </FormField>
            <FormField label="Details" htmlFor="task-desc">
              <Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </FormField>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Due" htmlFor="task-due" errors={errors.dueAt}>
                <Input type="datetime-local" value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value })} />
              </FormField>
              <FormField label="Repeat" htmlFor="task-recurrence">
                <NativeSelect value={form.recurrence} onChange={(e) => setForm({ ...form, recurrence: e.target.value })}>
                  {Object.entries(RECURRENCE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </NativeSelect>
              </FormField>
              <FormField label="Assignee" htmlFor="task-assignee" errors={errors.assigneeMembershipId}>
                <NativeSelect value={form.assigneeMembershipId} onChange={(e) => setForm({ ...form, assigneeMembershipId: e.target.value })}>
                  <option value="">Unassigned</option>
                  {members.map((m) => <option key={m.membershipId} value={m.membershipId}>{m.membershipId === currentMembershipId ? `${m.name} (me)` : m.name}</option>)}
                </NativeSelect>
              </FormField>
              <FormField label="Priority" htmlFor="task-priority">
                <NativeSelect value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                  <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option>
                </NativeSelect>
              </FormField>
            </div>
            <div className="grid gap-2">
              <span className="text-sm font-medium">Related to</span>
              {relations.length > 0 && (
                <ul className="flex flex-wrap gap-1">
                  {relations.map((r) => (
                    <li key={`${r.type}-${r.id}`} className="inline-flex items-center gap-1 rounded-full border bg-muted px-2 py-0.5 text-xs">
                      <span className="capitalize text-muted-foreground">{r.type}:</span> {r.label}
                      <button type="button" aria-label={`Remove ${r.label}`} onClick={() => setRelations(relations.filter((x) => x !== r))}><X className="size-3" /></button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="grid gap-2 sm:grid-cols-2">
                {canSearchCustomers && <RecordPicker label="Link customer" value={null} onChange={add("customer")} search={searchC} placeholder="Link a customer…" />}
                {canSearchLeads && <RecordPicker label="Link lead" value={null} onChange={add("lead")} search={searchL} placeholder="Link a lead…" />}
              </div>
              {errors.relations && <p className="text-xs text-danger" role="alert">{errors.relations[0]}</p>}
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>{pending ? "Creating…" : "Create task"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
