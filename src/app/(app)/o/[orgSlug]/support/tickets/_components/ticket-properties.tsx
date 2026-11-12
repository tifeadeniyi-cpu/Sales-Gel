"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Link2, X } from "lucide-react";
import { useCallback, useState, useTransition } from "react";
import { toast } from "sonner";
import { InlineSelect } from "@/components/app/inline-field";
import { RecordPicker, type PickerOption } from "@/components/app/record-picker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NativeSelect, Textarea } from "@/components/ui/input";
import { PRIORITY_LABELS, RESOLUTION_LABELS } from "@/domains/support/validation";
import { searchCustomersAction } from "../../../customers/actions";
import { assignTicketAction, changeTicketStatusAction, linkTicketRecordAction, searchOrdersForTicketAction, unlinkTicketRecordAction, updateTicketAction } from "../actions";

export interface TicketPropsView {
  id: string; statusId: string; statusCategory: string; priority: string; ticketTypeId: string | null; assigneeMembershipId: string | null;
  customerId: string | null; customerName: string | null; customerVisible: boolean; contactEmail: string | null; contactPhone: string | null;
  resolutionCategory: string | null; resolutionNote: string | null; links: { id: string; type: "order" | "lead"; recordId: string; label: string }[];
}

export function StatusControl({ orgSlug, t, statuses, canWrite }: { orgSlug: string; t: TicketPropsView; statuses: { id: string; name: string; category: string }[]; canWrite: boolean }) {
  const router = useRouter();
  const [pendingResolve, setPendingResolve] = useState<string | null>(null);
  const [res, setRes] = useState({ category: "answered", note: "" });
  const [busy, start] = useTransition();
  const save = (statusId: string, extra?: { resolutionCategory: string; resolutionNote: string }) =>
    start(async () => {
      const r = await changeTicketStatusAction(orgSlug, t.id, { statusId, ...extra });
      if (r.ok) { toast.success("Status updated"); setPendingResolve(null); router.refresh(); } else toast.error(r.error);
    });
  return (
    <>
      <NativeSelect aria-label="Status" value={t.statusId} disabled={!canWrite || busy} className="h-9"
        onChange={(e) => { const s = statuses.find((x) => x.id === e.target.value)!; if (s.category === "resolved") setPendingResolve(s.id); else save(s.id); }}>
        {statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </NativeSelect>
      <Dialog open={!!pendingResolve} onOpenChange={(o) => !o && setPendingResolve(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Resolve ticket</DialogTitle><DialogDescription>How was this resolved? This feeds support reporting.</DialogDescription></DialogHeader>
          <div className="grid gap-3">
            <label className="grid gap-1 text-sm font-medium">Resolution
              <NativeSelect value={res.category} onChange={(e) => setRes({ ...res, category: e.target.value })}>
                {Object.entries(RESOLUTION_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </NativeSelect>
            </label>
            <label className="grid gap-1 text-sm font-medium">Note (optional)
              <Textarea rows={2} value={res.note} onChange={(e) => setRes({ ...res, note: e.target.value })} />
            </label>
          </div>
          <DialogFooter><Button disabled={busy} onClick={() => save(pendingResolve!, { resolutionCategory: res.category, resolutionNote: res.note })}>Resolve</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function TicketProperties({
  orgSlug, t, types, members, canWrite, canAssign, canLinkOrders,
}: {
  orgSlug: string; t: TicketPropsView; types: { id: string; name: string }[]; members: { membershipId: string; name: string }[];
  canWrite: boolean; canAssign: boolean; canLinkOrders: boolean;
}) {
  const router = useRouter();
  const [editCustomer, setEditCustomer] = useState(false);
  const [linking, setLinking] = useState(false);
  const [busy, start] = useTransition();
  const searchCustomers = useCallback((q: string) => searchCustomersAction(orgSlug, q), [orgSlug]);
  const searchOrders = useCallback((q: string) => searchOrdersForTicketAction(orgSlug, q), [orgSlug]);
  const upd = (patch: Record<string, unknown>) => updateTicketAction(orgSlug, t.id, patch);
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, msg: string) => start(async () => { const r = await fn(); if (r.ok) { toast.success(msg); router.refresh(); } else toast.error(r.error ?? "Something went wrong"); });

  return (
    <dl className="space-y-3 text-sm">
      <Row label="Priority"><InlineSelect label="Priority" value={t.priority} disabled={!canWrite} options={Object.entries(PRIORITY_LABELS).map(([value, label]) => ({ value, label }))} onSave={(v) => upd({ priority: v })} /></Row>
      <Row label="Assignee">
        <InlineSelect label="Assignee" value={t.assigneeMembershipId ?? ""} disabled={!canAssign} emptyLabel="Unassigned"
          options={[{ value: "", label: "Unassigned" }, ...members.map((m) => ({ value: m.membershipId, label: m.name }))]}
          onSave={(v) => assignTicketAction(orgSlug, t.id, v || null)} />
      </Row>
      <Row label="Type">
        <InlineSelect label="Type" value={t.ticketTypeId ?? ""} disabled={!canWrite} emptyLabel="Not set"
          options={[{ value: "", label: "Not set" }, ...types.map((x) => ({ value: x.id, label: x.name }))]} onSave={(v) => upd({ ticketTypeId: v || null })} />
      </Row>
      <Row label="Customer">
        {editCustomer ? (
          <RecordPicker label="Customer" value={null} search={searchCustomers} onChange={(o: PickerOption | null) => { if (o) run(() => upd({ customerId: o.id }), "Customer linked"); setEditCustomer(false); }} />
        ) : (
          <span className="flex items-center gap-2">
            {t.customerId ? (t.customerVisible ? <Link href={`/o/${orgSlug}/customers/${t.customerId}`} className="font-medium text-primary hover:underline">{t.customerName}</Link> : t.customerName) : <span className="text-muted-foreground">None</span>}
            {canWrite && <button type="button" className="text-xs text-primary hover:underline" onClick={() => setEditCustomer(true)}>{t.customerId ? "Change" : "Link customer"}</button>}
          </span>
        )}
      </Row>
      {(t.contactEmail || t.contactPhone) && <Row label="Contact"><span className="break-all">{[t.contactEmail, t.contactPhone].filter(Boolean).join(" · ")}</span></Row>}
      {t.resolutionCategory && <Row label="Resolution">{RESOLUTION_LABELS[t.resolutionCategory as keyof typeof RESOLUTION_LABELS]}{t.resolutionNote && <span className="block text-xs text-muted-foreground">{t.resolutionNote}</span>}</Row>}
      <Row label="Related records">
        <ul className="space-y-1">
          {t.links.map((l) => (
            <li key={l.id} className="flex items-center gap-2">
              <Link href={`/o/${orgSlug}/${l.type === "order" ? "orders" : "leads"}/${l.recordId}`} className="text-primary hover:underline">{l.label}</Link>
              {canWrite && <button type="button" aria-label={`Unlink ${l.label}`} disabled={busy} onClick={() => run(() => unlinkTicketRecordAction(orgSlug, t.id, l.id), "Unlinked")}><X className="size-3.5 text-muted-foreground" /></button>}
            </li>
          ))}
          {t.links.length === 0 && !linking && <li className="text-muted-foreground">None</li>}
        </ul>
        {canWrite && canLinkOrders && (linking ? (
          <div className="mt-2"><RecordPicker label="Link order" value={null} search={searchOrders} placeholder="Search orders…" onChange={(o) => { if (o) run(() => linkTicketRecordAction(orgSlug, t.id, { orderId: o.id }), "Order linked"); setLinking(false); }} /></div>
        ) : <button type="button" className="mt-1 flex items-center gap-1 text-xs text-primary hover:underline" onClick={() => setLinking(true)}><Link2 className="size-3.5" /> Link an order</button>)}
      </Row>
    </dl>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><dt className="mb-0.5 text-xs text-muted-foreground">{label}</dt><dd>{children}</dd></div>;
}
