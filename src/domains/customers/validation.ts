import { z } from "zod";

export const CUSTOMER_TYPES = ["person", "business"] as const;
export const CUSTOMER_SOURCES = [
  "website",
  "instagram",
  "facebook",
  "whatsapp",
  "tiktok",
  "marketplace",
  "phone",
  "in_person",
  "referral",
  "import",
  "other",
] as const;
export const CHANNELS = ["email", "phone", "whatsapp", "instagram", "facebook", "sms"] as const;
export const IDENTITY_PROVIDERS = ["instagram", "facebook", "whatsapp", "tiktok", "x", "other"] as const;

export const SOURCE_LABELS: Record<(typeof CUSTOMER_SOURCES)[number], string> = {
  website: "Website",
  instagram: "Instagram",
  facebook: "Facebook",
  whatsapp: "WhatsApp",
  tiktok: "TikTok",
  marketplace: "Marketplace",
  phone: "Phone",
  in_person: "In person",
  referral: "Referral",
  import: "Import",
  other: "Other",
};

const optText = (max = 200) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

export const emailEntry = z.object({
  email: z.string().trim().pipe(z.email("Enter a valid email")),
  label: optText(40),
  isPrimary: z.boolean().optional(),
});

export const phoneEntry = z.object({
  phone: z.string().trim().min(6, "Enter a valid phone number").max(40),
  label: optText(40),
  isPrimary: z.boolean().optional(),
});

export const identityEntry = z.object({
  provider: z.enum(IDENTITY_PROVIDERS),
  handle: z.string().trim().min(1, "Enter a handle").max(120),
});

export const addressEntry = z.object({
  kind: z.enum(["billing", "shipping"]),
  label: optText(40),
  line1: z.string().trim().min(1, "Enter the street address").max(200),
  line2: optText(200),
  city: optText(100),
  region: optText(100),
  postalCode: optText(20),
  country: optText(60),
  isDefault: z.boolean().optional(),
});

export const customerInputSchema = z
  .object({
    type: z.enum(CUSTOMER_TYPES).default("person"),
    firstName: optText(80),
    lastName: optText(80),
    companyName: optText(160),
    source: z.enum(CUSTOMER_SOURCES).optional().nullable(),
    ownerMembershipId: z.uuid().optional().nullable(),
    preferredChannel: z.enum(CHANNELS).optional().nullable(),
    preferredCurrency: z
      .string()
      .regex(/^[A-Z]{3}$/, "Use a 3-letter currency code")
      .optional()
      .nullable(),
    provisional: z.boolean().optional(),
    emails: z.array(emailEntry).max(10).default([]),
    phones: z.array(phoneEntry).max(10).default([]),
    identities: z.array(identityEntry).max(10).default([]),
    addresses: z.array(addressEntry).max(10).default([]),
    tagNames: z.array(z.string().trim().min(1).max(40)).max(30).default([]),
    customFields: z.record(z.string(), z.unknown()).default({}),
  })
  .superRefine((v, ctx) => {
    const hasAny =
      v.firstName || v.lastName || v.companyName || v.emails.length || v.phones.length || v.identities.length;
    if (!hasAny) {
      ctx.addIssue({
        code: "custom",
        path: ["firstName"],
        message: "Add at least a name, company, email, phone or social handle",
      });
    }
    if (v.type === "business" && !v.companyName) {
      ctx.addIssue({ code: "custom", path: ["companyName"], message: "Business customers need a company name" });
    }
  });
export type CustomerInput = z.input<typeof customerInputSchema>;

/** Fields editable inline from lists, cards and the detail sidebar. */
export const INLINE_FIELDS = [
  "firstName",
  "lastName",
  "companyName",
  "type",
  "source",
  "ownerMembershipId",
  "preferredChannel",
  "preferredCurrency",
  "status",
] as const;
export type InlineField = (typeof INLINE_FIELDS)[number];

export const inlineValueSchemas: Record<InlineField, z.ZodType> = {
  firstName: optText(80),
  lastName: optText(80),
  companyName: optText(160),
  type: z.enum(CUSTOMER_TYPES),
  source: z.enum(CUSTOMER_SOURCES).nullable(),
  ownerMembershipId: z.uuid().nullable(),
  preferredChannel: z.enum(CHANNELS).nullable(),
  preferredCurrency: z.string().regex(/^[A-Z]{3}$/, "Use a 3-letter currency code").nullable(),
  status: z.enum(["provisional", "active"]),
};

export const SORTS = ["created_desc", "created_asc", "name_asc", "name_desc", "updated_desc", "activity_desc"] as const;
export type CustomerSort = (typeof SORTS)[number];

export const listFiltersSchema = z.object({
  q: z.string().trim().max(120).optional(),
  view: z.enum(["active", "provisional", "archived", "all"]).default("active"),
  owner: z.string().optional(),
  tag: z.uuid().optional(),
  source: z.enum(CUSTOMER_SOURCES).optional(),
  type: z.enum(CUSTOMER_TYPES).optional(),
  marketing: z.enum(["subscribed", "unsubscribed", "unknown"]).optional(),
  sort: z.enum(SORTS).default("created_desc"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().refine((n) => [25, 50, 100].includes(n)).default(25),
});
export type CustomerListFilters = z.input<typeof listFiltersSchema>;

export const noteSchema = z.object({ body: z.string().trim().min(1, "Write a note").max(10_000) });

export const consentSchema = z.object({
  channel: z.enum(["email", "sms", "whatsapp"]),
  status: z.enum(["granted", "revoked"]),
  source: z.string().trim().min(2, "Say how consent was captured").max(120),
  note: optText(500),
});

export const tagSchema = z.object({
  name: z.string().trim().min(1, "Enter a tag name").max(40),
  color: z.enum(["teal", "gold", "blue", "green", "red", "gray", "purple"]).default("teal"),
});

export const CUSTOM_FIELD_TYPES = ["text", "number", "date", "select", "boolean"] as const;
export const customFieldSchema = z
  .object({
    label: z.string().trim().min(1, "Enter a label").max(60),
    key: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_]{0,39}$/, "Lowercase letters, numbers and underscores; start with a letter"),
    type: z.enum(CUSTOM_FIELD_TYPES),
    options: z.array(z.string().trim().min(1).max(60)).max(50).optional(),
    required: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    if (v.type === "select" && !v.options?.length) {
      ctx.addIssue({ code: "custom", path: ["options"], message: "Add at least one option" });
    }
  });

export function slugifyKey(label: string): string {
  const k = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
  return /^[a-z]/.test(k) ? k : `f_${k}`.slice(0, 40);
}
