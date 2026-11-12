import { z } from "zod";
import { CUSTOMER_SOURCES } from "@/domains/customers/validation";

export const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export const STAGE_CATEGORIES = ["open", "won", "lost"] as const;
export const STAGE_COLORS = ["teal", "blue", "gold", "purple", "gray", "green", "red"] as const;

/** Lead fields a stage can require before a lead may enter it. */
export const REQUIRABLE_FIELDS = {
  customerId: "Customer",
  valueAmount: "Estimated value",
  ownerMembershipId: "Assigned representative",
  expectedCloseDate: "Expected close date",
  source: "Source",
} as const;
export type RequirableField = keyof typeof REQUIRABLE_FIELDS;

export const DEFAULT_STAGES: { name: string; probability: number; category: (typeof STAGE_CATEGORIES)[number]; color: (typeof STAGE_COLORS)[number] }[] = [
  { name: "New Inquiry", probability: 10, category: "open", color: "gray" },
  { name: "Contacted", probability: 20, category: "open", color: "blue" },
  { name: "Qualified", probability: 40, category: "open", color: "teal" },
  { name: "Offer Sent", probability: 60, category: "open", color: "purple" },
  { name: "Negotiating", probability: 80, category: "open", color: "gold" },
  { name: "Won", probability: 100, category: "won", color: "green" },
  { name: "Lost", probability: 0, category: "lost", color: "red" },
];

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

export const leadInputSchema = z.object({
  title: z.string().trim().min(2, "Give the lead a short title").max(160),
  customerId: z.uuid().nullish(),
  pipelineId: z.uuid().optional(),
  stageId: z.uuid().optional(),
  value: z.union([z.string(), z.number()]).nullish(),
  currency: z.string().regex(/^[A-Z]{3}$/, "Use a 3-letter currency code").optional(),
  source: z.enum(CUSTOMER_SOURCES).nullish(),
  probability: z.coerce.number().int().min(0).max(100).nullish(),
  priority: z.enum(PRIORITIES).default("medium"),
  ownerMembershipId: z.uuid().nullish(),
  expectedCloseDate: z.iso.date("Use a valid date").nullish().or(z.literal("").transform(() => null)),
  notes: optText(10_000),
  products: z.array(z.object({ name: z.string().trim().min(1).max(160), quantity: z.coerce.number().int().min(1).max(100_000).default(1) })).max(50).default([]),
});
export type LeadInput = z.input<typeof leadInputSchema>;

export const LEAD_INLINE_FIELDS = ["title", "customerId", "value", "currency", "source", "probability", "priority", "ownerMembershipId", "expectedCloseDate", "notes"] as const;
export type LeadInlineField = (typeof LEAD_INLINE_FIELDS)[number];

export const leadFiltersSchema = z.object({
  pipeline: z.uuid().optional(),
  status: z.enum(["open", "won", "lost", "all"]).default("open"),
  owner: z.string().optional(),
  q: z.string().trim().max(120).optional(),
  customer: z.uuid().optional(),
  priority: z.enum(PRIORITIES).optional(),
  stage: z.uuid().optional(),
  /** Created-at window (ISO timestamps), used by dashboard drill-downs. */
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
});
export type LeadFilters = z.input<typeof leadFiltersSchema>;

export const stageInputSchema = z.object({
  name: z.string().trim().min(1, "Name the stage").max(60),
  color: z.enum(STAGE_COLORS).default("teal"),
  probability: z.coerce.number().int().min(0, "0–100").max(100, "0–100"),
  category: z.enum(STAGE_CATEGORIES).default("open"),
  requiredFields: z.array(z.enum(Object.keys(REQUIRABLE_FIELDS) as [RequirableField, ...RequirableField[]])).default([]),
});

export const pipelineNameSchema = z.object({ name: z.string().trim().min(2, "Name the pipeline").max(80) });

export const lostReasonSchema = z.object({ reason: z.string().trim().min(2, "Say why the lead was lost").max(500) });
