import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/max";

/** Short codes for emergency services in common markets. The softphone never places these. */
const EMERGENCY = new Set(["911", "112", "999", "000", "110", "119", "933", "100", "101", "102", "199", "08", "122", "190", "193"]);

export type DestinationCheck = { ok: true; e164: string; country: string } | { ok: false; reason: string };

/**
 * Validates an outbound destination before any call is placed: emergency numbers are refused (no
 * E911 from the browser), premium-rate and shared-cost numbers are blocked when configured, and the
 * country must be on the workspace's allow-list.
 */
export function checkDestination(raw: string, s: { allowedCountries: string[]; blockPremium: boolean }, defaultCountry: CountryCode = "US"): DestinationCheck {
  const digits = raw.replace(/[^\d+]/g, "");
  if (EMERGENCY.has(digits.replace(/^\+/, ""))) return { ok: false, reason: "Emergency numbers can't be called from SalesGel. Use a regular phone to call emergency services." };
  const p = parsePhoneNumberFromString(raw.trim(), defaultCountry);
  if (!p || !p.isValid()) return { ok: false, reason: "That doesn't look like a valid phone number." };
  const country = p.country ?? "";
  const type = p.getType();
  if (s.blockPremium && (type === "PREMIUM_RATE" || type === "SHARED_COST" || type === "UAN" || type === "VOICEMAIL")) {
    return { ok: false, reason: "Premium-rate and shared-cost numbers are blocked by your phone settings." };
  }
  if (!s.allowedCountries.includes(country)) return { ok: false, reason: `Calls to ${country || "this country"} aren't allowed by your phone settings.` };
  return { ok: true, e164: p.number, country };
}
