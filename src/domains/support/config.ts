import "server-only";
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { memberships, organizations, teamMembers, teams } from "@/domains/identity/schema";
import { user } from "@/server/auth/schema";
import { audit } from "@/server/audit/audit";
import type { OrgContext } from "@/server/authz/context";
import type { Tx } from "@/server/db/client";
import { isUniqueViolation } from "@/server/db/errors";
import { withTenant } from "@/server/db/tenant";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { parseInput } from "@/server/validate";
import { newId } from "@/lib/ids";
import { DEFAULT_SCHEDULE, hasWorkingTime } from "./business-time";
import { reapplySlaToOpenTickets } from "./sla";
import {
  businessHours, holidays, portalRoutes, PRIORITIES, slaPolicies, supportPortals, TICKET_CHANNELS, ticketFormVersions, ticketForms, ticketRoutingRules, ticketTypes,
  type FormField,
} from "./schema";
import { ensureSupportDefaults } from "./service";

function need(ctx: OrgContext) {
  if (!ctx.permissions.has("support.configure")) throw new ForbiddenError("You don't have permission to configure support.");
}
export const canConfigureSupport = (ctx: OrgContext) => ctx.permissions.has("support.configure");

const uuid = z.string().uuid();
const minutes = z.coerce.number().int().min(1, "At least 1 minute").max(60 * 24 * 90, "Too long").nullable();

/* ───────── read ───────── */

export async function getSupportSettings(ctx: OrgContext) {
  need(ctx);
  return withTenant(ctx, async (tx) => {
    await ensureSupportDefaults(tx, ctx.orgId);
    const [org] = await tx.select({ timezone: organizations.timezone, slug: organizations.slug, name: organizations.name }).from(organizations).where(eq(organizations.id, ctx.orgId));
    const [hours] = await tx.select().from(businessHours).where(and(eq(businessHours.organizationId, ctx.orgId), eq(businessHours.isDefault, 1)));
    const days = hours ? await tx.select().from(holidays).where(eq(holidays.businessHoursId, hours.id)).orderBy(asc(holidays.date)) : [];
    const policies = await tx.select().from(slaPolicies).where(and(eq(slaPolicies.organizationId, ctx.orgId), isNull(slaPolicies.archivedAt))).orderBy(asc(slaPolicies.position), asc(slaPolicies.createdAt));
    const rules = await tx.select().from(ticketRoutingRules).where(and(eq(ticketRoutingRules.organizationId, ctx.orgId), isNull(ticketRoutingRules.archivedAt))).orderBy(asc(ticketRoutingRules.position), asc(ticketRoutingRules.createdAt));
    const forms = await tx.select().from(ticketForms).where(and(eq(ticketForms.organizationId, ctx.orgId), isNull(ticketForms.archivedAt))).orderBy(asc(ticketForms.position), asc(ticketForms.createdAt));
    const versions = await tx.select({ id: ticketFormVersions.id, formId: ticketFormVersions.formId, version: ticketFormVersions.version, createdAt: ticketFormVersions.createdAt }).from(ticketFormVersions).where(eq(ticketFormVersions.organizationId, ctx.orgId)).orderBy(desc(ticketFormVersions.version));
    const [portal] = await tx.select().from(supportPortals).where(eq(supportPortals.organizationId, ctx.orgId));
    const teamRows = await tx.select({ id: teams.id, name: teams.name }).from(teams).where(eq(teams.organizationId, ctx.orgId)).orderBy(asc(teams.name));
    const teamCounts = await tx.select({ teamId: teamMembers.teamId, n: sql<number>`count(*)::int` }).from(teamMembers).where(eq(teamMembers.organizationId, ctx.orgId)).groupBy(teamMembers.teamId);
    const people = await tx.select({ id: memberships.id, name: user.name }).from(memberships).innerJoin(user, eq(user.id, memberships.userId)).where(and(eq(memberships.organizationId, ctx.orgId), eq(memberships.status, "active"))).orderBy(asc(user.name));
    const types = await tx.select({ id: ticketTypes.id, name: ticketTypes.name }).from(ticketTypes).where(and(eq(ticketTypes.organizationId, ctx.orgId), isNull(ticketTypes.archivedAt))).orderBy(asc(ticketTypes.position));
    return {
      timezone: org.timezone, orgName: org.name, orgSlug: org.slug,
      hours: hours ? { id: hours.id, timezone: hours.timezone, schedule: hours.schedule, configured: true } : { id: null, timezone: org.timezone, schedule: DEFAULT_SCHEDULE as Record<string, [number, number][]>, configured: false },
      holidays: days.map((d) => ({ id: d.id, date: d.date, name: d.name })),
      policies, rules,
      forms: forms.map((f) => ({ ...f, versions: versions.filter((v) => v.formId === f.id) })),
      portal: portal ?? null,
      teams: teamRows.map((t) => ({ ...t, members: teamCounts.find((c) => c.teamId === t.id)?.n ?? 0 })),
      people, types,
    };
  });
}
export type SupportSettings = Awaited<ReturnType<typeof getSupportSettings>>;

