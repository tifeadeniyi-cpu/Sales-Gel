import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { OrderDetail } from "@/domains/commerce/orders";
import { PAYMENT_METHOD_LABELS } from "@/domains/commerce/validation";
import { describeAudit } from "@/lib/audit-labels";
import { formatMoney } from "@/lib/money";
import { formatDateTime, formatRelative } from "@/lib/utils";
import type { OrgContext } from "@/server/authz/context";
import {
  CancelOrderDialog,
  CompleteOrderButton,
  FulfillDialog,
  MarkDeliveredButton,
  RecordPaymentDialog,
  RefundDialog,
  ReopenOrderButton,
  VoidPaymentButton,
} from "./order-actions";
import { DELIVERY_LABELS, FULFILLMENT_STATUS, ORDER_STATUS, PAYMENT_STATUS, SOURCE_LABELS } from "./labels";

const methodLabel = (m: string) => PAYMENT_METHOD_LABELS[m as keyof typeof PAYMENT_METHOD_LABELS] ?? m;

export function OrderBadges({ o }: { o: Pick<OrderDetail, "orderStatus" | "paymentStatus" | "fulfillmentStatus"> }) {
  return (
    <span className="inline-flex flex-wrap gap-1.5">
      <Badge tone={ORDER_STATUS[o.orderStatus]?.tone}>{ORDER_STATUS[o.orderStatus]?.label}</Badge>
      <Badge tone={PAYMENT_STATUS[o.paymentStatus]?.tone}>{PAYMENT_STATUS[o.paymentStatus]?.label}</Badge>
      <Badge tone={FULFILLMENT_STATUS[o.fulfillmentStatus]?.tone}>{FULFILLMENT_STATUS[o.fulfillmentStatus]?.label}</Badge>
    </span>
  );
}

export function OrderToolbar({ ctx, orgSlug, o }: { ctx: OrgContext; orgSlug: string; o: OrderDetail }) {
  const p = ctx.permissions;
  const net = (o.paidAmount ?? 0) - (o.refundedAmount ?? 0);
  const due = o.financialsVisible ? (o.totalAmount ?? 0) - net : 0;
  const remaining = o.items.map((i) => ({ id: i.id, name: i.name + (i.variantName ? ` (${i.variantName})` : ""), remaining: i.quantity - i.fulfilledQuantity })).filter((i) => i.remaining > 0);
  const write = p.has("orders.write");
  const fin = p.has("orders.financials");
  const live = o.payments.filter((x) => !x.voidedAt);
  return (
    <div className="flex flex-wrap gap-2">
      {o.orderStatus !== "cancelled" && fin && p.has("payments.record") && due > 0 && <RecordPaymentDialog key={`pay-${due}`} orgSlug={orgSlug} orderId={o.id} due={due} currency={o.currency} />}
      {write && o.orderStatus !== "cancelled" && remaining.length > 0 && <FulfillDialog key={`ful-${remaining.map((r) => r.remaining).join("-")}`} orgSlug={orgSlug} orderId={o.id} items={remaining} />}
      {fin && p.has("refunds.issue") && net > 0 && (
        <RefundDialog key={`ref-${net}`} orgSlug={orgSlug} orderId={o.id} refundable={net} currency={o.currency} payments={live.map((x) => ({ id: x.id, label: `${methodLabel(x.method)} · ${formatMoney(x.amount, x.currency)} · ${formatDateTime(x.receivedAt, ctx.timezone)}` }))} />
      )}
      {write && o.orderStatus === "open" && (
        <CompleteOrderButton orgSlug={orgSlug} orderId={o.id} warn={o.paymentStatus === "unpaid" || o.paymentStatus === "partially_paid" ? "This order still has a balance due. Completing it doesn't change payment status — the balance stays visible as unpaid." : o.fulfillmentStatus !== "fulfilled" ? "Not every item has been fulfilled yet. Complete anyway?" : null} />
      )}
      {write && o.orderStatus === "completed" && <ReopenOrderButton orgSlug={orgSlug} orderId={o.id} />}
      {write && o.orderStatus === "open" && net === 0 && o.fulfillmentStatus === "unfulfilled" && <CancelOrderDialog orgSlug={orgSlug} orderId={o.id} />}
    </div>
  );
}

