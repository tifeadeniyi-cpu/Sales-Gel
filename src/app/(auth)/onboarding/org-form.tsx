"use client";
import { useActionState, useEffect, useState } from "react";
import { FormAlert, FormField, SubmitButton, fieldErrors } from "@/components/app/form";
import { Input, NativeSelect } from "@/components/ui/input";
import { BUSINESS_TYPES, CURRENCIES, suggestSlug } from "@/domains/identity/validation";
import { createOrganizationAction } from "../actions";

const BUSINESS_LABELS: Record<(typeof BUSINESS_TYPES)[number], string> = {
  online_store: "Online store",
  social_seller: "Social media seller",
  retail: "Retail shop",
  wholesale: "Wholesale",
  dtc_brand: "Direct-to-consumer brand",
  services: "Services",
  other: "Other",
};

export function OrgForm({ timezones }: { timezones: string[] }) {
  const [state, action] = useActionState(createOrganizationAction, null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [tz, setTz] = useState("UTC");

  useEffect(() => {
    try {
      const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
      // Reading the browser's timezone (an external system) after hydration.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (timezones.includes(local)) setTz(local);
    } catch {}
  }, [timezones]);

  return (
    <form action={action} className="grid gap-4" noValidate>
      <FormAlert state={state} />
      <FormField label="Business name" htmlFor="name" required errors={fieldErrors(state, "name")}>
        <Input
          name="name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (!slugTouched) setSlug(e.target.value.trim() ? suggestSlug(e.target.value) : "");
          }}
        />
      </FormField>
      <FormField label="Workspace URL" htmlFor="slug" required hint={<>Your workspace lives at /o/<strong>{slug || "your-business"}</strong></>} errors={fieldErrors(state, "slug")}>
        <Input
          name="slug"
          value={slug}
          onChange={(e) => {
            setSlugTouched(true);
            setSlug(e.target.value.toLowerCase());
          }}
        />
      </FormField>
      <FormField label="Business type" htmlFor="businessType" errors={fieldErrors(state, "businessType")}>
        <NativeSelect name="businessType" defaultValue="">
          <option value="">Select…</option>
          {BUSINESS_TYPES.map((b) => (
            <option key={b} value={b}>{BUSINESS_LABELS[b]}</option>
          ))}
        </NativeSelect>
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Timezone" htmlFor="timezone" required errors={fieldErrors(state, "timezone")}>
          <NativeSelect name="timezone" value={tz} onChange={(e) => setTz(e.target.value)}>
            {timezones.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField label="Default currency" htmlFor="defaultCurrency" required errors={fieldErrors(state, "defaultCurrency")}>
          <NativeSelect name="defaultCurrency" defaultValue="USD">
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </NativeSelect>
        </FormField>
      </div>
      <SubmitButton pendingText="Creating workspace…" className="w-full">Create workspace</SubmitButton>
    </form>
  );
}
