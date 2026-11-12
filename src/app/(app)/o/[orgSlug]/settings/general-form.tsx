"use client";
import { useActionState, useState } from "react";
import { FormAlert, FormField, SubmitButton, fieldErrors } from "@/components/app/form";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { BUSINESS_TYPES, CURRENCIES } from "@/domains/identity/validation";
import { useUnsavedChanges } from "@/components/app/use-unsaved-changes";
import { updateOrganizationAction } from "./actions";

export function GeneralForm({
  orgSlug,
  org,
  timezones,
  readOnly,
}: {
  orgSlug: string;
  org: { name: string; businessType: string | null; timezone: string; defaultCurrency: string; address: string | null; slug: string };
  timezones: string[];
  readOnly: boolean;
}) {
  const [dirty, setDirty] = useState(false);
  const [state, action] = useActionState(async (prev: Awaited<ReturnType<typeof updateOrganizationAction>> | null, fd: FormData) => {
    const res = await updateOrganizationAction(orgSlug, prev, fd);
    if (res.ok) setDirty(false);
    return res;
  }, null);
  useUnsavedChanges(dirty);

  return (
    <form action={action} onChange={() => setDirty(true)} className="grid max-w-2xl gap-4" noValidate>
      <FormAlert state={state} />
      <fieldset disabled={readOnly} className="grid gap-4">
        <FormField label="Business name" htmlFor="name" required errors={fieldErrors(state, "name")}>
          <Input name="name" defaultValue={org.name} />
        </FormField>
        <FormField label="Workspace URL" htmlFor="slug" hint="Workspace URLs can't be changed yet, so existing links keep working.">
          <Input name="slug" value={`/o/${org.slug}`} readOnly disabled />
        </FormField>
        <FormField label="Business type" htmlFor="businessType" errors={fieldErrors(state, "businessType")}>
          <NativeSelect name="businessType" defaultValue={org.businessType ?? ""}>
            <option value="">Not set</option>
            {BUSINESS_TYPES.map((b) => <option key={b} value={b}>{b.replace(/_/g, " ")}</option>)}
          </NativeSelect>
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Timezone" htmlFor="timezone" required errors={fieldErrors(state, "timezone")}>
            <NativeSelect name="timezone" defaultValue={org.timezone}>
              {timezones.map((t) => <option key={t} value={t}>{t}</option>)}
            </NativeSelect>
          </FormField>
          <FormField label="Default currency" htmlFor="defaultCurrency" required hint="Used for new records. Existing amounts keep their own currency." errors={fieldErrors(state, "defaultCurrency")}>
            <NativeSelect name="defaultCurrency" defaultValue={org.defaultCurrency}>
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </NativeSelect>
          </FormField>
        </div>
        <FormField label="Business address" htmlFor="address" errors={fieldErrors(state, "address")}>
          <Textarea name="address" defaultValue={org.address ?? ""} rows={3} />
        </FormField>
      </fieldset>
      {!readOnly && (
        <div className="flex items-center gap-3">
          <SubmitButton pendingText="Saving…" disabled={!dirty}>Save changes</SubmitButton>
          {dirty && <span className="text-xs text-warning">Unsaved changes</span>}
        </div>
      )}
    </form>
  );
}
