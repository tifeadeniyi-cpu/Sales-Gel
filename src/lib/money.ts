/**
 * Money helpers. Amounts are integer minor units (cents, kobo…) plus an ISO 4217 code.
 * All arithmetic stays in integers; never add amounts in different currencies.
 */
const ZERO_DECIMAL = new Set(["JPY", "KRW", "VND", "CLP", "ISK", "UGX", "XAF", "XOF", "RWF"]);

export function currencyExponent(currency: string): number {
  return ZERO_DECIMAL.has(currency.toUpperCase()) ? 0 : 2;
}

/** Parses user input like "1,250.50" or "₦12 000" into minor units. Returns null if invalid. */
export function parseMoney(input: string | number | null | undefined, currency: string): number | null {
  if (input === null || input === undefined || input === "") return null;
  const exp = currencyExponent(currency);
  const s = typeof input === "number" ? input.toFixed(exp) : input.replace(/[^\d.\-]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const [whole, frac = ""] = s.replace("-", "").split(".");
  if (frac.length > exp) return null;
  const minor = Number(whole) * 10 ** exp + Number((frac + "0".repeat(exp)).slice(0, exp) || 0);
  if (!Number.isSafeInteger(minor)) return null;
  return s.startsWith("-") ? -minor : minor;
}

export function formatMoney(minor: number | null | undefined, currency: string, locale = "en-US"): string {
  if (minor === null || minor === undefined) return "—";
  const exp = currencyExponent(currency);
  return new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: exp, maximumFractionDigits: exp }).format(minor / 10 ** exp);
}

/** Input-friendly representation ("1250.50") of minor units. */
export function minorToInput(minor: number | null | undefined, currency: string): string {
  if (minor === null || minor === undefined) return "";
  const exp = currencyExponent(currency);
  return (minor / 10 ** exp).toFixed(exp);
}

/** Sums amounts grouped by currency — never mixes currencies. */
export function sumByCurrency(items: { amount: number | null; currency: string }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of items) if (i.amount !== null) out[i.currency] = (out[i.currency] ?? 0) + i.amount;
  return out;
}

/** Probability-weighted amount, rounded half away from zero in minor units. */
export function weighted(minor: number, probabilityPct: number): number {
  return Math.round((minor * probabilityPct) / 100);
}
