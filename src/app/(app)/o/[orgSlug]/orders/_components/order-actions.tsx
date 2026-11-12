"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { FormField } from "@/components/app/form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { PAYMENT_METHOD_LABELS } from "@/domains/commerce/validation";
import { formatMoney, minorToInput } from "@/lib/money";
import type { ActionResult } from "@/server/actions";
import {
  cancelOrderAction,
  completeOrderAction,
  createFulfillmentAction,
  issueRefundAction,
  markDeliveredAction,
  recordPaymentAction,
  reopenOrderAction,
  voidPaymentAction,
} from "../actions";

function useForm<T extends Record<string, string>>(initial: T) {
  const [v, setV] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = (fn: () => Promise<ActionResult<unknown>>, ok: string, done: () => void) =>
    start(async () => {
      const res = await fn();
      if (res.ok) {
        toast.success(ok);
        setErrors({});
        setFormError(null);
        setV(initial);
        done();
        router.refresh();
      } else {
        setErrors(res.fieldErrors ?? {});
        setFormError(res.error);
      }
    });
  return { v, setV, errors, formError, pending, run };
}

const Alert = ({ msg }: { msg: string | null }) => (msg ? <p className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">{msg}</p> : null);
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function RecordPaymentDialog({ orgSlug, orderId, due, currency }: { orgSlug: string; orderId: string; due: number; currency: string }) {
  const [open, setOpen] = useState(false);
  const f = useForm({ amount: minorToInput(due, currency), method: "bank_transfer", reference: "", note: "", receivedAt: today() });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button>Record payment</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={(e) => { e.preventDefault(); f.run(() => recordPaymentAction(orgSlug, orderId, { ...f.v, receivedAt: f.v.receivedAt || undefined }), "Payment recorded", () => setOpen(false)); }} noValidate>
          <DialogHeader>
            <DialogTitle>Record a payment</DialogTitle>
            <DialogDescription>For money you&apos;ve already received outside a connected payment provider (cash, transfer, POS). {formatMoney(due, currency)} is due.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <Alert msg={f.formError} />
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label={`Amount (${currency})`} htmlFor="pay-amount" required errors={f.errors.amount}><Input inputMode="decimal" value={f.v.amount} onChange={(e) => f.setV({ ...f.v, amount: e.target.value })} /></FormField>
              <FormField label="Method" htmlFor="pay-method">
                <NativeSelect value={f.v.method} onChange={(e) => f.setV({ ...f.v, method: e.target.value })}>
                  {Object.entries(PAYMENT_METHOD_LABELS).filter(([k]) => k !== "payment_link").map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </NativeSelect>
              </FormField>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Reference" htmlFor="pay-ref" hint="Receipt or transfer ID"><Input value={f.v.reference} onChange={(e) => f.setV({ ...f.v, reference: e.target.value })} /></FormField>
              <FormField label="Date received" htmlFor="pay-date" errors={f.errors.receivedAt}><Input type="date" max={today()} value={f.v.receivedAt} onChange={(e) => f.setV({ ...f.v, receivedAt: e.target.value })} /></FormField>
            </div>
            <FormField label="Note" htmlFor="pay-note"><Textarea rows={2} value={f.v.note} onChange={(e) => f.setV({ ...f.v, note: e.target.value })} /></FormField>
          </div>
          <DialogFooter><Button type="submit" disabled={f.pending}>{f.pending ? "Saving…" : "Record payment"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RefundDialog({ orgSlug, orderId, refundable, currency, payments }: { orgSlug: string; orderId: string; refundable: number; currency: string; payments: { id: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const f = useForm({ amount: minorToInput(refundable, currency), reason: "", method: "bank_transfer", paymentId: "" });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline">Issue refund</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={(e) => { e.preventDefault(); f.run(() => issueRefundAction(orgSlug, orderId, { ...f.v, paymentId: f.v.paymentId || null }), "Refund recorded", () => setOpen(false)); }} noValidate>
          <DialogHeader>
            <DialogTitle>Issue a refund</DialogTitle>
            <DialogDescription>Records money you returned to the customer. Up to {formatMoney(refundable, currency)} can be refunded. Refunds can&apos;t be edited or deleted.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <Alert msg={f.formError} />
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label={`Amount (${currency})`} htmlFor="ref-amount" required errors={f.errors.amount}><Input inputMode="decimal" value={f.v.amount} onChange={(e) => f.setV({ ...f.v, amount: e.target.value })} /></FormField>
              <FormField label="Refunded via" htmlFor="ref-method">
                <NativeSelect value={f.v.method} onChange={(e) => f.setV({ ...f.v, method: e.target.value })}>
                  {Object.entries(PAYMENT_METHOD_LABELS).filter(([k]) => k !== "payment_link").map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </NativeSelect>
              </FormField>
            </div>
            {payments.length > 1 && (
              <FormField label="Against payment" htmlFor="ref-payment" errors={f.errors.paymentId}>
                <NativeSelect value={f.v.paymentId} onChange={(e) => f.setV({ ...f.v, paymentId: e.target.value })}>
                  <option value="">Order (any payment)</option>
                  {payments.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </NativeSelect>
              </FormField>
            )}
            <FormField label="Reason" htmlFor="ref-reason" required errors={f.errors.reason}><Textarea rows={2} value={f.v.reason} onChange={(e) => f.setV({ ...f.v, reason: e.target.value })} placeholder="e.g. Item damaged in transit" /></FormField>
          </div>
          <DialogFooter><Button type="submit" variant="destructive" disabled={f.pending}>{f.pending ? "Saving…" : "Record refund"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function FulfillDialog({ orgSlug, orderId, items }: { orgSlug: string; orderId: string; items: { id: string; name: string; remaining: number }[] }) {
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(items.map((i) => [i.id, String(i.remaining)])));
  const f = useForm({ status: "shipped", carrier: "", trackingNumber: "", trackingUrl: "", note: "" });
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const chosen = items.map((i) => ({ orderItemId: i.id, quantity: parseInt(qty[i.id] || "0", 10) || 0 })).filter((x) => x.quantity > 0);
    f.run(() => createFulfillmentAction(orgSlug, orderId, { ...f.v, items: chosen }), "Fulfillment saved", () => setOpen(false));
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline">Fulfill items</Button></DialogTrigger>
      <DialogContent className="max-w-lg">
        <form onSubmit={submit} noValidate>
          <DialogHeader><DialogTitle>Fulfill items</DialogTitle><DialogDescription>Choose what was shipped, delivered or picked up.</DialogDescription></DialogHeader>
          <div className="grid gap-4">
            <Alert msg={f.formError} />
            <ul className="divide-y rounded-md border text-sm">
              {items.map((i) => (
                <li key={i.id} className="flex items-center gap-3 px-3 py-2">
                  <span className="flex-1">{i.name}<span className="block text-xs text-muted-foreground">{i.remaining} remaining</span></span>
                  <Input aria-label={`Quantity of ${i.name}`} className="w-20" inputMode="numeric" value={qty[i.id]} onChange={(e) => setQty({ ...qty, [i.id]: e.target.value })} />
                </li>
              ))}
            </ul>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Status" htmlFor="ful-status">
                <NativeSelect value={f.v.status} onChange={(e) => f.setV({ ...f.v, status: e.target.value })}>
                  <option value="shipped">Shipped</option><option value="delivered">Delivered</option><option value="picked_up">Picked up</option>
                </NativeSelect>
              </FormField>
              <FormField label="Carrier" htmlFor="ful-carrier"><Input value={f.v.carrier} onChange={(e) => f.setV({ ...f.v, carrier: e.target.value })} placeholder="e.g. DHL, GIG" /></FormField>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Tracking number" htmlFor="ful-tn"><Input value={f.v.trackingNumber} onChange={(e) => f.setV({ ...f.v, trackingNumber: e.target.value })} /></FormField>
              <FormField label="Tracking link" htmlFor="ful-url" errors={f.errors.trackingUrl}><Input value={f.v.trackingUrl} onChange={(e) => f.setV({ ...f.v, trackingUrl: e.target.value })} placeholder="https://…" /></FormField>
            </div>
          </div>
          <DialogFooter><Button type="submit" disabled={f.pending}>{f.pending ? "Saving…" : "Save fulfillment"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CancelOrderDialog({ orgSlug, orderId }: { orgSlug: string; orderId: string }) {
  const [open, setOpen] = useState(false);
  const f = useForm({ reason: "" });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="ghost" className="text-danger">Cancel order</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={(e) => { e.preventDefault(); f.run(() => cancelOrderAction(orgSlug, orderId, f.v.reason), "Order cancelled", () => setOpen(false)); }} noValidate>
          <DialogHeader><DialogTitle>Cancel this order?</DialogTitle><DialogDescription>Cancelled orders are kept for your records but excluded from revenue. Any payment must be refunded first.</DialogDescription></DialogHeader>
          <div className="grid gap-4">
            <Alert msg={f.formError} />
            <FormField label="Reason" htmlFor="cancel-reason" required errors={f.errors.reason ?? f.errors._form}><Textarea rows={2} value={f.v.reason} onChange={(e) => f.setV({ reason: e.target.value })} /></FormField>
          </div>
          <DialogFooter><Button type="submit" variant="destructive" disabled={f.pending}>{f.pending ? "Cancelling…" : "Cancel order"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CompleteOrderButton({ orgSlug, orderId, warn }: { orgSlug: string; orderId: string; warn: string | null }) {
  return (
    <ConfirmDialog
      trigger={<Button variant="outline">Mark completed</Button>}
      title="Mark this order completed?"
      description={warn ?? "The order moves to Completed. You can reopen it later if needed."}
      confirmLabel="Mark completed"
      confirmVariant="default"
      onConfirm={() => completeOrderAction(orgSlug, orderId)}
      successMessage="Order completed"
    />
  );
}

export function ReopenOrderButton({ orgSlug, orderId }: { orgSlug: string; orderId: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Button variant="outline" disabled={pending} onClick={() => start(async () => { const r = await reopenOrderAction(orgSlug, orderId); if (r.ok) { toast.success("Order reopened"); router.refresh(); } else toast.error(r.error); })}>Reopen</Button>
  );
}

export function VoidPaymentButton({ orgSlug, paymentId }: { orgSlug: string; paymentId: string }) {
  const [open, setOpen] = useState(false);
  const f = useForm({ reason: "" });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="ghost" size="sm" className="h-7 text-xs">Void</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={(e) => { e.preventDefault(); f.run(() => voidPaymentAction(orgSlug, paymentId, f.v.reason), "Payment voided", () => setOpen(false)); }} noValidate>
          <DialogHeader><DialogTitle>Void this payment?</DialogTitle><DialogDescription>Use this only for a payment recorded by mistake. It stays visible, struck through, with your reason.</DialogDescription></DialogHeader>
          <div className="grid gap-4">
            <Alert msg={f.formError} />
            <FormField label="Reason" htmlFor="void-reason" required errors={f.errors.reason ?? f.errors._form}><Input value={f.v.reason} onChange={(e) => f.setV({ reason: e.target.value })} placeholder="e.g. Entered twice" /></FormField>
          </div>
          <DialogFooter><Button type="submit" variant="destructive" disabled={f.pending}>Void payment</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function MarkDeliveredButton({ orgSlug, fulfillmentId }: { orgSlug: string; fulfillmentId: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Button variant="ghost" size="sm" className="h-7 text-xs" disabled={pending} onClick={() => start(async () => { const r = await markDeliveredAction(orgSlug, fulfillmentId); if (r.ok) { toast.success("Marked delivered"); router.refresh(); } else toast.error(r.error); })}>Mark delivered</Button>
  );
}
