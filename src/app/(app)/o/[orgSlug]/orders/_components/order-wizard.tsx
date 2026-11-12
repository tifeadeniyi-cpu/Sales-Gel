"use client";
import { useRouter } from "next/navigation";
import { Check, Minus, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { FormField } from "@/components/app/form";
import { RecordPicker, type PickerOption } from "@/components/app/record-picker";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { computeTotals, percentToBps } from "@/domains/commerce/math";
import { formatMoney, minorToInput, parseMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { searchCustomersAction } from "../../customers/actions";
import { CURRENCY_OPTIONS } from "../../customers/_components/labels";
import { createOrderAction, searchVariantsAction } from "../actions";
import { DELIVERY_LABELS, SOURCE_LABELS } from "./labels";

interface VariantHit { id: string; productName: string; variantName: string; sku: string | null; priceAmount: number; currency: string; inventoryQuantity: number | null }
interface Line { key: string; variantId: string | null; name: string; detail: string | null; unitPrice: string; quantity: number; discount: string }

const STEPS = ["Customer", "Items", "Review & details"] as const;
let keySeq = 0;
const nextKey = () => `l${++keySeq}`;

export function OrderWizard({
  orgSlug,
  defaultCurrency,
  members,
  canAssign,
  presetCustomer,
  presetLead,
  customerCurrency,
}: {
  orgSlug: string;
  defaultCurrency: string;
  members: { membershipId: string; name: string }[];
  canAssign: boolean;
  presetCustomer?: PickerOption | null;
  presetLead?: { id: string; label: string; currency: string } | null;
  customerCurrency?: string | null;
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [customer, setCustomer] = useState<PickerOption | null>(presetCustomer ?? null);
  const [currency, setCurrency] = useState(customerCurrency ?? presetLead?.currency ?? defaultCurrency);
  const [lines, setLines] = useState<Line[]>([]);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<VariantHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [d, setD] = useState({ orderDiscount: "", taxRate: "", shipping: "", deliveryMethod: "", source: "manual", notes: "", contactEmail: "", contactPhone: "", assignedMembershipId: "", line1: "", line2: "", city: "", region: "", postalCode: "", country: "" });
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const searchCustomers = useCallback((s: string) => searchCustomersAction(orgSlug, s), [orgSlug]);

  useEffect(() => {
    if (step !== 1) return;
    let cancel = false;
    const t = setTimeout(async () => {
      setSearching(true);
      const res = await searchVariantsAction(orgSlug, q);
      if (!cancel) {
        setHits(res.ok ? res.data : []);
        setSearching(false);
      }
    }, 200);
    return () => { cancel = true; clearTimeout(t); };
  }, [q, step, orgSlug]);

  const addVariant = (h: VariantHit) => {
    if (h.currency !== currency) {
      toast.error(`${h.productName} is priced in ${h.currency}; this order is in ${currency}.`);
      return;
    }
    const existing = lines.find((l) => l.variantId === h.id);
    if (existing) setLines(lines.map((l) => (l.variantId === h.id ? { ...l, quantity: l.quantity + 1 } : l)));
    else setLines([...lines, { key: nextKey(), variantId: h.id, name: h.productName, detail: [h.variantName !== "Default" ? h.variantName : null, h.sku].filter(Boolean).join(" · ") || null, unitPrice: minorToInput(h.priceAmount, h.currency), quantity: 1, discount: "" }]);
  };
  const setLine = (key: string, patch: Partial<Line>) => setLines(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const preview = useMemo(() => {
    try {
      const bps = d.taxRate ? percentToBps(d.taxRate) : 0;
      const parsed = lines.map((l) => ({ unitPrice: parseMoney(l.unitPrice, currency), quantity: l.quantity, discount: parseMoney(l.discount, currency) ?? 0 }));
      if (bps === null || parsed.some((p) => p.unitPrice === null || p.unitPrice < 0)) return null;
      return computeTotals({ lines: parsed as { unitPrice: number; quantity: number; discount: number }[], orderDiscount: parseMoney(d.orderDiscount, currency) ?? 0, shipping: parseMoney(d.shipping, currency) ?? 0, taxRateBps: bps });
    } catch {
      return null;
    }
  }, [lines, d.orderDiscount, d.shipping, d.taxRate, currency]);

  const canNext = step === 0 || (step === 1 && lines.length > 0 && lines.every((l) => l.name.trim() && l.unitPrice !== ""));
  const hasAddress = d.line1 || d.city || d.country;

  const submit = () =>
    start(async () => {
      const res = await createOrderAction(orgSlug, {
        customerId: customer?.id ?? null,
        leadId: presetLead?.id ?? null,
        currency,
        source: d.source as never,
        lines: lines.map((l) => ({ variantId: l.variantId, name: l.variantId ? null : l.name, unitPrice: l.unitPrice, quantity: l.quantity, discount: l.discount || null })),
        orderDiscount: d.orderDiscount || null,
        taxRate: d.taxRate || null,
        shipping: d.shipping || null,
        deliveryMethod: (d.deliveryMethod || null) as never,
        shippingAddress: hasAddress ? { line1: d.line1, line2: d.line2, city: d.city, region: d.region, postalCode: d.postalCode, country: d.country } : null,
        contactEmail: d.contactEmail || null,
        contactPhone: d.contactPhone || null,
        notes: d.notes || null,
        assignedMembershipId: d.assignedMembershipId || null,
      });
      if (res.ok) {
        toast.success(`Order ORD-${res.data.number} created`);
        router.push(`/o/${orgSlug}/orders/${res.data.id}`);
      } else {
        setErrors(res.fieldErrors ?? {});
        setFormError(res.error);
        const k = Object.keys(res.fieldErrors ?? {});
        if (k.some((x) => x.startsWith("lines"))) setStep(1);
        else if (k.includes("customerId")) setStep(0);
      }
    });

  return (
    <div className="space-y-6">
      <ol className="flex items-center gap-2 text-sm" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s} className="flex items-center gap-2">
            <button type="button" disabled={i > step} onClick={() => setStep(i)} aria-current={i === step ? "step" : undefined}
              className={cn("flex items-center gap-2 rounded-full px-3 py-1", i === step ? "bg-primary text-primary-foreground" : i < step ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
              {i < step ? <Check className="size-3.5" /> : <span>{i + 1}</span>} {s}
            </button>
            {i < STEPS.length - 1 && <span className="h-px w-6 bg-border" />}
          </li>
        ))}
      </ol>
      {formError && <p className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">{formError}</p>}

      {step === 0 && (
        <Card>
          <CardHeader><CardTitle>Who is this order for?</CardTitle></CardHeader>
          <CardContent className="grid gap-4">
            {presetLead && <p className="rounded-md bg-info/10 px-3 py-2 text-sm text-info">Linked to lead <strong>{presetLead.label}</strong>.</p>}
            <div className="grid gap-1.5">
              <span className="text-sm font-medium">Customer</span>
              <RecordPicker label="Customer" value={customer} onChange={setCustomer} search={searchCustomers} placeholder="Search customers by name, email, phone…" invalid={!!errors.customerId} />
              {errors.customerId ? <p className="text-xs text-danger" role="alert">{errors.customerId[0]}</p> : <p className="text-xs text-muted-foreground">Optional — walk-in sales can be recorded without a customer.</p>}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Currency" htmlFor="o-currency" hint="All items must be priced in this currency.">
                <NativeSelect value={currency} onChange={(e) => { setCurrency(e.target.value); setLines([]); }}>
                  {[...new Set([currency, ...CURRENCY_OPTIONS.map((c) => c.value)])].map((c) => <option key={c} value={c}>{c}</option>)}
                </NativeSelect>
              </FormField>
              <FormField label="Sales channel" htmlFor="o-source">
                <NativeSelect value={d.source} onChange={(e) => setD({ ...d, source: e.target.value })}>
                  {Object.entries(SOURCE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </NativeSelect>
              </FormField>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 1 && (
        <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
          <Card>
            <CardHeader><CardTitle>Items</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {lines.length === 0 && <p className="text-sm text-muted-foreground">Add products from your catalog or a custom item.</p>}
              {errors.lines && <p className="text-xs text-danger">{errors.lines[0]}</p>}
              {lines.map((l, i) => (
                <div key={l.key} className="rounded-md border p-3">
                  <div className="flex items-start gap-2">
                    <div className="flex-1">
                      {l.variantId ? <div className="font-medium">{l.name}</div> : <Input aria-label={`Item ${i + 1} name`} value={l.name} onChange={(e) => setLine(l.key, { name: e.target.value })} placeholder="Custom item name" />}
                      {l.detail && <div className="text-xs text-muted-foreground">{l.detail}</div>}
                    </div>
                    <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${l.name || "item"}`} onClick={() => setLines(lines.filter((x) => x.key !== l.key))}><Trash2 /></Button>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <label className="text-xs text-muted-foreground">Unit price
                      <Input aria-label={`Item ${i + 1} price`} inputMode="decimal" value={l.unitPrice} onChange={(e) => setLine(l.key, { unitPrice: e.target.value })} />
                    </label>
                    <label className="text-xs text-muted-foreground">Quantity
                      <div className="flex items-center gap-1">
                        <Button type="button" variant="outline" size="icon" className="size-8" aria-label="Decrease quantity" onClick={() => setLine(l.key, { quantity: Math.max(1, l.quantity - 1) })}><Minus /></Button>
                        <Input aria-label={`Item ${i + 1} quantity`} inputMode="numeric" className="text-center" value={l.quantity} onChange={(e) => setLine(l.key, { quantity: Math.max(1, parseInt(e.target.value || "1", 10) || 1) })} />
                        <Button type="button" variant="outline" size="icon" className="size-8" aria-label="Increase quantity" onClick={() => setLine(l.key, { quantity: l.quantity + 1 })}><Plus /></Button>
                      </div>
                    </label>
                    <label className="text-xs text-muted-foreground">Line discount
                      <Input aria-label={`Item ${i + 1} discount`} inputMode="decimal" value={l.discount} onChange={(e) => setLine(l.key, { discount: e.target.value })} placeholder="0.00" />
                    </label>
                  </div>
                  {Object.entries(errors).filter(([k]) => k.startsWith(`lines.${i}.`)).map(([k, v]) => <p key={k} className="mt-1 text-xs text-danger">{v[0]}</p>)}
                  {preview && <div className="mt-2 text-right text-sm font-medium">{formatMoney(preview.lineTotals[i], currency)}</div>}
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={() => setLines([...lines, { key: nextKey(), variantId: null, name: "", detail: null, unitPrice: "", quantity: 1, discount: "" }])}><Plus /> Custom item</Button>
            </CardContent>
          </Card>
          <Card className="h-fit">
            <CardHeader><CardTitle>Catalog</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products or SKU…" aria-label="Search catalog" />
              <ul className="max-h-96 divide-y overflow-y-auto text-sm">
                {hits.map((h) => (
                  <li key={h.id}>
                    <button type="button" className="flex w-full items-center gap-2 py-2 text-left hover:bg-muted/40 disabled:opacity-50" disabled={h.currency !== currency} onClick={() => addVariant(h)} aria-label={`Add ${h.productName}${h.variantName !== "Default" ? ` ${h.variantName}` : ""}`}>
                      <span className="flex-1">
                        <span className="font-medium">{h.productName}</span>
                        <span className="block text-xs text-muted-foreground">{[h.variantName !== "Default" ? h.variantName : null, h.sku, h.inventoryQuantity !== null ? `${h.inventoryQuantity} in stock` : null].filter(Boolean).join(" · ")}</span>
                      </span>
                      <span className="font-medium">{formatMoney(h.priceAmount, h.currency)}</span>
                      <Plus className="size-4 text-primary" />
                    </button>
                  </li>
                ))}
                {!searching && hits.length === 0 && <li className="py-2 text-muted-foreground">{q ? "No products match." : "No active products yet."}</li>}
              </ul>
            </CardContent>
          </Card>
        </div>
      )}

      {step === 2 && (
        <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
          <Card>
            <CardHeader><CardTitle>Details</CardTitle></CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <FormField label="Order discount" htmlFor="o-disc" errors={errors.orderDiscount}><Input inputMode="decimal" value={d.orderDiscount} onChange={(e) => setD({ ...d, orderDiscount: e.target.value })} placeholder="0.00" /></FormField>
                <FormField label="Tax rate (%)" htmlFor="o-tax" errors={errors.taxRate}><Input inputMode="decimal" value={d.taxRate} onChange={(e) => setD({ ...d, taxRate: e.target.value })} placeholder="0" /></FormField>
                <FormField label="Shipping" htmlFor="o-ship" errors={errors.shipping}><Input inputMode="decimal" value={d.shipping} onChange={(e) => setD({ ...d, shipping: e.target.value })} placeholder="0.00" /></FormField>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Delivery method" htmlFor="o-delivery">
                  <NativeSelect value={d.deliveryMethod} onChange={(e) => setD({ ...d, deliveryMethod: e.target.value })}>
                    <option value="">Not set</option>
                    {Object.entries(DELIVERY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </NativeSelect>
                </FormField>
                {canAssign && (
                  <FormField label="Assigned to" htmlFor="o-assign" errors={errors.assignedMembershipId}>
                    <NativeSelect value={d.assignedMembershipId} onChange={(e) => setD({ ...d, assignedMembershipId: e.target.value })}>
                      <option value="">Unassigned</option>
                      {members.map((m) => <option key={m.membershipId} value={m.membershipId}>{m.name}</option>)}
                    </NativeSelect>
                  </FormField>
                )}
              </div>
              {(d.deliveryMethod === "shipping" || d.deliveryMethod === "local_delivery") && (
                <fieldset className="grid gap-2">
                  <legend className="mb-1 text-sm font-medium">Delivery address</legend>
                  <Input aria-label="Address line 1" placeholder="Street address" value={d.line1} onChange={(e) => setD({ ...d, line1: e.target.value })} />
                  <Input aria-label="Address line 2" placeholder="Apartment, suite (optional)" value={d.line2} onChange={(e) => setD({ ...d, line2: e.target.value })} />
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Input aria-label="City" placeholder="City" value={d.city} onChange={(e) => setD({ ...d, city: e.target.value })} />
                    <Input aria-label="State / region" placeholder="State / region" value={d.region} onChange={(e) => setD({ ...d, region: e.target.value })} />
                    <Input aria-label="Postal code" placeholder="Postal code" value={d.postalCode} onChange={(e) => setD({ ...d, postalCode: e.target.value })} />
                    <Input aria-label="Country" placeholder="Country" value={d.country} onChange={(e) => setD({ ...d, country: e.target.value })} />
                  </div>
                </fieldset>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Contact email" htmlFor="o-email" errors={errors.contactEmail}><Input type="email" value={d.contactEmail} onChange={(e) => setD({ ...d, contactEmail: e.target.value })} /></FormField>
                <FormField label="Contact phone" htmlFor="o-phone"><Input value={d.contactPhone} onChange={(e) => setD({ ...d, contactPhone: e.target.value })} /></FormField>
              </div>
              <FormField label="Internal notes" htmlFor="o-notes"><Textarea rows={3} value={d.notes} onChange={(e) => setD({ ...d, notes: e.target.value })} /></FormField>
            </CardContent>
          </Card>
          <Card className="h-fit">
            <CardHeader><CardTitle>Summary</CardTitle></CardHeader>
            <CardContent className="space-y-1.5 text-sm">
              <div className="text-muted-foreground">{customer ? customer.label : "No customer"} · {currency}</div>
              <ul className="divide-y border-y py-1">
                {lines.map((l, i) => <li key={l.key} className="flex justify-between gap-2 py-1"><span>{l.quantity} × {l.name}</span><span>{preview ? formatMoney(preview.lineTotals[i], currency) : "—"}</span></li>)}
              </ul>
              {preview ? (
                <>
                  <Row label="Subtotal" v={formatMoney(preview.subtotal, currency)} />
                  {preview.discountTotal > 0 && <Row label="Discount" v={`−${formatMoney(preview.discountTotal, currency)}`} />}
                  {preview.taxTotal > 0 && <Row label="Tax" v={formatMoney(preview.taxTotal, currency)} />}
                  {preview.shippingTotal > 0 && <Row label="Shipping" v={formatMoney(preview.shippingTotal, currency)} />}
                  <div className="flex justify-between border-t pt-2 text-base font-semibold"><span>Total</span><span data-testid="order-total">{formatMoney(preview.total, currency)}</span></div>
                </>
              ) : <p className="text-danger">Check prices, discounts and tax rate.</p>}
              <p className="pt-2 text-xs text-muted-foreground">The order is created unpaid. Record payments on the order once money is received.</p>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="flex justify-between">
        <Button type="button" variant="outline" onClick={() => (step === 0 ? router.back() : setStep(step - 1))}>{step === 0 ? "Cancel" : "Back"}</Button>
        {step < 2 ? (
          <Button type="button" disabled={!canNext} onClick={() => setStep(step + 1)}>Continue</Button>
        ) : (
          <Button type="button" disabled={pending || !preview} onClick={submit}>{pending ? "Creating…" : "Create order"}</Button>
        )}
      </div>
    </div>
  );
}

function Row({ label, v }: { label: string; v: string }) {
  return <div className="flex justify-between"><span className="text-muted-foreground">{label}</span><span>{v}</span></div>;
}