export function OrderItemsCard({ o }: { o: OrderDetail }) {
  const fin = o.financialsVisible;
  const m = (v: number | null) => formatMoney(v, o.currency);
  return (
    <Card>
      <CardHeader><CardTitle>Items</CardTitle></CardHeader>
      <CardContent>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1">Item</th><th className="text-right">Qty</th>{fin && <><th className="text-right">Price</th><th className="text-right">Total</th></>}<th className="text-right">Fulfilled</th></tr></thead>
          <tbody className="divide-y">
            {o.items.map((i) => (
              <tr key={i.id}>
                <td className="py-2">
                  {i.productId ? <span className="font-medium">{i.name}</span> : <span className="font-medium">{i.name} <Badge tone="neutral">Custom</Badge></span>}
                  <div className="text-xs text-muted-foreground">{[i.variantName, i.sku].filter(Boolean).join(" · ")}</div>
                </td>
                <td className="text-right">{i.quantity}</td>
                {fin && <><td className="text-right">{m(i.unitPriceAmount)}{(i.discountAmount ?? 0) > 0 && <div className="text-xs text-muted-foreground">−{m(i.discountAmount)}</div>}</td><td className="text-right font-medium">{m(i.lineTotalAmount)}</td></>}
                <td className="text-right">{i.fulfilledQuantity}/{i.quantity}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {fin && (
          <dl className="ml-auto mt-4 max-w-xs space-y-1 text-sm">
            <div className="flex justify-between"><dt className="text-muted-foreground">Subtotal</dt><dd>{m(o.subtotalAmount)}</dd></div>
            {(o.discountAmount ?? 0) > 0 && <div className="flex justify-between"><dt className="text-muted-foreground">Discount</dt><dd>−{m(o.discountAmount)}</dd></div>}
            {(o.taxAmount ?? 0) > 0 && <div className="flex justify-between"><dt className="text-muted-foreground">Tax ({(o.taxRateBps / 100).toString()}%)</dt><dd>{m(o.taxAmount)}</dd></div>}
            {(o.shippingAmount ?? 0) > 0 && <div className="flex justify-between"><dt className="text-muted-foreground">Shipping</dt><dd>{m(o.shippingAmount)}</dd></div>}
            <div className="flex justify-between border-t pt-1 text-base font-semibold"><dt>Total</dt><dd data-testid="order-total">{m(o.totalAmount)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">Paid</dt><dd>{m(o.paidAmount)}</dd></div>
            {(o.refundedAmount ?? 0) > 0 && <div className="flex justify-between"><dt className="text-muted-foreground">Refunded</dt><dd>−{m(o.refundedAmount)}</dd></div>}
            <div className="flex justify-between font-medium"><dt>Balance due</dt><dd data-testid="balance-due">{m(Math.max(0, (o.totalAmount ?? 0) - ((o.paidAmount ?? 0) - (o.refundedAmount ?? 0))))}</dd></div>
          </dl>
        )}
      </CardContent>
    </Card>
  );
}

export function OrderMoneyCard({ ctx, orgSlug, o }: { ctx: OrgContext; orgSlug: string; o: OrderDetail }) {
  if (!o.financialsVisible) return null;
  const canVoid = ctx.permissions.has("payments.record");
  return (
    <Card>
      <CardHeader><CardTitle>Payments & refunds</CardTitle></CardHeader>
      <CardContent className="text-sm">
        {o.payments.length === 0 && o.refunds.length === 0 ? <p className="text-muted-foreground">No payments recorded yet.</p> : (
          <ul className="divide-y">
            {o.payments.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className={p.voidedAt ? "flex-1 line-through opacity-60" : "flex-1"}>
                  <span className="font-medium">{formatMoney(p.amount, p.currency)}</span> · {methodLabel(p.method)}{p.reference && ` · ${p.reference}`}
                  <span className="block text-xs text-muted-foreground">
                    {p.provider === "manual" ? `Recorded by ${p.recordedBy ?? "a team member"}` : `Verified by ${p.provider}`} · {formatDateTime(p.receivedAt, ctx.timezone)}
                  </span>
                </span>
                {p.voidedAt ? <Badge tone="inactive" title={p.voidReason ?? undefined}>Voided: {p.voidReason}</Badge> : <Badge tone={p.provider === "manual" ? "neutral" : "success"}>{p.provider === "manual" ? "Manual" : "Provider"}</Badge>}
                {!p.voidedAt && p.provider === "manual" && canVoid && <VoidPaymentButton orgSlug={orgSlug} paymentId={p.id} />}
              </li>
            ))}
            {o.refunds.map((r) => (
              <li key={r.id} className="py-2">
                <span className="font-medium text-danger">−{formatMoney(r.amount, r.currency)}</span> refund · {methodLabel(r.method)}
                <span className="block text-xs text-muted-foreground">{r.reason} · by {r.createdBy ?? "a team member"} · {formatDateTime(r.refundedAt, ctx.timezone)}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function OrderFulfillmentCard({ ctx, orgSlug, o }: { ctx: OrgContext; orgSlug: string; o: OrderDetail }) {
  return (
    <Card>
      <CardHeader><CardTitle>Fulfillment</CardTitle></CardHeader>
      <CardContent className="text-sm">
        {o.fulfillments.length === 0 ? <p className="text-muted-foreground">Nothing fulfilled yet.</p> : (
          <ul className="divide-y">
            {o.fulfillments.map((f) => (
              <li key={f.id} className="py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={f.deliveredAt ? "success" : "info"}>{f.status.replace("_", " ")}</Badge>
                  <span className="flex-1">{f.items.map((i) => `${i.quantity} × ${i.name}`).join(", ")}</span>
                  {!f.deliveredAt && ctx.permissions.has("orders.write") && <MarkDeliveredButton orgSlug={orgSlug} fulfillmentId={f.id} />}
                </div>
                <div className="text-xs text-muted-foreground">
                  {[f.carrier, f.trackingNumber].filter(Boolean).join(" · ")}
                  {f.trackingUrl && <> · <a href={f.trackingUrl} target="_blank" rel="noreferrer noopener" className="text-primary hover:underline">Track</a></>}
                  {" · "}{formatDateTime(f.shippedAt, ctx.timezone)}{f.deliveredAt && ` · delivered ${formatRelative(f.deliveredAt)}`}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function OrderSideCard({ orgSlug, o, ctx }: { orgSlug: string; o: OrderDetail; ctx: OrgContext }) {
  const addr = o.shippingAddress as Record<string, string | null> | null;
  return (
    <Card>
      <CardContent className="space-y-3 pt-5 text-sm">
        <Field label="Customer">{o.customerId ? (o.customerVisible ? <Link href={`/o/${orgSlug}/customers/${o.customerId}`} className="font-medium text-primary hover:underline">{o.customerName}</Link> : o.customerName) : "No customer"}</Field>
        {o.lead && <Field label="Lead">{o.lead.visible ? <Link href={`/o/${orgSlug}/leads/${o.lead.id}`} className="text-primary hover:underline">{o.lead.title}</Link> : o.lead.title}</Field>}
        <Field label="Channel">{SOURCE_LABELS[o.source] ?? o.source}</Field>
        <Field label="Placed">{formatDateTime(o.placedAt, ctx.timezone)}</Field>
        <Field label="Assigned to">{o.assignedName ?? "Unassigned"}</Field>
        <Field label="Delivery">{o.deliveryMethod ? DELIVERY_LABELS[o.deliveryMethod] : "Not set"}</Field>
        {addr && <Field label="Address"><span className="whitespace-pre-line">{[addr.line1, addr.line2, [addr.city, addr.region, addr.postalCode].filter(Boolean).join(", "), addr.country].filter(Boolean).join("\n")}</span></Field>}
        {(o.contactEmail || o.contactPhone) && <Field label="Contact">{[o.contactEmail, o.contactPhone].filter(Boolean).join(" · ")}</Field>}
        {o.notes && <Field label="Notes"><span className="whitespace-pre-wrap">{o.notes}</span></Field>}
        {o.cancelReason && <Field label="Cancel reason">{o.cancelReason}</Field>}
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><div className="text-xs text-muted-foreground">{label}</div><div>{children}</div></div>;
}

export function OrderTimeline({ ctx, events }: { ctx: OrgContext; events: { id: string; action: string; actorName: string | null; createdAt: Date; metadata: Record<string, unknown> | null }[] }) {
  return (
    <Card>
      <CardHeader><CardTitle>Activity</CardTitle></CardHeader>
      <CardContent>
        <ol className="space-y-3 text-sm">
          {events.map((e) => (
            <li key={e.id}>
              <span className="font-medium">{e.actorName ?? "System"}</span> {describeAudit(e.action)}
              {typeof e.metadata?.reason === "string" && <span className="text-muted-foreground"> — {e.metadata.reason}</span>}
              <div className="text-xs text-muted-foreground" title={formatDateTime(e.createdAt, ctx.timezone)}>{formatRelative(e.createdAt)}</div>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
