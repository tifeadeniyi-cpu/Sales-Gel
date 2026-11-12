"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import { useCallback, useState, useTransition } from "react";
import { toast } from "sonner";
import { FormField } from "@/components/app/form";
import { useUnsavedChanges } from "@/components/app/use-unsaved-changes";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, NativeSelect } from "@/components/ui/input";
import type { CustomFieldDef } from "@/domains/customers/custom-fields";
import { IDENTITY_PROVIDERS, type CustomerInput } from "@/domains/customers/validation";
import { checkMatchesAction, saveCustomerAction } from "../actions";
import { CHANNEL_OPTIONS, CURRENCY_OPTIONS, PROVIDER_LABELS, SOURCE_OPTIONS } from "./labels";

type FormState = {
  type: "person" | "business";
  firstName: string;
  lastName: string;
  companyName: string;
  source: string;
  ownerMembershipId: string;
  preferredChannel: string;
  preferredCurrency: string;
  provisional: boolean;
  emails: { email: string; label: string }[];
  phones: { phone: string; label: string }[];
  identities: { provider: string; handle: string }[];
  addresses: { kind: "billing" | "shipping"; line1: string; line2: string; city: string; region: string; postalCode: string; country: string }[];
  tagNames: string;
  customFields: Record<string, string | boolean>;
};

function fromInput(i?: CustomerInput): FormState {
  return {
    type: i?.type ?? "person",
    firstName: i?.firstName ?? "",
    lastName: i?.lastName ?? "",
    companyName: i?.companyName ?? "",
    source: i?.source ?? "",
    ownerMembershipId: i?.ownerMembershipId ?? "",
    preferredChannel: i?.preferredChannel ?? "",
    preferredCurrency: i?.preferredCurrency ?? "",
    provisional: i?.provisional ?? false,
    emails: i?.emails?.length ? i.emails.map((e) => ({ email: e.email, label: e.label ?? "" })) : [{ email: "", label: "" }],
    phones: i?.phones?.length ? i.phones.map((p) => ({ phone: p.phone, label: p.label ?? "" })) : [{ phone: "", label: "" }],
    identities: (i?.identities ?? []).map((x) => ({ provider: x.provider, handle: x.handle })),
    addresses: (i?.addresses ?? []).map((a) => ({ kind: a.kind, line1: a.line1, line2: a.line2 ?? "", city: a.city ?? "", region: a.region ?? "", postalCode: a.postalCode ?? "", country: a.country ?? "" })),
    tagNames: (i?.tagNames ?? []).join(", "),
    customFields: Object.fromEntries(Object.entries(i?.customFields ?? {}).map(([k, v]) => [k, typeof v === "boolean" ? v : v == null ? "" : String(v)])),
  };
}

function toInput(s: FormState): CustomerInput {
  const t = (v: string) => (v.trim() ? v.trim() : null);
  return {
    type: s.type,
    firstName: t(s.firstName),
    lastName: t(s.lastName),
    companyName: t(s.companyName),
    source: (t(s.source) as never) ?? null,
    ownerMembershipId: t(s.ownerMembershipId),
    preferredChannel: (t(s.preferredChannel) as never) ?? null,
    preferredCurrency: t(s.preferredCurrency),
    provisional: s.provisional,
    emails: s.emails.filter((e) => e.email.trim()).map((e, i) => ({ email: e.email, label: t(e.label), isPrimary: i === 0 })),
    phones: s.phones.filter((p) => p.phone.trim()).map((p, i) => ({ phone: p.phone, label: t(p.label), isPrimary: i === 0 })),
    identities: s.identities.filter((x) => x.handle.trim()).map((x) => ({ provider: x.provider as never, handle: x.handle })),
    addresses: s.addresses.filter((a) => a.line1.trim()).map((a) => ({ kind: a.kind, line1: a.line1, line2: t(a.line2), city: t(a.city), region: t(a.region), postalCode: t(a.postalCode), country: t(a.country) })),
    tagNames: s.tagNames.split(",").map((x) => x.trim()).filter(Boolean),
    customFields: s.customFields,
  };
}