/* ───────── business hours ───────── */

const interval = z.tuple([z.number().int().min(0).max(1440), z.number().int().min(0).max(1440)]).refine(([a, b]) => b > a, "End must be after start");
const hoursSchema = z.object({
  timezone: z.string().refine((tz) => { try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; } }, "Choose a valid timezone"),
  schedule: z.partialRecord(z.enum(["0", "1", "2", "3", "4", "5", "6"]), z.array(interval).max(4)).refine(hasWorkingTime, "Add working hours on at least one day"),
});

export async function saveBusinessHours(ctx: OrgContext, input: unknown) {
  need(ctx);
  const data = parseInput(hoursSchema, input);
  for (const list of Object.values(data.schedule)) {
    const sorted = [...list].sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < sorted.length; i++) if (sorted[i][0] < sorted[i - 1][1]) throw new ValidationError("Working periods on the same day can't overlap.", { schedule: ["Periods overlap"] });
  }
  return withTenant(ctx, async (tx) => {
    const [cur] = await tx.select().from(businessHours).where(and(eq(businessHours.organizationId, ctx.orgId), eq(businessHours.isDefault, 1)));
    if (cur) await tx.update(businessHours).set({ timezone: data.timezone, schedule: data.schedule, updatedAt: new Date() }).where(eq(businessHours.id, cur.id));
    else await tx.insert(businessHours).values({ organizationId: ctx.orgId, name: "Business hours", timezone: data.timezone, schedule: data.schedule, isDefault: 1 });
    await audit(tx, ctx, { action: "support.hours_updated", entityType: "business_hours", entityId: cur?.id ?? ctx.orgId, metadata: { timezone: data.timezone } });
    const n = await reapplySlaToOpenTickets(tx, ctx.orgId);
    return { reapplied: n };
  });
}

async function defaultCalendarId(tx: Tx, ctx: OrgContext) {
  const [cur] = await tx.select({ id: businessHours.id }).from(businessHours).where(and(eq(businessHours.organizationId, ctx.orgId), eq(businessHours.isDefault, 1)));
  if (cur) return cur.id;
  const [org] = await tx.select({ tz: organizations.timezone }).from(organizations).where(eq(organizations.id, ctx.orgId));
  const id = newId();
  await tx.insert(businessHours).values({ id, organizationId: ctx.orgId, name: "Business hours", timezone: org.tz, schedule: DEFAULT_SCHEDULE as Record<string, [number, number][]>, isDefault: 1 });
  return id;
}

