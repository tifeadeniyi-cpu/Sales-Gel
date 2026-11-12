"use client";
import { AtSign, Mail, MapPin, Phone } from "lucide-react";
import { InlineSelect, InlineText } from "@/components/app/inline-field";
import { Badge } from "@/components/ui/badge";
import type { CustomerDetail } from "@/domains/customers/service";
import type { CustomFieldDef } from "@/domains/customers/custom-fields";
import { updateCustomerFieldAction } from "../actions";
import { CHANNEL_OPTIONS, CURRENCY_OPTIONS, MARKETING, PROVIDER_LABELS, SOURCE_OPTIONS, TYPE_OPTIONS } from "./labels";
import { TagEditor } from "./tag-editor";

export interface ProfilePerms {
  write: boolean;
  assign: boolean;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] items-center gap-2 py-1">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

export function CustomerProfile({
  orgSlug,
  customer: c,
  members,
  allTags,
  customFields,
  perms,
}: {
  orgSlug: string;
  customer: CustomerDetail;
  members: { membershipId: string; name: string }[];
  allTags: { id: string; name: string; color: string }[];
  customFields: CustomFieldDef[];
  perms: ProfilePerms;
}) {
  const save = (field: string) => (value: string | null) => updateCustomerFieldAction(orgSlug, c.id, field, value);
  const editable = perms.write && c.status !== "merged";
  const mk = MARKETING[c.emailMarketing];

  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Contact</h3>
        <ul className="space-y-1.5 text-sm">
          {c.emails.map((e) => (
            <li key={e.id} className="flex items-center gap-2">
              <Mail className="size-4 text-muted-foreground" aria-hidden />
              <a href={`mailto:${e.email}`} className="truncate hover:underline">{e.email}</a>
              {e.isPrimary && c.emails.length > 1 && <Badge tone="neutral">Primary</Badge>}
              {e.label && <span className="text-xs text-muted-foreground">{e.label}</span>}
            </li>
          ))}
          {c.phones.map((p) => (
            <li key={p.id} className="flex items-center gap-2">
              <Phone className="size-4 text-muted-foreground" aria-hidden />
              <a href={`tel:${p.e164}`} className="hover:underline">{p.phone}</a>
              {p.label && <span className="text-xs text-muted-foreground">{p.label}</span>}
            </li>
          ))}
          {c.identities.map((i) => (
            <li key={i.id} className="flex items-center gap-2">
              <AtSign className="size-4 text-muted-foreground" aria-hidden />
              <span>{i.handle ?? i.externalId}</span>
              <span className="text-xs text-muted-foreground">{PROVIDER_LABELS[i.provider] ?? i.provider}</span>
            </li>
          ))}
          {c.addresses.map((a) => (
            <li key={a.id} className="flex items-start gap-2">
              <MapPin className="mt-0.5 size-4 text-muted-foreground" aria-hidden />
              <span>
                {[a.line1, a.line2, a.city, a.region, a.postalCode, a.country].filter(Boolean).join(", ")}
                <span className="ml-1 text-xs capitalize text-muted-foreground">({a.kind}{a.isDefault ? ", default" : ""})</span>
              </span>
            </li>
          ))}
          {!c.emails.length && !c.phones.length && !c.identities.length && !c.addresses.length && (
            <li className="text-muted-foreground">No contact details yet.</li>
          )}
        </ul>
      </section>

      <section>
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Details</h3>
        <dl>
          <Row label="Type"><InlineSelect label="Type" value={c.type} options={TYPE_OPTIONS} onSave={save("type")} disabled={!editable} /></Row>
          <Row label="First name"><InlineText label="First name" value={c.firstName} onSave={save("firstName")} disabled={!editable} /></Row>
          <Row label="Last name"><InlineText label="Last name" value={c.lastName} onSave={save("lastName")} disabled={!editable} /></Row>
          <Row label="Company"><InlineText label="Company" value={c.companyName} onSave={save("companyName")} disabled={!editable} /></Row>
          <Row label="Source"><InlineSelect label="Source" value={c.source} options={SOURCE_OPTIONS} emptyLabel="Not set" onSave={save("source")} disabled={!editable} /></Row>
          <Row label="Owner">
            <InlineSelect
              label="Owner"
              value={c.ownerMembershipId}
              options={members.map((m) => ({ value: m.membershipId, label: m.name }))}
              emptyLabel="Unassigned"
              onSave={save("ownerMembershipId")}
              disabled={!editable || !perms.assign}
            />
          </Row>
          <Row label="Preferred channel"><InlineSelect label="Preferred channel" value={c.preferredChannel} options={CHANNEL_OPTIONS} emptyLabel="Not set" onSave={save("preferredChannel")} disabled={!editable} /></Row>
          <Row label="Preferred currency"><InlineSelect label="Preferred currency" value={c.preferredCurrency} options={CURRENCY_OPTIONS} emptyLabel="Org default" onSave={save("preferredCurrency")} disabled={!editable} /></Row>
          <Row label="Email marketing"><Badge tone={mk.tone}>{mk.label}</Badge></Row>
          {c.status === "provisional" && (
            <Row label="Status">
              <InlineSelect label="Status" value={c.status} options={[{ value: "provisional", label: "Provisional" }, { value: "active", label: "Confirmed (active)" }]} onSave={save("status")} disabled={!editable} />
            </Row>
          )}
        </dl>
      </section>

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tags</h3>
        <TagEditor orgSlug={orgSlug} customerId={c.id} tags={c.tags} allTags={allTags} canEdit={editable} />
      </section>

      {customFields.length > 0 && (
        <section>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Custom fields</h3>
          <dl>
            {customFields.map((f) => {
              const v = c.customFields?.[f.key];
              const display = v === undefined || v === null || v === "" ? "—" : typeof v === "boolean" ? (v ? "Yes" : "No") : String(v);
              return <Row key={f.id} label={f.label}><span className="text-sm">{display}</span></Row>;
            })}
          </dl>
        </section>
      )}
    </div>
  );
}
