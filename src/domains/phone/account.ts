import "server-only";
import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { memberships, organizations } from "@/domains/identity/schema";
import { integrationRoutes } from "@/domains/integrations/schema";
import { user } from "@/server/auth/schema";
import { audit } from "@/server/audit/audit";
import type { OrgContext } from "@/server/authz/context";
import { appUrl } from "@/server/app-url";
import { decryptJson, encryptionConfigured, encryptJson } from "@/server/crypto";
import type { Tx } from "@/server/db/client";
import { isUniqueViolation } from "@/server/db/errors";
import { withTenant } from "@/server/db/tenant";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { parseInput } from "@/server/validate";
import { newId } from "@/lib/ids";
import {
  AGENT_STATUSES, DEFAULT_PHONE_SETTINGS, phoneAgents, phoneNumbers, phoneQueueMembers, phoneQueues, telecomAccounts, type AgentStatus, type NumberRouting, type PhoneSettings,
} from "./schema";
import { buyNumber as twBuy, createApiKey, createSubaccount, createTwimlApp, platformCredentials, releaseNumber as twRelease, searchLocalNumbers, TwilioError } from "./twilio";

export const ROUTE_TELEPHONY = "telephony";
export interface AccountCreds { authToken: string; apiKeySid: string; apiKeySecret: string; appSid: string }
type Account = typeof telecomAccounts.$inferSelect;

export const canManagePhone = (ctx: OrgContext) => ctx.permissions.has("phone.manage");
function needManage(ctx: OrgContext) {
  if (!canManagePhone(ctx)) throw new ForbiddenError("Only phone admins can do that.");
}
export const voiceUrls = (accountId: string) => {
  const base = `${appUrl()}/api/telephony/${accountId}`;
  return { base, voice: `${base}/voice`, status: `${base}/status` };
};
/** Twilio client identity for a member (letters/digits only). */
export const identityFor = (membershipId: string) => `m${membershipId.replace(/-/g, "")}`;
export function membershipFromIdentity(identity: string) {
  const m = /^m([0-9a-f]{32})$/i.exec(identity);
  if (!m) return null;
  const h = m[1].toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
export const subAuth = (a: Pick<Account, "providerAccountSid" | "credentials">) => ({ sid: a.providerAccountSid, token: decryptJson<AccountCreds>(a.credentials).authToken });
export const credsOf = (a: Pick<Account, "credentials">) => decryptJson<AccountCreds>(a.credentials);

export async function activeAccount(tx: Tx, orgId: string) {
  const [a] = await tx.select().from(telecomAccounts).where(and(eq(telecomAccounts.organizationId, orgId), ne(telecomAccounts.status, "closed")));
  return a ?? null;
}

const wrap = async <T>(fn: () => Promise<T>) => {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof TwilioError) throw new ConflictError(`Twilio: ${e.message}`);
    throw e;
  }
};

/* ───────── enabling ───────── */

/** Creates the workspace's Twilio subaccount, an API key for browser tokens, and the TwiML app for outbound calls. */
export async function enablePhone(ctx: OrgContext) {
  needManage(ctx);
  const platform = platformCredentials();
  if (!platform) throw new ConflictError("Phone isn't configured on this server yet (missing Twilio platform credentials).");
  if (!encryptionConfigured()) throw new ConflictError("Phone can't be enabled on this server yet (missing encryption key).");
  const existing = await withTenant(ctx, (tx) => activeAccount(tx, ctx.orgId));
  if (existing) throw new ConflictError("Phone is already enabled for this workspace.");
  const id = newId();
  const urls = voiceUrls(id);
  const sub = await wrap(() => createSubaccount(platform, `SalesGel · ${ctx.orgName} · ${ctx.orgId.slice(0, 8)}`));
  const subAuthPair = { sid: sub.sid, token: sub.auth_token };
  const key = await wrap(() => createApiKey(subAuthPair, "SalesGel softphone"));
  const app = await wrap(() => createTwimlApp(subAuthPair, "SalesGel outbound", urls.voice, urls.status));
  return withTenant(ctx, async (tx) => {
    const creds: AccountCreds = { authToken: sub.auth_token, apiKeySid: key.sid, apiKeySecret: key.secret, appSid: app.sid };
    await tx.insert(telecomAccounts).values({ id, organizationId: ctx.orgId, providerAccountSid: sub.sid, credentials: encryptJson(creds), settings: DEFAULT_PHONE_SETTINGS, createdByUserId: ctx.userId });
    await tx.insert(integrationRoutes).values({ provider: ROUTE_TELEPHONY, externalAccountId: id, connectionId: id, organizationId: ctx.orgId });
    await audit(tx, ctx, { action: "phone.enabled", entityType: "telecom_account", entityId: id, metadata: { provider: "twilio", subaccount: sub.sid } });
    return { id };
  });
}

