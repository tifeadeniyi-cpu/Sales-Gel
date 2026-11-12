import { describe, expect, it } from "vitest";
import { formatMoney, minorToInput, parseMoney, sumByCurrency, weighted } from "@/lib/money";

describe("money", () => {
  it("parses user input into minor units without float drift", () => {
    expect(parseMoney("1,250.50", "USD")).toBe(125050);
    expect(parseMoney("0.1", "USD")).toBe(10);
    expect(parseMoney("19.99", "USD")).toBe(1999);
    expect(parseMoney("₦12,000", "NGN")).toBe(1200000);
    expect(parseMoney("500", "JPY")).toBe(500);
    expect(parseMoney("5.5", "JPY")).toBeNull();
    expect(parseMoney("1.234", "USD")).toBeNull();
    expect(parseMoney("abc", "USD")).toBeNull();
    expect(parseMoney("", "USD")).toBeNull();
    expect(parseMoney(12.3, "USD")).toBe(1230);
  });
  it("formats and round-trips", () => {
    expect(formatMoney(125050, "USD")).toBe("$1,250.50");
    expect(formatMoney(500, "JPY")).toBe("¥500");
    expect(minorToInput(125050, "USD")).toBe("1250.50");
    expect(formatMoney(null, "USD")).toBe("—");
  });
  it("never mixes currencies when summing", () => {
    expect(sumByCurrency([{ amount: 100, currency: "USD" }, { amount: 250, currency: "NGN" }, { amount: 50, currency: "USD" }, { amount: null, currency: "USD" }])).toEqual({ USD: 150, NGN: 250 });
  });
  it("weights by probability in integer minor units", () => {
    expect(weighted(1001, 50)).toBe(501);
    expect(weighted(125050, 25)).toBe(31263);
  });
});
