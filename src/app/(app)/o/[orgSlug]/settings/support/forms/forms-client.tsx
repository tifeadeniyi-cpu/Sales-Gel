"use client";
import { useState } from "react";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import type { FormField, FormFieldType } from "@/domains/support/schema";
import { PRIORITY_LABELS } from "@/domains/support/validation";
import { archiveTicketFormAction, publishTicketFormAction, saveTicketFormAction } from "../actions";
import { firstError, useRun } from "../parts";

export const FIELD_TYPE_LABELS: Record<FormFieldType, string> = {
  short_text: "Short answer", long_text: "Paragraph", email: "Email", phone: "Phone", number: "Number", select: "Dropdown", multi_select: "Checkboxes (several)", checkbox: "Yes/no checkbox", date: "Date", order_number: "Order number",
};
interface Form { id: string; name: string; description: string | null; ticketTypeId: string | null; priority: string; portalVisible: number; draftFields: FormField[]; currentVersionId: string | null; versions: { id: string; version: number }[] }

export function FormsManager({ orgSlug, forms, types }: { orgSlug: string; forms: Form[]; types: { id: string; name: string }[] }) {
  const { pending, run } = useRun();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  return (
    <div className="space-y-4">
      {forms.length === 0 && editing !== "new" && <p className="text-sm text-muted-foreground">No forms yet. Without one, the portal asks only for name, email, subject and message.</p>}
      <ul className="space-y-3">
        {forms.map((f) => {
          const current = f.versions.find((v) => v.id === f.currentVersionId);
          return (
            <li key={f.id} className="rounded-lg border">
              {editing === f.id ? <FormEditor orgSlug={orgSlug} form={f} types={types} onDone={() => setEditing(null)} /> : (
                <div className="flex flex-wrap items-start gap-2 p-4">
                  <div className="min-w-0 flex-1 text-sm">
                    <h3 className="font-medium">{f.name}</h3>
                    {f.description && <p className="text-muted-foreground">{f.description}</p>}
                    <p className="mt-1 text-xs text-muted-foreground">{f.draftFields.length} extra question{f.draftFields.length === 1 ? "" : "s"} · {PRIORITY_LABELS[f.priority as keyof typeof PRIORITY_LABELS]} priority{types.find((t) => t.id === f.ticketTypeId) ? ` · ${types.find((t) => t.id === f.ticketTypeId)!.name}` : ""}</p>
                  </div>
                  {current ? <Badge tone="success">Published v{current.version}</Badge> : <Badge tone="warning">Draft — not on the portal</Badge>}
                  {!f.portalVisible && <Badge tone="inactive">Hidden from portal</Badge>}
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" onClick={() => setEditing(f.id)}>Edit</Button>
                    <Button size="sm" disabled={pending} onClick={() => run(() => publishTicketFormAction(orgSlug, f.id), "Form published")}>Publish</Button>
                    <ConfirmDialog trigger={<Button size="sm" variant="ghost">Delete</Button>} title={`Delete "${f.name}"?`} confirmLabel="Delete form" description="It disappears from the portal. Tickets already submitted keep their answers." onConfirm={() => archiveTicketFormAction(orgSlug, f.id)} successMessage="Form deleted" />
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {editing === "new" ? <div className="rounded-lg border"><FormEditor orgSlug={orgSlug} form={null} types={types} onDone={() => setEditing(null)} /></div> : <Button onClick={() => setEditing("new")}>Add form</Button>}
    </div>
  );
}

const keyFrom = (label: string, taken: string[]) => {
  let base = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^(\d)/, "f_$1").slice(0, 32) || "field";
  if (["name", "email", "subject", "message", "description", "phone", "order"].includes(base)) base = `${base}_extra`;
  let k = base;
  for (let i = 2; taken.includes(k); i++) k = `${base}_${i}`;
  return k;
};

function FormEditor({ orgSlug, form, types, onDone }: { orgSlug: string; form: Form | null; types: { id: string; name: string }[]; onDone: () => void }) {
  const { pending, run } = useRun();
  const [v, setV] = useState({ name: form?.name ?? "", description: form?.description ?? "", ticketTypeId: form?.ticketTypeId ?? "", priority: form?.priority ?? "normal", portalVisible: form ? !!form.portalVisible : true });
  const [fields, setFields] = useState<(FormField & { optionsText?: string })[]>(() => (form?.draftFields ?? []).map((f) => ({ ...f, optionsText: (f.options ?? []).join("\n") })));
  const [error, setError] = useState<string | null>(null);
  const update = (i: number, patch: Partial<FormField & { optionsText?: string }>) => setFields((list) => list.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const moveField = (i: number, d: -1 | 1) => setFields((list) => { const n = [...list]; const j = i + d; if (j < 0 || j >= n.length) return n; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const save = (publish: boolean) => {
    setError(null);
    const clean = fields.map(({ optionsText, ...f }) => ({ ...f, help: f.help || undefined, options: ["select", "multi_select"].includes(f.type) ? (optionsText ?? "").split("\n").map((s) => s.trim()).filter(Boolean) : undefined }));
    run<unknown>(async () => {
      const r = await saveTicketFormAction(orgSlug, form?.id ?? null, { ...v, ticketTypeId: v.ticketTypeId || null, description: v.description || null, fields: clean });
      if (!r.ok || !publish) return r;
      return publishTicketFormAction(orgSlug, r.data.id);
    }, publish ? "Form published" : "Draft saved", onDone, (r) => setError(firstError(r)));
  };
  return (
    <form className="grid gap-4 p-4" onSubmit={(e) => { e.preventDefault(); save(false); }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm font-medium">Form name<Input value={v.name} placeholder="e.g. Problem with an order" onChange={(e) => setV({ ...v, name: e.target.value })} /></label>
        <label className="grid gap-1 text-sm font-medium">Short description <span className="font-normal text-muted-foreground">(shown on the portal)</span><Input value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></label>
        <label className="grid gap-1 text-sm font-medium">New tickets get type
          <NativeSelect value={v.ticketTypeId} onChange={(e) => setV({ ...v, ticketTypeId: e.target.value })}><option value="">None</option>{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</NativeSelect>
        </label>
        <label className="grid gap-1 text-sm font-medium">…and priority
          <NativeSelect value={v.priority} onChange={(e) => setV({ ...v, priority: e.target.value })}>{Object.entries(PRIORITY_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</NativeSelect>
        </label>
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" className="size-4 accent-[var(--brand-primary)]" checked={v.portalVisible} onChange={(e) => setV({ ...v, portalVisible: e.target.checked })} />Show on the customer portal</label>
      </div>
      <fieldset className="grid gap-3">
        <legend className="text-sm font-medium">Extra questions</legend>
        <p className="text-xs text-muted-foreground">Always asked: name, email, subject and message.</p>
        {fields.map((f, i) => (
          <div key={i} className="grid gap-2 rounded-md border bg-muted/30 p-3 sm:grid-cols-[1fr_12rem_auto]">
            <label className="grid gap-1 text-xs font-medium">Question {i + 1}<Input value={f.label} onChange={(e) => update(i, { label: e.target.value, ...(form?.currentVersionId ? {} : { key: keyFrom(e.target.value, fields.filter((_, j) => j !== i).map((x) => x.key)) }) })} /></label>
            <label className="grid gap-1 text-xs font-medium">Answer type
              <NativeSelect value={f.type} onChange={(e) => update(i, { type: e.target.value as FormFieldType })}>{Object.entries(FIELD_TYPE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</NativeSelect>
            </label>
            <div className="flex items-end gap-1">
              <Button type="button" size="sm" variant="ghost" aria-label={`Move question ${i + 1} up`} disabled={i === 0} onClick={() => moveField(i, -1)}>↑</Button>
              <Button type="button" size="sm" variant="ghost" aria-label={`Move question ${i + 1} down`} disabled={i === fields.length - 1} onClick={() => moveField(i, 1)}>↓</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setFields(fields.filter((_, j) => j !== i))}>Remove</Button>
            </div>
            {["select", "multi_select"].includes(f.type) && (
              <label className="grid gap-1 text-xs font-medium sm:col-span-3">Options (one per line)<Textarea rows={3} value={f.optionsText ?? ""} onChange={(e) => update(i, { optionsText: e.target.value })} /></label>
            )}
            <label className="grid gap-1 text-xs font-medium sm:col-span-2">Help text<Input value={f.help ?? ""} onChange={(e) => update(i, { help: e.target.value })} /></label>
            <label className="flex items-center gap-2 self-end pb-2 text-xs"><input type="checkbox" className="size-4 accent-[var(--brand-primary)]" checked={f.required} onChange={(e) => update(i, { required: e.target.checked })} />Required</label>
            <p className="text-[11px] text-muted-foreground sm:col-span-3">Saved as <code>{f.key}</code></p>
          </div>
        ))}
        <Button type="button" variant="outline" className="w-fit" disabled={fields.length >= 25} onClick={() => setFields([...fields, { key: keyFrom("question", fields.map((x) => x.key)), label: "", type: "short_text", required: false, optionsText: "" }])}>+ Add question</Button>
      </fieldset>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={pending || !v.name.trim()} onClick={() => save(true)}>{pending ? "Saving…" : "Save and publish"}</Button>
        <Button type="submit" variant="outline" disabled={pending || !v.name.trim()}>Save draft</Button>
        <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}