const settingsSchema = z.object({
  allowedCountries: z.array(z.string().regex(/^[A-Z]{2}$/)).min(1, "Allow at least one country").max(50),
  blockPremium: z.boolean(),
  dailySpendLimitCents: z.coerce.number().int().min(100, "At least $1").max(1_000_000).nullable(),
  ringTimeoutSec: z.coerce.number().int().min(5).max(60),
  voicemailGreeting: z.string().trim().min(5, "Write a short greeting").max(500),
  afterHours: z.enum(["voicemail", "ring"]),
  useBusinessHours: z.boolean(),
});

export async function updatePhoneSettings(ctx: OrgContext, input: unknown) {
  needManage(ctx);
  const d = parseInput(settingsSchema, input) as PhoneSettings;
  return withTenant(ctx, async (tx) => {
    const a = await activeAccount(tx, ctx.orgId);
    if (!a) throw new ConflictError("Enable phone first.");
    await tx.update(telecomAccounts).set({ settings: d, updatedAt: new Date() }).where(eq(telecomAccounts.id, a.id));
    await audit(tx, ctx, { action: "phone.settings_updated", entityType: "telecom_account", entityId: a.id, changes: { allowedCountries: { from: a.settings.allowedCountries, to: d.allowedCountries }, dailySpendLimitCents: { from: a.settings.dailySpendLimitCents, to: d.dailySpendLimitCents } } });
  });
}

/* ───────── numbers ───────── */

export async function searchNumbers(ctx: OrgContext, input: unknown) {
  needManage(ctx);
  const q = parseInput(z.object({ areaCode: z.string().trim().regex(/^\d{3}$/, "Use a 3-digit area code").optional().or(z.literal("").transform(() => undefined)), contains: z.string().trim().regex(/^[\d*]{0,10}$/).optional().or(z.literal("").transform(() => undefined)) }), input);
  const a = await withTenant(ctx, (tx) => activeAccount(tx, ctx.orgId));
  if (!a) throw new ConflictError("Enable phone first.");
  const list = await wrap(() => searchLocalNumbers(subAuth(a), { ...q, country: "US" }));
  return list.map((n) => ({ e164: n.phone_number, display: n.friendly_name, locality: n.locality, region: n.region, voice: n.capabilities.voice, sms: n.capabilities.SMS }));
}

