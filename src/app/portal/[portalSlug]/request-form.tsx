"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import type { FormField } from "@/domains/support/schema";
import { submitPortalAction } from "../actions";

interface PForm { id: string; name: string; description: string | null; fields: FormField[] }

function Field({ id, label, required, help, error, children }: { id: string; label: string; required?: boolean; help?: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">{label}{required && <span className="text-danger" aria-hidden> *</span>}</label>
      {children}
      {help && <p id={`${id}-help`} className="text-xs text-muted-foreground">{help}</p>}
      {error && <p id={`${id}-err`} className="text-xs text-danger">{error}</p>}
    </div>
  );
}

export function PortalRequestForm({ slug, forms }: { slug: string; forms: PForm[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [formId, setFormId] = useState<string>(forms[0]?.id ?? "");
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const form = forms.find((f) => f.id === formId) ?? null;
  const err = (k: string) => errors[k]?.[0];
  const submit = (fd: FormData) => {
    setErrors({}); setError(null);
    const fields: Record<string, unknown> = {};
    for (const f of form?.fields ?? []) fields[f.key] = f.type === "multi_select" ? fd.getAll(`f_${f.key}`) : f.type === "checkbox" ? fd.get(`f_${f.key}`) === "on" : fd.get(`f_${f.key}`);
    start(async () => {
      const r = await submitPortalAction(slug, { formId: formId || null, name: fd.get("name"), email: fd.get("email"), subject: fd.get("subject"), message: fd.get("message"), fields, website: fd.get("website") || undefined });
      if (!r.ok) { setErrors(r.fieldErrors ?? {}); setError(r.error); return; }
      router.push(`${r.data.path}?new=1`);
    });
  };
  return (
    <form action={submit} className="grid gap-4" noValidate>
      {forms.length > 1 && (
        <Field id="formId" label="What do you need help with?">
          <NativeSelect id="formId" value={formId} onChange={(e) => setFormId(e.target.value)}>
            {forms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            <option value="">Something else</option>
          </NativeSelect>
        </Field>
      )}
      {form?.description && <p className="-mt-2 text-sm text-muted-foreground">{form.description}</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="name" label="Your name" required error={err("name")}><Input id="name" name="name" autoComplete="name" required aria-invalid={!!err("name")} /></Field>
        <Field id="email" label="Email" required error={err("email")}><Input id="email" name="email" type="email" autoComplete="email" required aria-invalid={!!err("email")} /></Field>
      </div>
      <Field id="subject" label="Subject" required error={err("subject")}><Input id="subject" name="subject" required aria-invalid={!!err("subject")} /></Field>
      {form?.fields.map((f) => {
        const id = `f_${f.key}`;
        const e = err(`fields.${f.key}`);
        const common = { id, name: id, "aria-invalid": !!e, "aria-describedby": f.help ? `${id}-help` : undefined };
        if (f.type === "checkbox") return (
          <div key={f.key} className="grid gap-1">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...common} className="size-4 accent-[var(--brand-primary)]" />{f.label}{f.required && <span className="text-danger" aria-hidden>*</span>}</label>
            {f.help && <p id={`${id}-help`} className="text-xs text-muted-foreground">{f.help}</p>}
            {e && <p className="text-xs text-danger">{e}</p>}
          </div>
        );
        if (f.type === "multi_select") return (
          <fieldset key={f.key} className="grid gap-1.5">
            <legend className="text-sm font-medium">{f.label}{f.required && <span className="text-danger" aria-hidden> *</span>}</legend>
            {f.options?.map((o) => <label key={o} className="flex items-center gap-2 text-sm"><input type="checkbox" name={id} value={o} className="size-4 accent-[var(--brand-primary)]" />{o}</label>)}
            {e && <p className="text-xs text-danger">{e}</p>}
          </fieldset>
        );
        return (
          <Field key={f.key} id={id} label={f.label} required={f.required} help={f.help} error={e}>
            {f.type === "long_text" ? <Textarea rows={3} {...common} />
              : f.type === "select" ? <NativeSelect {...common} defaultValue=""><option value="" disabled>Choose…</option>{f.options?.map((o) => <option key={o} value={o}>{o}</option>)}</NativeSelect>
              : <Input {...common} type={f.type === "email" ? "email" : f.type === "phone" ? "tel" : f.type === "number" ? "number" : f.type === "date" ? "date" : "text"} placeholder={f.type === "order_number" ? "e.g. ORD-1042" : undefined} />}
          </Field>
        );
      })}
      <Field id="message" label="Message" required error={err("message")}><Textarea id="message" name="message" rows={5} required aria-invalid={!!err("message")} /></Field>
      {/* Honeypot: hidden from people, filled by bots. */}
      <div aria-hidden className="absolute left-[-10000px] h-px w-px overflow-hidden"><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
      {error && <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
      <Button type="submit" disabled={pending} className="w-full sm:w-fit">{pending ? "Sending…" : "Send request"}</Button>
    </form>
  );
}
