import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** E.164 when parseable (defaulting to the given country for national numbers), else digits with a leading +. */
export function normalizePhone(phone: string, defaultCountry: CountryCode = "US"): string | null {
  const trimmed = phone.trim();
  if (!trimmed) return null;
  const parsed = parsePhoneNumberFromString(trimmed, defaultCountry);
  if (parsed && (parsed.isValid() || parsed.isPossible())) return parsed.number;
  const digits = trimmed.replace(/[^\d]/g, "");
  if (digits.length < 6) return null;
  return `+${digits}`;
}

/** Social handles compare case-insensitively without a leading @ or profile URL. */
export function normalizeHandle(handle: string): string {
  return handle
    .trim()
    .replace(/^https?:\/\/(www\.)?[^/]+\//i, "")
    .replace(/^@/, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

export function deriveDisplayName(c: {
  type?: string;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  email?: string | null;
  phone?: string | null;
  handle?: string | null;
}): string {
  const person = [c.firstName, c.lastName].map((s) => s?.trim()).filter(Boolean).join(" ");
  if (c.type === "business" && c.companyName?.trim()) return c.companyName.trim();
  return person || c.companyName?.trim() || c.email?.trim() || c.phone?.trim() || (c.handle ? `@${normalizeHandle(c.handle)}` : "") || "Unnamed customer";
}

export function formatCustomerNumber(n: number): string {
  return `CUS-${n}`;
}
