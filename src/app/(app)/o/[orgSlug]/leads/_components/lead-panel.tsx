"use client";
import Link from "next/link";
import { Check, Plus, Trash2, Trophy, XCircle } from "lucide-react";
import { useCallback, useState, useTransition } from "react";
import { toast } from "sonner";
import { InlineSelect, InlineText } from "@/components/app/inline-field";
import { RecordPicker } from "@/components/app/record-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { LeadDetail } from "@/domains/sales/service";
import { REQUIRABLE_FIELDS } from "@/domains/sales/validation";
import { formatMoney, minorToInput, parseMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { searchCustomersAction } from "../../customers/actions";
import { CURRENCY_OPTIONS, SOURCE_OPTIONS } from "../../customers/_components/labels";
import { closeLeadAction, moveLeadAction, setLeadProductsAction, updateLeadFieldAction } from "../actions";
import { LostReasonDialog } from "./lost-reason-dialog";
import { LEAD_STATUS, PRIORITY_OPTIONS, STAGE_BAR } from "./labels";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] items-center gap-2 py-1">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

export function LeadPanel({ orgSlug, lead: l, members, canWrite, canAssign }: { orgSlug: string; lead: LeadDetail; members: { membershipId: string; name: string }[]; canWrite: boolean; canAssign: boolean }) {
  const [lostOpen, setLostOpen] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [editingCustomer, setEditingCustomer] = useState(false);
  const [products, setProducts] = useState(l.products.map((p) => ({ name: p.name, quantity: p.quantity })));
  const [newProduct, setNewProduct] = useState("");
  const search = useCallback((q: string) => searchCustomersAction(orgSlug, q), [orgSlug]);
  const save = (field: string) => (value: string | null) => updateLeadFieldAction(orgSlug, l.id, field, value);
  const editable = canWrite && !l.archivedAt;
  const currentIdx = l.stages.findIndex((s) => s.id === l.stageId);
  const openStages = l.stages.filter((s) => s.category === "open");

  const move = (stageId: string, reason?: string) =>
    start(async () => {
      const res = await moveLeadAction(orgSlug, l.id, stageId, null, reason);
      if (res.ok) toast.success("Stage updated"); else toast.error(res.error);
    });
  const close = (outcome: "won" | "lost", reason?: string) =>
    start(async () => {
      const res = await closeLeadAction(orgSlug, l.id, outcome, reason);
      if (res.ok) toast.success(outcome === "won" ? "Marked as won 🎉" : "Marked as lost"); else toast.error(res.error);
    });
  const saveProducts = (next: { name: string; quantity: number }[]) => {
    const prev = products;
    setProducts(next);
    start(async () => {
      const r = await setLeadProductsAction(orgSlug, l.id, next);
      if (!r.ok) { setProducts(prev); toast.error(r.error); }
    });
  };

  return (
    <div className="space-y-6">
      <section aria-label="Stage">
        <ol className="flex gap-1" aria-label="Pipeline progress">
          {openStages.map((s) => {
            const idx = l.stages.findIndex((x) => x.id === s.id);
            const reached = l.status === "won" || (l.status === "open" && idx <= currentIdx);
            const current = s.id === l.stageId;
            return (
              <li key={s.id} className="flex-1">
                <button
                  type="button"
                  disabled={!editable || pending || current}
                  onClick={() => move(s.id)}
                  aria-current={current ? "step" : undefined}
                  title={s.requiredFields.length ? `Requires: ${s.requiredFields.map((f) => REQUIRABLE_FIELDS[f as keyof typeof REQUIRABLE_FIELDS]).join(", ")}` : s.name}
                  className={cn("w-full rounded px-1 py-1.5 text-[11px] font-medium leading-tight transition", reached ? `${STAGE_BAR[s.color] ?? "bg-primary"} text-white` : "bg-muted text-muted-foreground hover:bg-muted/70", current && "ring-2 ring-offset-1 ring-ink/30")}
                >
                  {s.name}
                </button>
              </li>
            );
          })}
        </ol>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge tone={LEAD_STATUS[l.status].tone}>{LEAD_STATUS[l.status].label}</Badge>
          {l.status === "lost" && l.lostReason && <span className="text-xs text-muted-foreground">Reason: {l.lostReason}</span>}
          {editable && l.status === "open" && (
            <>
              <Button size="sm" variant="outline" className="border-success/40 text-success" disabled={pending} onClick={() => close("won")}><Trophy /> Won</Button>
              <Button size="sm" variant="outline" className="border-danger/40 text-danger" disabled={pending} onClick={() => setLostOpen(l.stages.find((s) => s.category === "lost")?.id ?? "")}><XCircle /> Lost</Button>
            </>
          )}
          {editable && l.status !== "open" && openStages.length > 0 && (
            <Button size="sm" variant="outline" disabled={pending} onClick={() => move(openStages[openStages.length - 1].id)}>Reopen</Button>
          )}
        </div>
        {l.status === "won" && (
          <p className="mt-2 text-xs text-muted-foreground">Won deals don&apos;t create orders automatically. Linking an order arrives with Orders (Phase 4), so revenue is never double-counted.</p>
        )}
      </section>

      <section>
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Details</h3>
        <dl>
          <Row label="Title"><InlineText label="Title" value={l.title} onSave={save("title")} disabled={!editable} /></Row>
          <Row label="Customer">
            {editingCustomer ? (
              <RecordPicker
                label="Customer"
                value={null}
                search={search}
                onChange={(o) => start(async () => { const r = await updateLeadFieldAction(orgSlug, l.id, "customerId", o?.id ?? null); setEditingCustomer(false); if (!r.ok) toast.error(r.error); })}
              />
            ) : (
              <div className="flex items-center gap-2 text-sm">
                {l.customerId ? (l.customerVisible ? <Link href={`/o/${orgSlug}/customers/${l.customerId}`} className="hover:underline">{l.customerName}</Link> : <span className="text-muted-foreground">{l.customerName}</span>) : <span className="text-muted-foreground">No customer</span>}
                {editable && <button type="button" className="text-xs text-primary hover:underline" onClick={() => setEditingCustomer(true)}>{l.customerId ? "Change" : "Link customer"}</button>}
              </div>
            )}
          </Row>
          <Row label="Estimated value">
            <InlineText label="Estimated value" value={l.valueAmount === null ? null : minorToInput(l.valueAmount, l.currency)} display={(v) => (v === null ? "—" : formatMoney(parseMoney(v, l.currency), l.currency))} onSave={save("value")} disabled={!editable} />
          </Row>
          <Row label="Currency"><InlineSelect label="Currency" value={l.currency} options={CURRENCY_OPTIONS} onSave={save("currency")} disabled={!editable} /></Row>
          <Row label="Probability">
            <InlineText label="Probability" type="number" value={l.probability === null ? null : String(l.probability)} display={(v) => (v === null ? `${l.stages.find((s) => s.id === l.stageId)?.probability ?? 0}% (stage default)` : `${v}%`)} onSave={save("probability")} disabled={!editable} placeholder="Stage default" />
          </Row>
          <Row label="Priority"><InlineSelect label="Priority" value={l.priority} options={PRIORITY_OPTIONS} onSave={save("priority")} disabled={!editable} /></Row>
          <Row label="Source"><InlineSelect label="Source" value={l.source} options={SOURCE_OPTIONS} emptyLabel="Not set" onSave={save("source")} disabled={!editable} /></Row>
          <Row label="Representative">
            <InlineSelect label="Representative" value={l.ownerMembershipId} options={members.map((m) => ({ value: m.membershipId, label: m.name }))} emptyLabel="Unassigned" onSave={save("ownerMembershipId")} disabled={!editable || !canAssign} />
          </Row>
          <Row label="Expected close"><InlineText label="Expected close" type="date" value={l.expectedCloseDate} onSave={save("expectedCloseDate")} disabled={!editable} placeholder="Set date" /></Row>
          <Row label="Pipeline"><span className="text-sm">{l.pipelineName}</span></Row>
        </dl>
      </section>

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Interested products</h3>
        {products.length === 0 && <p className="text-sm text-muted-foreground">None yet.</p>}
        <ul className="space-y-1">
          {products.map((p, i) => (
            <li key={`${p.name}-${i}`} className="flex items-center gap-2 text-sm">
              <Check className="size-3.5 text-primary" />
              <span className="flex-1">{p.name}</span>
              <span className="text-xs text-muted-foreground">× {p.quantity}</span>
              {editable && <button type="button" aria-label={`Remove ${p.name}`} onClick={() => saveProducts(products.filter((_, j) => j !== i))} className="rounded p-0.5 hover:bg-muted"><Trash2 className="size-3.5" /></button>}
            </li>
          ))}
        </ul>
        {editable && (
          <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (newProduct.trim()) { saveProducts([...products, { name: newProduct.trim(), quantity: 1 }]); setNewProduct(""); } }}>
            <Input aria-label="Add product" value={newProduct} onChange={(e) => setNewProduct(e.target.value)} placeholder="Add a product…" className="h-8" />
            <Button size="sm" variant="outline" type="submit"><Plus /> Add</Button>
          </form>
        )}
        <p className="mt-1 text-xs text-muted-foreground">These will link to your catalog when Products ships (Phase 4).</p>
      </section>

      <section>
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Notes</h3>
        <InlineText label="Notes" value={l.notes} onSave={save("notes")} disabled={!editable} placeholder="Add notes…" />
      </section>

      <LostReasonDialog open={lostOpen !== null} title={l.title} onCancel={() => setLostOpen(null)} onConfirm={(reason) => { setLostOpen(null); close("lost", reason); }} />
    </div>
  );
}