export async function addHoliday(ctx: OrgContext, input: unknown) {
  need(ctx);
  const data = parseInput(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date"), name: z.string().trim().min(1, "Name the holiday").max(80) }), input);
  return withTenant(ctx, async (tx) => {
    const calId = await defaultCalendarId(tx, ctx);
    try {
      await tx.insert(holidays).values({ organizationId: ctx.orgId, businessHoursId: calId, date: data.date, name: data.name });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ValidationError("That date is already a holiday.", { date: ["Already added"] });
      throw e;
    }
    await audit(tx, ctx, { action: "support.holiday_added", entityType: "business_hours", entityId: calId, metadata: data });
    await reapplySlaToOpenTickets(tx, ctx.orgId);
  });
}

export async function removeHoliday(ctx: OrgContext, id: string) {
  need(ctx);
  return withTenant(ctx, async (tx) => {
    const [h] = await tx.delete(holidays).where(and(eq(holidays.organizationId, ctx.orgId), eq(holidays.id, id))).returning();
    if (!h) throw new NotFoundError("Holiday not found.");
    await audit(tx, ctx, { action: "support.holiday_removed", entityType: "business_hours", entityId: h.businessHoursId, metadata: { date: h.date, name: h.name } });
    await reapplySlaToOpenTickets(tx, ctx.orgId);
  });
}

/* ───────── SLA policies ───────── */

const policySchema = z.object({
  name: z.string().trim().min(1, "Name the policy").max(80),
  isActive: z.boolean().default(true),
  calendar: z.enum(["business", "24x7"]).default("business"),
  escalateOnBreach: z.boolean().default(true),
  conditions: z.object({ priorities: z.array(z.enum(PRIORITIES)).optional(), channels: z.array(z.enum(TICKET_CHANNELS)).optional(), ticketTypeIds: z.array(uuid).optional() }).default({}),
  targets: z.partialRecord(z.enum(PRIORITIES), z.object({ firstResponse: minutes, resolution: minutes })),
}).refine((p) => Object.values(p.targets).some((t) => t && (t.firstResponse || t.resolution)), { message: "Set at least one target", path: ["targets"] })
  .refine((p) => Object.values(p.targets).every((t) => !t || !t.firstResponse || !t.resolution || t.resolution >= t.firstResponse), { message: "Resolution can't be faster than the first reply", path: ["targets"] });

async function assertTypes(tx: Tx, ctx: OrgContext, ids: string[] | undefined) {
  if (!ids?.length) return;
  const rows = await tx.select({ id: ticketTypes.id }).from(ticketTypes).where(and(eq(ticketTypes.organizationId, ctx.orgId), inArray(ticketTypes.id, ids)));
  if (rows.length !== new Set(ids).size) throw new ValidationError("Choose valid ticket types.", { ticketTypeIds: ["Unknown type"] });
}

export async function createSlaPolicy(ctx: OrgContext, input: unknown) {
  need(ctx);
  const data = parseInput(policySchema, input);
  return withTenant(ctx, async (tx) => {
    await assertTypes(tx, ctx, data.conditions.ticketTypeIds);
    const [{ max }] = await tx.select({ max: sql<number>`coalesce(max(${slaPolicies.position}), 0)::int` }).from(slaPolicies).where(eq(slaPolicies.organizationId, ctx.orgId));
    const id = newId();
    await tx.insert(slaPolicies).values({ id, organizationId: ctx.orgId, name: data.name, position: max + 1, isActive: data.isActive ? 1 : 0, calendar: data.calendar, escalateOnBreach: data.escalateOnBreach ? 1 : 0, conditions: data.conditions, targets: data.targets });
    await audit(tx, ctx, { action: "support.sla_created", entityType: "sla_policy", entityId: id, metadata: { name: data.name } });
    await reapplySlaToOpenTickets(tx, ctx.orgId);
    return { id };
  });
}

export async function updateSlaPolicy(ctx: OrgContext, id: string, input: unknown) {
  need(ctx);
  const data = parseInput(policySchema, input);
  return withTenant(ctx, async (tx) => {
    await assertTypes(tx, ctx, data.conditions.ticketTypeIds);
    const [p] = await tx.update(slaPolicies).set({ name: data.name, isActive: data.isActive ? 1 : 0, calendar: data.calendar, escalateOnBreach: data.escalateOnBreach ? 1 : 0, conditions: data.conditions, targets: data.targets, updatedAt: new Date() })
      .where(and(eq(slaPolicies.organizationId, ctx.orgId), eq(slaPolicies.id, id), isNull(slaPolicies.archivedAt))).returning({ id: slaPolicies.id });
    if (!p) throw new NotFoundError("Policy not found.");
    await audit(tx, ctx, { action: "support.sla_updated", entityType: "sla_policy", entityId: id, metadata: { name: data.name } });
    await reapplySlaToOpenTickets(tx, ctx.orgId);
  });
}

export async function archiveSlaPolicy(ctx: OrgContext, id: string) {
  need(ctx);
  return withTenant(ctx, async (tx) => {
    const [p] = await tx.update(slaPolicies).set({ archivedAt: new Date(), isActive: 0 }).where(and(eq(slaPolicies.organizationId, ctx.orgId), eq(slaPolicies.id, id), isNull(slaPolicies.archivedAt))).returning({ name: slaPolicies.name });
    if (!p) throw new NotFoundError("Policy not found.");
    await audit(tx, ctx, { action: "support.sla_archived", entityType: "sla_policy", entityId: id, metadata: p });
    await reapplySlaToOpenTickets(tx, ctx.orgId);
  });
}

async function move(tx: Tx, table: typeof slaPolicies | typeof ticketRoutingRules, orgId: string, id: string, dir: "up" | "down") {
  const rows = await tx.select({ id: table.id }).from(table).where(and(eq(table.organizationId, orgId), isNull(table.archivedAt))).orderBy(asc(table.position), asc(table.createdAt));
  const i = rows.findIndex((r) => r.id === id);
  if (i < 0) throw new NotFoundError("Not found.");
  const j = dir === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= rows.length) return false;
  [rows[i], rows[j]] = [rows[j], rows[i]];
  for (const [pos, r] of rows.entries()) await tx.update(table).set({ position: pos + 1 }).where(eq(table.id, r.id));
  return true;
}

