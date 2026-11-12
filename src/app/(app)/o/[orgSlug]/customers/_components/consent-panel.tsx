"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, NativeSelect } from "@/components/ui/input";
import { formatDateTime } from "@/lib/utils";
import { recordConsentAction } from "../actions";

export function ConsentPanel({ orgSlug, customerId, consents, canWrite }: { orgSlug: string; customerId: string; consents: { id: string; channel: string; status: string; source: string; note: string | null; createdAt: Date; recordedBy: string | null }[]; canWrite: boolean }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ channel: "email", status: "granted", source: "", note: "" });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Consent history can&apos;t be edited or deleted. Record a new entry when a customer opts in or out.</p>
      {consents.length === 0 ? <p className="text-sm text-muted-foreground">No consent recorded.</p> : (
        <ul className="space-y-2 text-sm">
          {consents.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2">
              <Badge tone={c.status === "granted" ? "success" : "danger"}>{c.status === "granted" ? "Opted in" : "Opted out"}</Badge>
              <span className="capitalize">{c.channel}</span>
              <span className="text-muted-foreground">· {c.source}</span>
              <span className="text-xs text-muted-foreground">· {formatDateTime(c.createdAt)}{c.recordedBy ? ` by ${c.recordedBy}` : ""}</span>
            </li>
          ))}
        </ul>
      )}
      {canWrite && (open ? (
        <form
          className="grid gap-2 rounded-md border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const res = await recordConsentAction(orgSlug, customerId, form);
              if (res.ok) { toast.success("Consent recorded"); setOpen(false); setForm({ channel: "email", status: "granted", source: "", note: "" }); setError(null); }
              else setError(res.fieldErrors?.source?.[0] ?? res.error);
            });
          }}
        >
          <div className="grid grid-cols-2 gap-2">
            <NativeSelect aria-label="Channel" value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })}>
              <option value="email">Email</option><option value="sms">SMS</option><option value="whatsapp">WhatsApp</option>
            </NativeSelect>
            <NativeSelect aria-label="Consent" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              <option value="granted">Opted in</option><option value="revoked">Opted out</option>
            </NativeSelect>
          </div>
          <Input aria-label="How was consent captured?" placeholder="How was it captured? e.g. Checkout checkbox" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} />
          {error && <p className="text-xs text-danger" role="alert">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" size="sm" disabled={pending}>{pending ? "Saving…" : "Record consent"}</Button>
          </div>
        </form>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Record consent</Button>
      ))}
    </div>
  );
}
