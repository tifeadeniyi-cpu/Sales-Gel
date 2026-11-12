import { z } from "zod";
import { MESSAGE_KINDS, PRIORITIES, STATUS_CATEGORIES, TICKET_CHANNELS } from "./schema";

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));
const uuid = z.uuid("Invalid id");
const optUuid = z
  .union([uuid, z.literal(""), z.null()])
  .optional()
  .transform((v) => (v ? v : null));

export const PRIORITY_LABELS: Record<(typeof PRIORITIES)[number], string> = { low: "Low", normal: "Normal", high: "High", urgent: "Urgent" };
export const CHANNEL_LABELS: Record<(typeof TICKET_CHANNELS)[number], string> = {
  manual: "Created by staff", phone: "Phone call", email: "Email", whatsapp: "WhatsApp", instagram: "Instagram", facebook: "Facebook",
  tiktok: "TikTok", sms: "SMS", in_person: "In person", web_form: "Web form", portal: "Customer portal",
};
export const CATEGORY_LABELS: Record<(typeof STATUS_CATEGORIES)[number], string> = {
  new: "New", open: "Open", pending_customer: "Waiting on customer", pending_internal: "Waiting on team", escalated: "Escalated", resolved: "Resolved", closed: "Closed",
};
export const RESOLUTION_CATEGORIES = ["answered", "replacement_sent", "refund_issued", "order_corrected", "delivered", "no_action_needed", "duplicate", "other"] as const;
export const RESOLUTION_LABELS: Record<(typeof RESOLUTION_CATEGORIES)[number], string> = {
  answered: "Question answered", replacement_sent: "Replacement sent", refund_issued: "Refund issued", order_corrected: "Order corrected",
  delivered: "Delivery completed", no_action_needed: "No action needed", duplicate: "Duplicate ticket", other: "Other",
};

const tags = z
  .array(z.string().trim().min(1).max(40))
  .max(20)
  .optional()
  .transform((t) => [...new Map((t ?? []).map((x) => [x.toLowerCase(), x])).values()]);

export const ticketInputSchema = z.object({
  subject: z.string().trim().min(1, "Enter a subject").max(200, "Keep the subject under 200 characters"),
  description: optText(20000),
  customerId: optUuid,
  channel: z.enum(TICKET_CHANNELS).default("manual"),
  ticketTypeId: optUuid,
  priority: z.enum(PRIORITIES).default("normal"),
  assigneeMembershipId: optUuid,
  teamId: optUuid,
  tags,
  contactEmail: z
    .union([z.string().trim().pipe(z.email("Enter a valid email")), z.literal(""), z.null()])
    .optional()
    .transform((v) => (v ? v.toLowerCase() : null)),
  contactPhone: optText(40),
  orderId: optUuid,
  leadId: optUuid,
});
export type TicketInput = z.input<typeof ticketInputSchema>;

export const ticketUpdateSchema = ticketInputSchema.pick({ subject: true, customerId: true, ticketTypeId: true, priority: true, teamId: true, tags: true, contactEmail: true, contactPhone: true }).partial();

export const messageInputSchema = z.object({
  kind: z.enum(MESSAGE_KINDS),
  body: z.string().trim().min(1, "Write a message").max(20000, "Message is too long"),
  channel: z.enum(TICKET_CHANNELS).nullish(),
});

export const statusChangeSchema = z.object({
  statusId: uuid,
  resolutionCategory: z.enum(RESOLUTION_CATEGORIES).nullish(),
  resolutionNote: optText(2000),
});

export const statusInputSchema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(40),
  category: z.enum(STATUS_CATEGORIES),
  color: z.string().regex(/^#[0-9a-f]{6}$/i, "Pick a color").default("#64748b"),
});
export const typeInputSchema = z.object({ name: z.string().trim().min(1, "Enter a name").max(60) });

export const TICKET_VIEWS = ["mine", "unassigned", "open", "waiting", "escalated", "resolved", "closed", "all"] as const;
export const VIEW_LABELS: Record<(typeof TICKET_VIEWS)[number], string> = {
  mine: "My open", unassigned: "Unassigned", open: "All open", waiting: "Waiting", escalated: "Escalated", resolved: "Resolved", closed: "Closed", all: "All tickets",
};
export const ticketFiltersSchema = z.object({
  view: z.enum(TICKET_VIEWS).catch("open"),
  q: z.string().trim().max(120).optional().transform((v) => v || undefined),
  priority: z.enum(PRIORITIES).optional().catch(undefined),
  assignee: z.union([uuid, z.literal("none")]).optional().catch(undefined),
  type: uuid.optional().catch(undefined),
  customer: uuid.optional().catch(undefined),
  order: uuid.optional().catch(undefined),
  sort: z.enum(["activity", "newest", "oldest", "priority"]).catch("activity"),
  page: z.coerce.number().int().min(1).max(10000).catch(1),
  pageSize: z.coerce.number().int().refine((n) => [25, 50, 100].includes(n)).catch(25),
});
export type TicketFilters = Partial<z.input<typeof ticketFiltersSchema>>;

/** Per message, all files combined (Vercel request body limit is 4.5 MB). */
export const ATTACHMENT_MAX_BYTES = 4 * 1024 * 1024;
export const ATTACHMENT_MAX_FILES = 5;
export const ATTACHMENT_MIME = [
  "image/png", "image/jpeg", "image/gif", "image/webp", "image/heic",
  "application/pdf", "text/plain", "text/csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "audio/mpeg", "audio/mp4", "video/mp4", "video/quicktime",
] as const;