export async function moveSlaPolicy(ctx: OrgContext, id: string, dir: "up" | "down") {
  need(ctx);
  return withTenant(ctx, async (tx) => {
    if (await move(tx, slaPolicies, ctx.orgId, id, dir)) {
      await audit(tx, ctx, { action: "support.sla_reordered", entityType: "sla_policy", entityId: id, metadata: { dir } });
      await reapplySlaToOpenTickets(tx, ctx.orgId);
    }
  });
}

/* ───────── routing rules ───────── */

const ruleSchema = z.object({
  name: z.string().trim().min(1, "Name the rule").max(80),
  isActive: z.boolean().default(true),
  conditions: z.object({
    channels: z.array(z.enum(TICKET_CHANNELS)).optional(),
    priorities: z.array(z.enum(PRIORITIES)).optional(),
    ticketTypeIds: z.array(uuid).optional(),
    formIds: z.array(uuid).optional(),
    keywords: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
    customerTags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  }).default({}),
  actions: z.object({
    teamId: uuid.nullable().optional(),
    assign: z.enum(["none", "member", "round_robin"]).default("none"),
    membershipId: uuid.nullable().optional(),
    priority: z.enum(PRIORITIES).nullable().optional(),
    ticketTypeId: uuid.nullable().optional(),
    addTags: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
  }),
}).refine((r) => r.actions.assign !== "member" || r.actions.membershipId, { message: "Choose who gets these tickets", path: ["actions", "membershipId"] })
  .refine((r) => r.actions.assign !== "round_robin" || r.actions.teamId, { message: "Round robin needs a team", path: ["actions", "teamId"] })
  .refine((r) => r.actions.teamId || r.actions.assign !== "none" || r.actions.priority || r.actions.ticketTypeId || r.actions.addTags?.length, { message: "Choose at least one action", path: ["actions"] });

