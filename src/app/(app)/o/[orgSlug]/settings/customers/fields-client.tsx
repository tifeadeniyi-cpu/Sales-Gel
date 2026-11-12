"use client";
import { Archive, ArchiveRestore, Plus, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { FormField } from "@/components/app/form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { slugifyKey } from "@/domains/customers/validation";
import { TagChip } from "../../customers/_components/tag-chip";
import { archiveFieldAction, createFieldAction, createTagAction, deleteTagAction, updateFieldAction } from "./actions";

interface Field { id: string; key: string; label: string; type: string; options: string[] | null; required: boolean; archivedAt: Date | null }

export function FieldsManager({ orgSlug, fields, canManage }: { orgSlug: string; fields: Field[]; canManage: boolean }) {
  const [form, setForm] = useState({ label: "", key: "", type: "text", options: "", required: false });
  const [keyTouched, setKeyTouched] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, start] = useTransition();

  return (
    <div className="space-y-4">
      {fields.length === 0 ? <p className="text-sm text-muted-foreground">No custom fields yet.</p> : (
        <ul className="divide-y rounded-md border">
          {fields.map((f) => (
            <li key={f.id} className={`flex flex-wrap items-center gap-3 px-4 py-3 ${f.archivedAt ? "opacity-60" : ""}`}>
              <div className="min-w-0 flex-1">
                <div className="font-medium">{f.label} {f.required && <Badge tone="warning">Required</Badge>} {f.archivedAt && <Badge tone="inactive">Archived</Badge>}</div>
                <div className="text-xs text-muted-foreground"><code>{f.key}</code> · {f.type}{f.options?.length ? ` · ${f.options.join(", ")}` : ""}</div>
              </div>
              {canManage && !f.archivedAt && (
                <label className="flex items-center gap-1 text-xs">
                  <input type="checkbox" checked={f.required} disabled={pending} onChange={(e) => start(async () => { const r = await updateFieldAction(orgSlug, f.id, { required: e.target.checked }); if (!r.ok) toast.error(r.error); })} className="accent-[var(--brand-primary)]" /> Required
                </label>
              )}
              {canManage && (
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => { const r = await archiveFieldAction(orgSlug, f.id, !f.archivedAt); if (r.ok) toast.success(f.archivedAt ? "Field restored" : "Field archived — existing values are kept"); else toast.error(r.error); })}>
                  {f.archivedAt ? <><ArchiveRestore /> Restore</> : <><Archive /> Archive</>}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <form
          className="grid gap-3 rounded-md border p-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const res = await createFieldAction(orgSlug, { label: form.label, key: form.key, type: form.type, required: form.required, options: form.type === "select" ? form.options.split(",").map((o) => o.trim()).filter(Boolean) : undefined });
              if (res.ok) { toast.success("Field created"); setForm({ label: "", key: "", type: "text", options: "", required: false }); setKeyTouched(false); setErrors({}); }
              else setErrors(res.fieldErrors ?? { label: [res.error] });
            });
          }}
        >
          <div className="sm:col-span-2 text-sm font-medium">New customer field</div>
          <FormField label="Label" htmlFor="cf-label" required errors={errors.label}>
            <Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value, key: keyTouched ? form.key : slugifyKey(e.target.value) })} placeholder="e.g. Birthday" />
          </FormField>
          <FormField label="Key" htmlFor="cf-key" required hint="Used in imports and the API. Can't be changed later." errors={errors.key}>
            <Input value={form.key} onChange={(e) => { setKeyTouched(true); setForm({ ...form, key: e.target.value }); }} />
          </FormField>
          <FormField label="Type" htmlFor="cf-type" required errors={errors.type}>
            <NativeSelect value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option value="text">Text</option><option value="number">Number</option><option value="date">Date</option><option value="select">Dropdown</option><option value="boolean">Yes / No</option>
            </NativeSelect>
          </FormField>
          {form.type === "select" && (
            <FormField label="Options" htmlFor="cf-options" required hint="Separate with commas" errors={errors.options}>
              <Input value={form.options} onChange={(e) => setForm({ ...form, options: e.target.value })} placeholder="Bronze, Silver, Gold" />
            </FormField>
          )}
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" checked={form.required} onChange={(e) => setForm({ ...form, required: e.target.checked })} className="size-4 accent-[var(--brand-primary)]" /> Required when creating or editing a customer
          </label>
          <div className="sm:col-span-2"><Button type="submit" disabled={pending}><Plus /> Add field</Button></div>
        </form>
      )}
    </div>
  );
}

export function TagsManager({ orgSlug, tags, canManage }: { orgSlug: string; tags: { id: string; name: string; color: string; usage: number }[]; canManage: boolean }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState("teal");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-4">
      {tags.length === 0 ? <p className="text-sm text-muted-foreground">No tags yet. Tags are also created when you type a new one on a customer.</p> : (
        <ul className="flex flex-wrap gap-2">
          {tags.map((t) => (
            <li key={t.id} className="flex items-center gap-1 rounded-md border px-2 py-1">
              <TagChip name={t.name} color={t.color} />
              <span className="text-xs text-muted-foreground">{t.usage}</span>
              {canManage && (
                <ConfirmDialog
                  trigger={<button type="button" className="rounded p-0.5 hover:bg-muted" aria-label={`Delete tag ${t.name}`}><Trash2 className="size-3.5" /></button>}
                  title={`Delete tag "${t.name}"?`}
                  description={`It will be removed from ${t.usage} customer(s). Customers themselves aren't affected.`}
                  confirmLabel="Delete tag"
                  onConfirm={() => deleteTagAction(orgSlug, t.id)}
                  successMessage="Tag deleted"
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await createTagAction(orgSlug, { name, color }); if (r.ok) { setName(""); setError(null); toast.success("Tag created"); } else setError(r.fieldErrors?.name?.[0] ?? r.error); }); }}>
          <div className="grid gap-1">
            <label htmlFor="tag-name" className="text-sm font-medium">New tag</label>
            <Input id="tag-name" value={name} onChange={(e) => setName(e.target.value)} className="w-48" aria-invalid={!!error} />
          </div>
          <NativeSelect aria-label="Tag color" value={color} onChange={(e) => setColor(e.target.value)} className="w-32">
            {["teal", "gold", "blue", "green", "red", "gray", "purple"].map((c) => <option key={c} value={c}>{c}</option>)}
          </NativeSelect>
          <Button type="submit" variant="outline" disabled={pending || !name.trim()}>Add tag</Button>
          {error && <p className="w-full text-xs text-danger" role="alert">{error}</p>}
        </form>
      )}
    </div>
  );
}