/** Buys a number on the workspace's subaccount (this costs money on the Twilio account). */
export async function purchaseNumber(ctx: OrgContext, input: unknown) {
  needManage(ctx);
  const d = parseInput(z.object({ e164: z.string().regex(/^\+1\d{10}$/, "US numbers only for now"), label: z.string().trim().max(60).optional() }), input);
  const a = await withTenant(ctx, (tx) => activeAccount(tx, ctx.orgId));
  if (!a || a.status !== "active") throw new ConflictError("Phone isn't active for this workspace.");
  const urls = voiceUrls(a.id);
  const n = await wrap(() => twBuy(subAuth(a), d.e164, urls.voice, urls.status));
  return withTenant(ctx, async (tx) => {
    const id = newId();
    try {
      await tx.insert(phoneNumbers).values({ id, organizationId: ctx.orgId, accountId: a.id, providerSid: n.sid, e164: n.phone_number, label: d.label || null, capabilities: { voice: !!n.capabilities.voice, sms: !!n.capabilities.sms, mms: !!n.capabilities.mms }, createdByUserId: ctx.userId });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictError("That number is already in use.");
      throw e;
    }
    await audit(tx, ctx, { action: "phone.number_purchased", entityType: "phone_number", entityId: id, metadata: { e164: n.phone_number } });
    return { id, e164: n.phone_number };
  });
}

export async function releasePhoneNumber(ctx: OrgContext, id: string) {
  needManage(ctx);
  const [a, num] = await withTenant(ctx, async (tx) => {
    const [n] = await tx.select().from(phoneNumbers).where(and(eq(phoneNumbers.organizationId, ctx.orgId), eq(phoneNumbers.id, id), eq(phoneNumbers.status, "active")));
    if (!n) throw new NotFoundError("Number not found.");
    return [await activeAccount(tx, ctx.orgId), n] as const;
  });
  if (!a) throw new ConflictError("Phone isn't enabled.");
  await wrap(() => twRelease(subAuth(a), num.providerSid));
  return withTenant(ctx, async (tx) => {
    await tx.update(phoneNumbers).set({ status: "released", releasedAt: new Date(), updatedAt: new Date() }).where(eq(phoneNumbers.id, id));
    await audit(tx, ctx, { action: "phone.number_released", entityType: "phone_number", entityId: id, metadata: { e164: num.e164 } });
  });
}

const routingSchema = z.object({
  label: z.string().trim().max(60).optional().nullable(),
  routing: z.discriminatedUnion("type", [
    z.object({ type: z.literal("voicemail") }),
    z.object({ type: z.literal("agent"), membershipId: z.string().uuid() }),
    z.object({ type: z.literal("queue"), queueId: z.string().uuid() }),
  ]),
});

export async function updateNumber(ctx: OrgContext, id: string, input: unknown) {
  needManage(ctx);
  const d = parseInput(routingSchema, input);
  return withTenant(ctx, async (tx) => {
    if (d.routing.type === "agent") {
      const [m] = await tx.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.organizationId, ctx.orgId), eq(memberships.id, d.routing.membershipId), eq(memberships.status, "active")));
      if (!m) throw new ValidationError("Choose an active team member.", { membershipId: ["Unknown member"] });
    }
    if (d.routing.type === "queue") {
      const [q] = await tx.select({ id: phoneQueues.id }).from(phoneQueues).where(and(eq(phoneQueues.organizationId, ctx.orgId), eq(phoneQueues.id, d.routing.queueId), isNull(phoneQueues.archivedAt)));
      if (!q) throw new ValidationError("Choose a queue.", { queueId: ["Unknown queue"] });
    }
    const [n] = await tx.update(phoneNumbers).set({ label: d.label ?? null, routing: d.routing as NumberRouting, updatedAt: new Date() })
      .where(and(eq(phoneNumbers.organizationId, ctx.orgId), eq(phoneNumbers.id, id), eq(phoneNumbers.status, "active"))).returning({ e164: phoneNumbers.e164 });
    if (!n) throw new NotFoundError("Number not found.");
    await audit(tx, ctx, { action: "phone.number_routing_updated", entityType: "phone_number", entityId: id, metadata: { e164: n.e164, routing: d.routing } });
  });
}

/* ───────── queues ───────── */

const queueSchema = z.object({
  name: z.string().trim().min(1, "Name the queue").max(60),
  strategy: z.enum(["simultaneous", "round_robin"]),
  ringTimeoutSec: z.coerce.number().int().min(5).max(120),
  fallback: z.enum(["voicemail", "hangup"]),
  memberIds: z.array(z.string().uuid()).max(100),
});