async function assertRuleRefs(tx: Tx, ctx: OrgContext, d: z.infer<typeof ruleSchema>) {
  await assertTypes(tx, ctx, [...(d.conditions.ticketTypeIds ?? []), ...(d.actions.ticketTypeId ? [d.actions.ticketTypeId] : [])]);
  if (d.actions.teamId) {
    const [t] = await tx.select({ id: teams.id }).from(teams).where(and(eq(teams.organizationId, ctx.orgId), eq(teams.id, d.actions.teamId)));
    if (!t) throw new ValidationError("Choose a valid team.", { teamId: ["Unknown team"] });
  }
  if (d.actions.assign === "member" && d.actions.membershipId) {
    const [m] = await tx.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.organizationId, ctx.orgId), eq(memberships.id, d.actions.membershipId), eq(memberships.status, "active")));
    if (!m) throw new ValidationError("Choose an active team member.", { membershipId: ["Unknown member"] });
  }
  if (d.conditions.formIds?.length) {
    const rows = await tx.select({ id: ticketForms.id }).from(ticketForms).where(and(eq(ticketForms.organizationId, ctx.orgId), inArray(ticketForms.id, d.conditions.formIds)));
    if (rows.length !== new Set(d.conditions.formIds).size) throw new ValidationError("Choose valid forms.", { formIds: ["Unknown form"] });
  }
}

const cleanActions = (a: z.infer<typeof ruleSchema>["actions"]) => ({ ...a, membershipId: a.assign === "member" ? a.membershipId ?? null : null });

export async function createRoutingRule(ctx: OrgContext, input: unknown) {
  need(ctx);
  const data = parseInput(ruleSchema, input);
  return withTenant(ctx, async (tx) => {
    await assertRuleRefs(tx, ctx, data);
    const [{ max }] = await tx.select({ max: sql<number>`coalesce(max(${ticketRoutingRules.position}), 0)::int` }).from(ticketRoutingRules).where(eq(ticketRoutingRules.organizationId, ctx.orgId));
    const id = newId();
    await tx.insert(ticketRoutingRules).values({ id, organizationId: ctx.orgId, name: data.name, position: max + 1, isActive: data.isActive ? 1 : 0, conditions: data.conditions, actions: cleanActions(data.actions) });
    await audit(tx, ctx, { action: "support.rule_created", entityType: "routing_rule", entityId: id, metadata: { name: data.name } });
    return { id };
  });
}

export async function updateRoutingRule(ctx: OrgContext, id: string, input: unknown) {
  need(ctx);
  const data = parseInput(ruleSchema, input);
  return withTenant(ctx, async (tx) => {
    await assertRuleRefs(tx, ctx, data);
    const [r] = await tx.update(ticketRoutingRules).set({ name: data.name, isActive: data.isActive ? 1 : 0, conditions: data.conditions, actions: cleanActions(data.actions), updatedAt: new Date() })
      .where(and(eq(ticketRoutingRules.organizationId, ctx.orgId), eq(ticketRoutingRules.id, id), isNull(ticketRoutingRules.archivedAt))).returning({ id: ticketRoutingRules.id });
    if (!r) throw new NotFoundError("Rule not found.");
    await audit(tx, ctx, { action: "support.rule_updated", entityType: "routing_rule", entityId: id, metadata: { name: data.name } });
  });
}

export async function archiveRoutingRule(ctx: OrgContext, id: string) {
  need(ctx);
  return withTenant(ctx, async (tx) => {
    const [r] = await tx.update(ticketRoutingRules).set({ archivedAt: new Date(), isActive: 0 }).where(and(eq(ticketRoutingRules.organizationId, ctx.orgId), eq(ticketRoutingRules.id, id), isNull(ticketRoutingRules.archivedAt))).returning({ name: ticketRoutingRules.name });
    if (!r) throw new NotFoundError("Rule not found.");
    await audit(tx, ctx, { action: "support.rule_archived", entityType: "routing_rule", entityId: id, metadata: r });
  });
}