export function CustomerForm({
  orgSlug,
  customerId,
  initial,
  members,
  customFields,
  canAssign,
}: {
  orgSlug: string;
  customerId?: string;
  initial?: CustomerInput;
  members: { membershipId: string; name: string }[];
  customFields: CustomFieldDef[];
  canAssign: boolean;
}) {
  const router = useRouter();
  const [s, setS] = useState<FormState>(() => fromInput(initial));
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [matches, setMatches] = useState<{ id: string; number: number; displayName: string; reasons: string[] }[]>([]);
  const [pending, start] = useTransition();
  useUnsavedChanges(dirty && !pending);
  const base = `/o/${orgSlug}/customers`;

  const update = (patch: Partial<FormState>) => { setS((prev) => ({ ...prev, ...patch })); setDirty(true); };
  const err = (k: string) => errors[k];

  const checkMatches = useCallback(() => {
    const input = toInput(s);
    void checkMatchesAction(orgSlug, {
      emails: input.emails!.map((e) => e.email),
      phones: input.phones!.map((p) => p.phone),
      identities: input.identities!.map((i) => ({ provider: i.provider, handle: i.handle })),
      excludeId: customerId,
    }).then((r) => r.ok && setMatches(r.data));
  }, [s, orgSlug, customerId]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const res = await saveCustomerAction(orgSlug, customerId ?? null, toInput(s));
      if (res.ok) {
        setDirty(false);
        toast.success(customerId ? "Customer saved" : "Customer created");
        router.push(`${base}/${res.data.id}`);
      } else {
        setErrors(res.fieldErrors ?? {});
        setFormError(res.error);
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    });
  };

  return (
    <form onSubmit={submit} className="grid gap-6 lg:grid-cols-3" noValidate>
      <div className="space-y-6 lg:col-span-2">
        {formError && <p className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">{formError}</p>}
        {matches.length > 0 && (
          <div className="rounded-md border border-warning/30 bg-warning/10 p-3 text-sm text-warning" role="status">
            <div className="flex items-center gap-2 font-medium"><AlertTriangle className="size-4" /> Possible duplicate</div>
            <ul className="mt-1 list-disc pl-6">
              {matches.map((m) => (
                <li key={m.id}>
                  <Link href={`${base}/${m.id}`} target="_blank" className="underline">{m.displayName} (CUS-{m.number})</Link> shares the same {m.reasons.join(" and ")}.
                </li>
              ))}
            </ul>
            <p className="mt-1 text-xs">You can still save; you&apos;ll be able to merge them later.</p>
          </div>
        )}

        <Card>
          <CardHeader><CardTitle>Who is this?</CardTitle></CardHeader>
          <CardContent className="grid gap-4">
            <div className="flex gap-4" role="radiogroup" aria-label="Customer type">
              {(["person", "business"] as const).map((t) => (
                <label key={t} className="flex items-center gap-2 text-sm">
                  <input type="radio" name="type" checked={s.type === t} onChange={() => update({ type: t })} className="accent-[var(--brand-primary)]" />
                  {t === "person" ? "Person" : "Business"}
                </label>
              ))}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="First name" htmlFor="firstName" errors={err("firstName")}><Input value={s.firstName} onChange={(e) => update({ firstName: e.target.value })} /></FormField>
              <FormField label="Last name" htmlFor="lastName" errors={err("lastName")}><Input value={s.lastName} onChange={(e) => update({ lastName: e.target.value })} /></FormField>
            </div>
            <FormField label="Company" htmlFor="companyName" required={s.type === "business"} errors={err("companyName")}><Input value={s.companyName} onChange={(e) => update({ companyName: e.target.value })} /></FormField>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={s.provisional} onChange={(e) => update({ provisional: e.target.checked })} className="mt-0.5 size-4 accent-[var(--brand-primary)]" />
              <span>Provisional contact<span className="block text-xs text-muted-foreground">For inquiries where you don&apos;t know who they are yet (e.g. a new Instagram DM). Only one identifier is needed.</span></span>
            </label>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Contact details</CardTitle></CardHeader>
          <CardContent className="grid gap-5">
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">Emails</legend>
              {s.emails.map((e, i) => (
                <div key={i} className="flex gap-2">
                  <Input aria-label={`Email ${i + 1}`} type="email" value={e.email} aria-invalid={!!err(`emails.${i}.email`)} onBlur={checkMatches} onChange={(ev) => update({ emails: s.emails.map((x, j) => (j === i ? { ...x, email: ev.target.value } : x)) })} placeholder="name@example.com" />
                  <Input aria-label={`Email ${i + 1} label`} className="w-32" value={e.label} onChange={(ev) => update({ emails: s.emails.map((x, j) => (j === i ? { ...x, label: ev.target.value } : x)) })} placeholder="Label" />
                  <Button type="button" variant="ghost" size="icon" aria-label={`Remove email ${i + 1}`} onClick={() => update({ emails: s.emails.filter((_, j) => j !== i) })}><Trash2 /></Button>
                </div>
              ))}
              {s.emails.map((_, i) => err(`emails.${i}.email`) && <p key={i} className="text-xs text-danger" role="alert">Email {i + 1}: {err(`emails.${i}.email`)![0]}</p>)}
              <Button type="button" variant="link" size="sm" className="justify-self-start px-0" onClick={() => update({ emails: [...s.emails, { email: "", label: "" }] })}><Plus /> Add email</Button>
            </fieldset>
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">Phones</legend>
              {s.phones.map((p, i) => (
                <div key={i} className="flex gap-2">
                  <Input aria-label={`Phone ${i + 1}`} type="tel" value={p.phone} aria-invalid={!!err(`phones.${i}.phone`)} onBlur={checkMatches} onChange={(ev) => update({ phones: s.phones.map((x, j) => (j === i ? { ...x, phone: ev.target.value } : x)) })} placeholder="+1 214 555 0100" />
                  <Input aria-label={`Phone ${i + 1} label`} className="w-32" value={p.label} onChange={(ev) => update({ phones: s.phones.map((x, j) => (j === i ? { ...x, label: ev.target.value } : x)) })} placeholder="Label" />
                  <Button type="button" variant="ghost" size="icon" aria-label={`Remove phone ${i + 1}`} onClick={() => update({ phones: s.phones.filter((_, j) => j !== i) })}><Trash2 /></Button>
                </div>
              ))}
              {s.phones.map((_, i) => err(`phones.${i}.phone`) && <p key={i} className="text-xs text-danger" role="alert">Phone {i + 1}: {err(`phones.${i}.phone`)![0]}</p>)}
              <Button type="button" variant="link" size="sm" className="justify-self-start px-0" onClick={() => update({ phones: [...s.phones, { phone: "", label: "" }] })}><Plus /> Add phone</Button>
            </fieldset>
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">Social & messaging</legend>
              {s.identities.map((x, i) => (
                <div key={i} className="flex gap-2">
                  <NativeSelect aria-label={`Platform ${i + 1}`} className="w-40" value={x.provider} onChange={(ev) => update({ identities: s.identities.map((y, j) => (j === i ? { ...y, provider: ev.target.value } : y)) })}>
                    {IDENTITY_PROVIDERS.map((p) => <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>)}
                  </NativeSelect>
                  <Input aria-label={`Handle ${i + 1}`} value={x.handle} onBlur={checkMatches} onChange={(ev) => update({ identities: s.identities.map((y, j) => (j === i ? { ...y, handle: ev.target.value } : y)) })} placeholder="@handle" />
                  <Button type="button" variant="ghost" size="icon" aria-label={`Remove handle ${i + 1}`} onClick={() => update({ identities: s.identities.filter((_, j) => j !== i) })}><Trash2 /></Button>
                </div>
              ))}
              <Button type="button" variant="link" size="sm" className="justify-self-start px-0" onClick={() => update({ identities: [...s.identities, { provider: "instagram", handle: "" }] })}><Plus /> Add social handle</Button>
            </fieldset>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Addresses</CardTitle></CardHeader>
          <CardContent className="grid gap-4">
            {s.addresses.length === 0 && <p className="text-sm text-muted-foreground">No addresses.</p>}
            {s.addresses.map((a, i) => {
              const setA = (patch: Partial<FormState["addresses"][number]>) => update({ addresses: s.addresses.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
              return (
                <div key={i} className="grid gap-2 rounded-md border p-3">
                  <div className="flex items-center gap-2">
                    <NativeSelect aria-label={`Address ${i + 1} type`} className="w-40" value={a.kind} onChange={(e) => setA({ kind: e.target.value as "billing" | "shipping" })}>
                      <option value="shipping">Shipping</option><option value="billing">Billing</option>
                    </NativeSelect>
                    <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={() => update({ addresses: s.addresses.filter((_, j) => j !== i) })}><Trash2 /> Remove</Button>
                  </div>
                  <Input aria-label={`Address ${i + 1} line 1`} placeholder="Street address" value={a.line1} onChange={(e) => setA({ line1: e.target.value })} aria-invalid={!!err(`addresses.${i}.line1`)} />
                  <Input aria-label={`Address ${i + 1} line 2`} placeholder="Apt, suite (optional)" value={a.line2} onChange={(e) => setA({ line2: e.target.value })} />
                  <div className="grid gap-2 sm:grid-cols-4">
                    <Input aria-label={`Address ${i + 1} city`} placeholder="City" value={a.city} onChange={(e) => setA({ city: e.target.value })} />
                    <Input aria-label={`Address ${i + 1} region`} placeholder="State" value={a.region} onChange={(e) => setA({ region: e.target.value })} />
                    <Input aria-label={`Address ${i + 1} postal code`} placeholder="ZIP" value={a.postalCode} onChange={(e) => setA({ postalCode: e.target.value })} />
                    <Input aria-label={`Address ${i + 1} country`} placeholder="Country" value={a.country} onChange={(e) => setA({ country: e.target.value })} />
                  </div>
                </div>
              );
            })}
            <Button type="button" variant="link" size="sm" className="justify-self-start px-0" onClick={() => update({ addresses: [...s.addresses, { kind: "shipping", line1: "", line2: "", city: "", region: "", postalCode: "", country: "" }] })}><Plus /> Add address</Button>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader><CardTitle>Relationship</CardTitle></CardHeader>
          <CardContent className="grid gap-4">
            <FormField label="Source" htmlFor="source" errors={err("source")}>
              <NativeSelect value={s.source} onChange={(e) => update({ source: e.target.value })}>
                <option value="">Not set</option>
                {SOURCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </NativeSelect>
            </FormField>
            {canAssign && (
              <FormField label="Owner" htmlFor="ownerMembershipId" errors={err("ownerMembershipId")}>
                <NativeSelect value={s.ownerMembershipId} onChange={(e) => update({ ownerMembershipId: e.target.value })}>
                  <option value="">Unassigned</option>
                  {members.map((m) => <option key={m.membershipId} value={m.membershipId}>{m.name}</option>)}
                </NativeSelect>
              </FormField>
            )}
            <FormField label="Preferred channel" htmlFor="preferredChannel">
              <NativeSelect value={s.preferredChannel} onChange={(e) => update({ preferredChannel: e.target.value })}>
                <option value="">Not set</option>
                {CHANNEL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </NativeSelect>
            </FormField>
            <FormField label="Preferred currency" htmlFor="preferredCurrency" errors={err("preferredCurrency")}>
              <NativeSelect value={s.preferredCurrency} onChange={(e) => update({ preferredCurrency: e.target.value })}>
                <option value="">Organization default</option>
                {CURRENCY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </NativeSelect>
            </FormField>
            <FormField label="Tags" htmlFor="tagNames" hint="Separate with commas" errors={err("tagNames")}>
              <Input value={s.tagNames} onChange={(e) => update({ tagNames: e.target.value })} placeholder="VIP, Wholesale" />
            </FormField>
          </CardContent>
        </Card>

        {customFields.length > 0 && (
          <Card>
            <CardHeader><CardTitle>Custom fields</CardTitle></CardHeader>
            <CardContent className="grid gap-4">
              {customFields.map((f) => {
                const id = `cf-${f.key}`;
                const v = s.customFields[f.key];
                const setV = (val: string | boolean) => update({ customFields: { ...s.customFields, [f.key]: val } });
                if (f.type === "boolean") {
                  return (
                    <label key={f.id} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={v === true} onChange={(e) => setV(e.target.checked)} className="size-4 accent-[var(--brand-primary)]" /> {f.label}
                    </label>
                  );
                }
                return (
                  <FormField key={f.id} label={f.label} htmlFor={id} required={f.required} errors={err(`customFields.${f.key}`)}>
                    {f.type === "select" ? (
                      <NativeSelect value={String(v ?? "")} onChange={(e) => setV(e.target.value)}>
                        <option value="">Select…</option>
                        {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                      </NativeSelect>
                    ) : (
                      <Input type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"} value={String(v ?? "")} onChange={(e) => setV(e.target.value)} />
                    )}
                  </FormField>
                );
              })}
            </CardContent>
          </Card>
        )}

        <div className="flex gap-2">
          <Button type="submit" disabled={pending} className="flex-1">{pending ? "Saving…" : customerId ? "Save changes" : "Create customer"}</Button>
          <Button type="button" variant="outline" onClick={() => { if (!dirty || confirm("Discard unsaved changes?")) router.back(); }}>Cancel</Button>
        </div>
        <Label className="sr-only">Required fields are marked with *</Label>
      </div>
    </form>
  );
}