async function setMembers(tx: Tx, ctx: OrgContext, queueId: string, ids: string[]) {
  if (ids.length) {
    const ok = await tx.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.organizationId, ctx.orgId), inArray(memberships.id, ids), eq(memberships.status, "active")));
    if (ok.length !== new Set(ids).size) throw new ValidationError("Choose active team members.", { memberIds: ["Unknown member"] });
  }
  await tx.delete(phoneQueueMembers).where(eq(phoneQueueMembers.queueId, queueId));
  if (ids.length) await tx.insert(phoneQueueMembers).values([...new Set(ids)].map((m, i) => ({ organizationId: ctx.orgId, queueId, membershipId: m, position: i })));
}

export async function saveQueue(ctx: OrgContext, id: string | null, input: unknown) {
  needManage(ctx);
  const d = parseInput(queueSchema, input);
  return withTenant(ctx, async (tx) => {
    const qid = id ?? newId();
    try {
      if (id) {
        const [q] = await tx.update(phoneQueues).set({ name: d.name, strategy: d.strategy, ringTimeoutSec: d.ringTimeoutSec, fallback: d.fallback, updatedAt: new Date() })
          .where(and(eq(phoneQueues.organizationId, ctx.orgId), eq(phoneQueues.id, id), isNull(phoneQueues.archivedAt))).returning({ id: phoneQueues.id });
        if (!q) throw new NotFoundError("Queue not found.");
      } else {
        await tx.insert(phoneQueues).values({ id: qid, organizationId: ctx.orgId, name: d.name, strategy: d.strategy, ringTimeoutSec: d.ringTimeoutSec, fallback: d.fallback });
      }
    } catch (e) {
      if (isUniqueViolation(e)) throw new ValidationError("A queue with that name exists.", { name: ["Already exists"] });
      throw e;
    }
    await setMembers(tx, ctx, qid, d.memberIds);
    await audit(tx, ctx, { action: id ? "phone.queue_updated" : "phone.queue_created", entityType: "phone_queue", entityId: qid, metadata: { name: d.name, members: d.memberIds.length } });
    return { id: qid };
  });
}

export async function archiveQueue(ctx: OrgContext, id: string) {
  needManage(ctx);
  return withTenant(ctx, async (tx) => {
    const using = await tx.select({ e164: phoneNumbers.e164 }).from(phoneNumbers).where(and(eq(phoneNumbers.organizationId, ctx.orgId), eq(phoneNumbers.status, "active"), sql`${phoneNumbers.routing}->>'queueId' = ${id}`));
    if (using.length) throw new ConflictError(`Still routing ${using.map((u) => u.e164).join(", ")}. Change those numbers first.`);
    const [q] = await tx.update(phoneQueues).set({ archivedAt: new Date() }).where(and(eq(phoneQueues.organizationId, ctx.orgId), eq(phoneQueues.id, id), isNull(phoneQueues.archivedAt))).returning({ name: phoneQueues.name });
    if (!q) throw new NotFoundError("Queue not found.");
    await audit(tx, ctx, { action: "phone.queue_archived", entityType: "phone_queue", entityId: id, metadata: q });
  });
}

/* ───────── availability ───────── */

export async function setAvailability(ctx: OrgContext, status: AgentStatus) {
  if (!ctx.permissions.has("calls.make")) throw new ForbiddenError("You can't take calls.");
  if (!AGENT_STATUSES.includes(status)) throw new ValidationError("Choose a status.");
  return withTenant(ctx, async (tx) => {
    await tx.insert(phoneAgents).values({ organizationId: ctx.orgId, membershipId: ctx.membershipId, status, lastSeenAt: new Date() })
      .onConflictDoUpdate({ target: [phoneAgents.organizationId, phoneAgents.membershipId], set: { status, lastSeenAt: new Date(), updatedAt: new Date() } });
  });
}