export async function moveRoutingRule(ctx: OrgContext, id: string, dir: "up" | "down") {
  need(ctx);
  return withTenant(ctx, async (tx) => {
    if (await move(tx, ticketRoutingRules, ctx.orgId, id, dir)) await audit(tx, ctx, { action: "support.rule_reordered", entityType: "routing_rule", entityId: id, metadata: { dir } });
  });
}

/* ───────── forms ───────── */

const FIELD_TYPES = ["short_text", "long_text", "email", "phone", "number", "select", "multi_select", "checkbox", "date", "order_number"] as const;
const fieldSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, "Use lowercase letters, numbers and underscores"),
  label: z.string().trim().min(1, "Label each field").max(80),
  type: z.enum(FIELD_TYPES),
  required: z.boolean().default(false),
  help: z.string().trim().max(200).optional(),
  options: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
}).refine((f) => !["select", "multi_select"].includes(f.type) || (f.options?.length ?? 0) >= 2, { message: "Add at least two options", path: ["options"] });
const RESERVED = new Set(["name", "email", "subject", "message", "description", "phone", "order"]);

const formSchema = z.object({
  name: z.string().trim().min(1, "Name the form").max(80),
  description: z.string().trim().max(500).nullable().optional(),
  ticketTypeId: uuid.nullable().optional(),
  priority: z.enum(PRIORITIES).default("normal"),
  portalVisible: z.boolean().default(true),
  fields: z.array(fieldSchema).max(25, "Up to 25 fields").default([]),
}).superRefine((f, ctx) => {
  const seen = new Set<string>();
  f.fields.forEach((x, i) => {
    if (RESERVED.has(x.key)) ctx.addIssue({ code: "custom", message: `"${x.key}" is always asked; use another key`, path: ["fields", i, "key"] });
    if (seen.has(x.key)) ctx.addIssue({ code: "custom", message: "Each field needs a unique key", path: ["fields", i, "key"] });
    seen.add(x.key);
  });
});

export async function createTicketForm(ctx: OrgContext, input: unknown) {
  need(ctx);
  const data = parseInput(formSchema, input);
  return withTenant(ctx, async (tx) => {
    await assertTypes(tx, ctx, data.ticketTypeId ? [data.ticketTypeId] : []);
    const id = newId();
    try {
      await tx.insert(ticketForms).values({ id, organizationId: ctx.orgId, name: data.name, description: data.description ?? null, ticketTypeId: data.ticketTypeId ?? null, priority: data.priority, portalVisible: data.portalVisible ? 1 : 0, draftFields: data.fields as FormField[] });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ValidationError("A form with that name already exists.", { name: ["Already exists"] });
      throw e;
    }
    await audit(tx, ctx, { action: "support.form_created", entityType: "ticket_form", entityId: id, metadata: { name: data.name } });
    return { id };
  });
}

/** Saves the draft. Customers keep seeing the last published version until you publish again. */
export async function updateTicketForm(ctx: OrgContext, id: string, input: unknown) {
  need(ctx);
  const data = parseInput(formSchema, input);
  return withTenant(ctx, async (tx) => {
    await assertTypes(tx, ctx, data.ticketTypeId ? [data.ticketTypeId] : []);
    try {
      const [f] = await tx.update(ticketForms).set({ name: data.name, description: data.description ?? null, ticketTypeId: data.ticketTypeId ?? null, priority: data.priority, portalVisible: data.portalVisible ? 1 : 0, draftFields: data.fields as FormField[], updatedAt: new Date() })
        .where(and(eq(ticketForms.organizationId, ctx.orgId), eq(ticketForms.id, id), isNull(ticketForms.archivedAt))).returning({ id: ticketForms.id });
      if (!f) throw new NotFoundError("Form not found.");
    } catch (e) {
      if (isUniqueViolation(e)) throw new ValidationError("A form with that name already exists.", { name: ["Already exists"] });
      throw e;
    }
    await audit(tx, ctx, { action: "support.form_updated", entityType: "ticket_form", entityId: id, metadata: { name: data.name, fields: data.fields.length } });
  });
}

