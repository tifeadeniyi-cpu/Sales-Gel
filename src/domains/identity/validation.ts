import { z } from "zod";
import { ALL_PERMISSIONS } from "@/server/authz/catalog";

export const CURRENCIES = ["USD", "CAD", "GBP", "EUR", "NGN", "GHS", "KES", "ZAR", "AUD"] as const;

export const BUSINESS_TYPES = [
  "online_store",
  "social_seller",
  "retail",
  "wholesale",
  "dtc_brand",
  "services",
  "other",
] as const;

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "At least 3 characters")
  .max(48, "At most 48 characters")
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])$/, "Lowercase letters, numbers and dashes; can't start or end with a dash");

const timezoneSchema = z
  .string()
  .refine((tz) => Intl.supportedValuesOf("timeZone").includes(tz) || tz === "UTC", "Choose a valid timezone");

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(2, "Enter your business name").max(120),
  slug: slugSchema,
  businessType: z.enum(BUSINESS_TYPES).optional(),
  timezone: timezoneSchema.default("UTC"),
  defaultCurrency: z.enum(CURRENCIES).default("USD"),
});
export type CreateOrganizationInput = z.input<typeof createOrganizationSchema>;

export const updateOrganizationSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  businessType: z.enum(BUSINESS_TYPES).nullable().optional(),
  timezone: timezoneSchema.optional(),
  defaultCurrency: z.enum(CURRENCIES).optional(),
  address: z.string().trim().max(500).nullable().optional(),
});
export type UpdateOrganizationInput = z.input<typeof updateOrganizationSchema>;

export const inviteMemberSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email")),
  roleId: z.uuid("Choose a role"),
});

export const changeRoleSchema = z.object({
  membershipId: z.uuid(),
  roleId: z.uuid(),
});

export const roleSchema = z.object({
  name: z.string().trim().min(2, "Enter a role name").max(60),
  description: z.string().trim().max(240).optional(),
  permissions: z.array(z.enum(ALL_PERMISSIONS as [string, ...string[]])).max(ALL_PERMISSIONS.length),
});

export const teamSchema = z.object({
  name: z.string().trim().min(2, "Enter a team name").max(80),
  description: z.string().trim().max(240).optional(),
});

export function suggestSlug(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return base.length >= 3 ? base : `${base || "org"}-${Math.random().toString(36).slice(2, 6)}`;
}