/* ───────── overview ───────── */

/** Everything the phone pages and the softphone need, without secrets. */
export async function getPhoneSetup(ctx: OrgContext) {
  return withTenant(ctx, async (tx) => {
    const a = await activeAccount(tx, ctx.orgId);
    const numbers = a ? await tx.select().from(phoneNumbers).where(and(eq(phoneNumbers.organizationId, ctx.orgId), eq(phoneNumbers.status, "active"))).orderBy(asc(phoneNumbers.createdAt)) : [];
    const queues = a ? await tx.select().from(phoneQueues).where(and(eq(phoneQueues.organizationId, ctx.orgId), isNull(phoneQueues.archivedAt))).orderBy(asc(phoneQueues.name)) : [];
    const members = queues.length ? await tx.select().from(phoneQueueMembers).where(inArray(phoneQueueMembers.queueId, queues.map((q) => q.id))) : [];
    const agents = await tx
      .select({ membershipId: memberships.id, name: user.name, status: phoneAgents.status, activeCallId: phoneAgents.activeCallId })
      .from(memberships).innerJoin(user, eq(user.id, memberships.userId))
      .leftJoin(phoneAgents, and(eq(phoneAgents.organizationId, memberships.organizationId), eq(phoneAgents.membershipId, memberships.id)))
      .where(and(eq(memberships.organizationId, ctx.orgId), eq(memberships.status, "active"),
        sql`exists (select 1 from role_permissions rp where rp.role_id = ${memberships.roleId} and rp.permission_key = 'calls.make')`))
      .orderBy(asc(user.name));
    const [org] = await tx.select({ timezone: organizations.timezone }).from(organizations).where(eq(organizations.id, ctx.orgId));
    const me = agents.find((x) => x.membershipId === ctx.membershipId);
    return {
      configured: !!platformCredentials() && encryptionConfigured(),
      account: a ? { id: a.id, status: a.status, settings: a.settings, lastError: a.lastError, subaccount: a.providerAccountSid } : null,
      numbers: numbers.map((n) => ({ id: n.id, e164: n.e164, label: n.label, routing: n.routing, capabilities: n.capabilities })),
      queues: queues.map((q) => ({ ...q, memberIds: members.filter((m) => m.queueId === q.id).sort((x, y) => x.position - y.position).map((m) => m.membershipId) })),
      agents: agents.map((x) => ({ ...x, status: (x.status ?? "offline") as AgentStatus })),
      myStatus: (me?.status ?? "offline") as AgentStatus,
      canMake: ctx.permissions.has("calls.make") && !!a && a.status === "active" && numbers.length > 0,
      timezone: org.timezone,
    };
  });
}
export type PhoneSetup = Awaited<ReturnType<typeof getPhoneSetup>>;

/** What the persistent softphone needs on every page: null when this member can't call from this workspace. */
export async function softphoneConfig(ctx: OrgContext) {
  if (!ctx.permissions.has("calls.make")) return null;
  return withTenant(ctx, async (tx) => {
    const a = await activeAccount(tx, ctx.orgId);
    if (!a || a.status !== "active") return null;
    const numbers = await tx.select({ id: phoneNumbers.id, e164: phoneNumbers.e164, label: phoneNumbers.label }).from(phoneNumbers)
      .where(and(eq(phoneNumbers.organizationId, ctx.orgId), eq(phoneNumbers.status, "active"))).orderBy(asc(phoneNumbers.createdAt));
    if (!numbers.length) return null;
    const [me] = await tx.select({ status: phoneAgents.status }).from(phoneAgents).where(and(eq(phoneAgents.organizationId, ctx.orgId), eq(phoneAgents.membershipId, ctx.membershipId)));
    return { numbers, myStatus: (me?.status ?? "offline") as AgentStatus };
  });
}
export type SoftphoneConfig = NonNullable<Awaited<ReturnType<typeof softphoneConfig>>>;