export async function publishTicketForm(ctx: OrgContext, id: string) {
  need(ctx);
  return withTenant(ctx, async (tx) => {
    const [f] = await tx.select().from(ticketForms).where(and(eq(ticketForms.organizationId, ctx.orgId), eq(ticketForms.id, id), isNull(ticketForms.archivedAt))).for("update");
    if (!f) throw new NotFoundError("Form not found.");
    const [last] = await tx.select().from(ticketFormVersions).where(eq(ticketFormVersions.formId, id)).orderBy(desc(ticketFormVersions.version)).limit(1);
    if (last && last.name === f.name && JSON.stringify(last.fields) === JSON.stringify(f.draftFields)) throw new ConflictError("Nothing has changed since the last published version.");
    const versionId = newId();
    const version = (last?.version ?? 0) + 1;
    await tx.insert(ticketFormVersions).values({ id: versionId, organizationId: ctx.orgId, formId: id, version, name: f.name, fields: f.draftFields, publishedByUserId: ctx.userId });
    await tx.update(ticketForms).set({ currentVersionId: versionId, updatedAt: new Date() }).where(eq(ticketForms.id, id));
    await audit(tx, ctx, { action: "support.form_published", entityType: "ticket_form", entityId: id, metadata: { name: f.name, version } });
    return { versionId, version };
  });
}

export async function archiveTicketForm(ctx: OrgContext, id: string) {
  need(ctx);
  return withTenant(ctx, async (tx) => {
    const [f] = await tx.update(ticketForms).set({ archivedAt: new Date() }).where(and(eq(ticketForms.organizationId, ctx.orgId), eq(ticketForms.id, id), isNull(ticketForms.archivedAt))).returning({ name: ticketForms.name });
    if (!f) throw new NotFoundError("Form not found.");
    await audit(tx, ctx, { action: "support.form_archived", entityType: "ticket_form", entityId: id, metadata: f });
  });
}

/* ───────── portal ───────── */

const RESERVED_SLUGS = new Set(["admin", "api", "app", "portal", "support", "help", "login", "sign-in", "signup", "salesgel", "www"]);
const portalSchema = z.object({
  enabled: z.boolean(),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/, "3–40 lowercase letters, numbers or dashes").refine((s) => !RESERVED_SLUGS.has(s), "That address is reserved"),
  title: z.string().trim().min(1, "Give the portal a title").max(80),
  welcome: z.string().trim().max(1000).nullable().optional(),
});

export async function savePortal(ctx: OrgContext, input: unknown) {
  need(ctx);
  const data = parseInput(portalSchema, input);
  return withTenant(ctx, async (tx) => {
    // The slug index is global (it routes public URLs), so check it before claiming.
    const [taken] = await tx.select().from(portalRoutes).where(and(eq(portalRoutes.slug, data.slug), ne(portalRoutes.organizationId, ctx.orgId)));
    if (taken) throw new ValidationError("That portal address is taken.", { slug: ["Already taken"] });
    const [cur] = await tx.select().from(supportPortals).where(eq(supportPortals.organizationId, ctx.orgId));
    const values = { slug: data.slug, enabled: data.enabled ? 1 : 0, title: data.title, welcome: data.welcome ?? null, updatedAt: new Date() };
    if (cur) await tx.update(supportPortals).set(values).where(eq(supportPortals.organizationId, ctx.orgId));
    else await tx.insert(supportPortals).values({ organizationId: ctx.orgId, ...values });
    try {
      await tx.delete(portalRoutes).where(eq(portalRoutes.organizationId, ctx.orgId));
      await tx.insert(portalRoutes).values({ slug: data.slug, organizationId: ctx.orgId });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ValidationError("That portal address is taken.", { slug: ["Already taken"] });
      throw e;
    }
    await audit(tx, ctx, { action: data.enabled ? "support.portal_enabled" : "support.portal_updated", entityType: "support_portal", entityId: ctx.orgId, metadata: { slug: data.slug, enabled: data.enabled } });
    return { slug: data.slug };
  });
}
