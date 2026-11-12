/**
 * Deterministic order arithmetic. All amounts are integer minor units in one currency.
 * Rounding: half away from zero, applied once per computed amount.
 */
export interface LineInput {
  unitPrice: number;
  quantity: number;
  discount?: number; // line discount, minor units (total for the line)
}

export interface TotalsInput {
  lines: LineInput[];
  orderDiscount?: number; // minor units, applied after line discounts
  shipping?: number; // minor units
  taxRateBps?: number; // basis points (825 = 8.25%), applied to (subtotal - discounts)
}

export interface Totals {
  lineTotals: number[];
  subtotal: number; // sum of line totals (after line discounts)
  discountTotal: number; // order-level discount (capped at subtotal)
  taxTotal: number;
  shippingTotal: number;
  total: number;
}

export function roundHalfAwayFromZero(x: number): number {
  return Math.sign(x) * Math.round(Math.abs(x));
}

function assertInt(name: string, v: number) {
  if (!Number.isSafeInteger(v)) throw new RangeError(`${name} must be a safe integer`);
}

export function computeTotals(input: TotalsInput): Totals {
  const lineTotals = input.lines.map((l, i) => {
    assertInt(`lines[${i}].unitPrice`, l.unitPrice);
    assertInt(`lines[${i}].quantity`, l.quantity);
    if (l.unitPrice < 0 || l.quantity <= 0) throw new RangeError("Prices must be ≥ 0 and quantities ≥ 1");
    const gross = l.unitPrice * l.quantity;
    const disc = Math.min(Math.max(l.discount ?? 0, 0), gross);
    return gross - disc;
  });
  const subtotal = lineTotals.reduce((a, b) => a + b, 0);
  const discountTotal = Math.min(Math.max(input.orderDiscount ?? 0, 0), subtotal);
  const taxable = subtotal - discountTotal;
  const bps = input.taxRateBps ?? 0;
  if (!Number.isInteger(bps) || bps < 0 || bps > 100_000) throw new RangeError("Tax rate out of range");
  const taxTotal = roundHalfAwayFromZero((taxable * bps) / 10_000);
  const shippingTotal = Math.max(input.shipping ?? 0, 0);
  assertInt("shipping", shippingTotal);
  return { lineTotals, subtotal, discountTotal, taxTotal, shippingTotal, total: taxable + taxTotal + shippingTotal };
}

export type PaymentStatus = "unpaid" | "partially_paid" | "paid" | "partially_refunded" | "refunded";

/** Payment status derives only from verified/recorded money movements — never from a UI toggle. */
export function derivePaymentStatus(total: number, paid: number, refunded: number): PaymentStatus {
  if (refunded > 0 && refunded >= paid && paid > 0) return "refunded";
  if (refunded > 0) return "partially_refunded";
  if (paid <= 0) return total === 0 ? "paid" : "unpaid";
  if (paid >= total) return "paid";
  return "partially_paid";
}

export type FulfillmentStatus = "unfulfilled" | "partially_fulfilled" | "fulfilled";

export function deriveFulfillmentStatus(items: { quantity: number; fulfilledQuantity: number }[]): FulfillmentStatus {
  const ordered = items.reduce((a, i) => a + i.quantity, 0);
  const done = items.reduce((a, i) => a + Math.min(i.fulfilledQuantity, i.quantity), 0);
  if (ordered === 0 || done === 0) return "unfulfilled";
  return done >= ordered ? "fulfilled" : "partially_fulfilled";
}

export function balanceDue(total: number, paid: number, refunded: number): number {
  return Math.max(total - (paid - refunded), 0);
}

/** Basis points from a user-entered percentage like "8.25". */
export function percentToBps(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined || input === "") return 0;
  const s = String(input).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [w, f = ""] = s.split(".");
  return Number(w) * 100 + Number((f + "00").slice(0, 2));
}
