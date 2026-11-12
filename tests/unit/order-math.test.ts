import { describe, expect, it } from "vitest";
import { balanceDue, computeTotals, deriveFulfillmentStatus, derivePaymentStatus, percentToBps } from "@/domains/commerce/math";

describe("computeTotals", () => {
  it("applies line discounts, order discount, tax on discounted subtotal, then shipping", () => {
    const t = computeTotals({ lines: [{ unitPrice: 1999, quantity: 3, discount: 500 }, { unitPrice: 450, quantity: 2 }], orderDiscount: 1000, shipping: 799, taxRateBps: 825 });
    expect(t.lineTotals).toEqual([5497, 900]);
    expect(t.subtotal).toBe(6397);
    expect(t.discountTotal).toBe(1000);
    expect(t.taxTotal).toBe(445); // 5397 * 8.25% = 445.25 → 445
    expect(t.total).toBe(5397 + 445 + 799);
  });
  it("rounds half away from zero", () => {
    expect(computeTotals({ lines: [{ unitPrice: 100, quantity: 1 }], taxRateBps: 50 }).taxTotal).toBe(1); // 0.5 → 1
    expect(computeTotals({ lines: [{ unitPrice: 300, quantity: 1 }], taxRateBps: 50 }).taxTotal).toBe(2); // 1.5 → 2
  });
  it("caps discounts and never produces negative totals", () => {
    const t = computeTotals({ lines: [{ unitPrice: 500, quantity: 1, discount: 9999 }], orderDiscount: 9999 });
    expect(t).toMatchObject({ subtotal: 0, discountTotal: 0, total: 0 });
  });
  it("rejects fractional minor units and bad quantities", () => {
    expect(() => computeTotals({ lines: [{ unitPrice: 10.5, quantity: 1 }] })).toThrow();
    expect(() => computeTotals({ lines: [{ unitPrice: 10, quantity: 0 }] })).toThrow();
  });
  it("is stable for many lines (no float drift)", () => {
    const lines = Array.from({ length: 1000 }, () => ({ unitPrice: 10, quantity: 3 }));
    expect(computeTotals({ lines }).subtotal).toBe(30000);
  });
});

describe("payment & fulfillment status", () => {
  it("derives payment status from money movements", () => {
    expect(derivePaymentStatus(1000, 0, 0)).toBe("unpaid");
    expect(derivePaymentStatus(1000, 400, 0)).toBe("partially_paid");
    expect(derivePaymentStatus(1000, 1000, 0)).toBe("paid");
    expect(derivePaymentStatus(1000, 1000, 300)).toBe("partially_refunded");
    expect(derivePaymentStatus(1000, 1000, 1000)).toBe("refunded");
    expect(derivePaymentStatus(0, 0, 0)).toBe("paid");
    expect(balanceDue(1000, 1000, 300)).toBe(300);
    expect(balanceDue(1000, 400, 0)).toBe(600);
  });
  it("derives fulfillment status from quantities", () => {
    expect(deriveFulfillmentStatus([{ quantity: 2, fulfilledQuantity: 0 }])).toBe("unfulfilled");
    expect(deriveFulfillmentStatus([{ quantity: 2, fulfilledQuantity: 1 }, { quantity: 1, fulfilledQuantity: 1 }])).toBe("partially_fulfilled");
    expect(deriveFulfillmentStatus([{ quantity: 2, fulfilledQuantity: 2 }])).toBe("fulfilled");
  });
  it("parses tax percentages to basis points exactly", () => {
    expect(percentToBps("8.25")).toBe(825);
    expect(percentToBps("7.5")).toBe(750);
    expect(percentToBps("0")).toBe(0);
    expect(percentToBps("")).toBe(0);
    expect(percentToBps("8.255")).toBeNull();
    expect(percentToBps("-1")).toBeNull();
  });
});
