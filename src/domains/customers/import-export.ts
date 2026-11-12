import "server-only";
import Papa from "papaparse";
import { and, asc, eq, inArray } from "drizzle-orm";
import { memberships } from "@/domains/identity/schema";
import { user } from "@/server/auth/schema";
import { audit } from "@/server/audit/audit";
import type { OrgContext } from "@/server/authz/context";
import { withTenant } from "@/server/db/tenant";
import { ValidationError } from "@/server/errors";
import { assertCanRead, ensureTags, requirePerm, validateCustomFields } from "./internal";
import { listCustomFields } from "./custom-fields";
import { findMatchesForIdentifiers } from "./duplicates";
import { deriveDisplayName, normalizeEmail, normalizeHandle, normalizePhone } from "./normalize";
import { createCustomer, listCustomerIds } from "./service";
import { customerEmails, customerIdentities, customerPhones, customers, customerTags, tags } from "./schema";
import { CUSTOMER_SOURCES, IDENTITY_PROVIDERS, type CustomerListFilters } from "./validation";

export const MAX_IMPORT_ROWS = 5000;
export const MAX_EXPORT_ROWS = 50_000;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

export const IMPORT_FIELDS = {
  skip: "Don't import",
  fullName: "Full name",
  firstName: "First name",
  lastName: "Last name",
  companyName: "Company",
  email: "Email",
  email2: "Secondary email",
  phone: "Phone",
  phone2: "Secondary phone",
  instagram: "Instagram handle",
  facebook: "Facebook",
  whatsapp: "WhatsApp number",
  tiktok: "TikTok handle",
  source: "Source",
  tags: "Tags (comma separated)",
  type: "Type (person/business)",
  line1: "Shipping address line 1",
  line2: "Shipping address line 2",
  city: "City",
  region: "State / region",
  postalCode: "Postal code",
  country: "Country",
} as const;
export type ImportField = keyof typeof IMPORT_FIELDS | `custom:${string}`;

const HEADER_HINTS: [RegExp, keyof typeof IMPORT_FIELDS][] = [
  [/^(full[\s_]?)?name$|^customer[\s_]?name$|^contact$/i, "fullName"],
  [/^first/i, "firstName"],
  [/^last|^surname/i, "lastName"],
  [/company|business|organi[sz]ation/i, "companyName"],
  [/^e-?mail(\s*1)?$|^email[\s_]?address$/i, "email"],
  [/e-?mail.*2|secondary.*mail/i, "email2"],
  [/whats\s*app/i, "whatsapp"],
  [/^(phone|mobile|cell|tel)/i, "phone"],
  [/(phone|mobile).*2|secondary.*phone/i, "phone2"],
  [/insta|^ig$/i, "instagram"],
  [/facebook|^fb$/i, "facebook"],
  [/tik\s*tok/i, "tiktok"],
  [/source|channel|lead[\s_]?source/i, "source"],
  [/tag/i, "tags"],
  [/^type$/i, "type"],
  [/address.*2|line\s*2|apt|suite/i, "line2"],
  [/address|street|line\s*1/i, "line1"],
  [/city|town/i, "city"],
  [/state|region|province/i, "region"],
  [/zip|postal|postcode/i, "postalCode"],
  [/country/i, "country"],
];

export function parseCsv(text: string) {
  if (text.length > MAX_IMPORT_BYTES) throw new ValidationError(`File is too large (max ${MAX_IMPORT_BYTES / 1024 / 1024} MB).`);
  const res = Papa.parse<string[]>(text.replace(/^﻿/, ""), { skipEmptyLines: "greedy" });
  const [headers, ...rows] = res.data;
  if (!headers?.length) throw new ValidationError("The file has no header row.");
  if (rows.length === 0) throw new ValidationError("The file has no data rows.");
  if (rows.length > MAX_IMPORT_ROWS) throw new ValidationError(`Import up to ${MAX_IMPORT_ROWS.toLocaleString()} rows at a time (this file has ${rows.length.toLocaleString()}).`);
  return { headers: headers.map((h) => h.trim()), rows };
}

export function suggestMapping(headers: string[], customKeys: { key: string; label: string }[] = []): ImportField[] {
  const used = new Set<string>();
  return headers.map((h) => {
    const custom = customKeys.find((c) => c.label.toLowerCase() === h.toLowerCase() || c.key === h.toLowerCase());
    if (custom && !used.has(`custom:${custom.key}`)) {
      used.add(`custom:${custom.key}`);
      return `custom:${custom.key}` as ImportField;
    }
    for (const [re, field] of HEADER_HINTS) {
      if (re.test(h) && !used.has(field)) {
        used.add(field);
        return field;
      }
    }
    return "skip";
  });
}

export interface ImportReport {
  created: number;
  updated: number;
  skipped: number;
  failed: { row: number; error: string }[];
  total: number;
}

type DuplicateMode = "skip" | "update" | "create";

function rowToInput(row: string[], mapping: ImportField[]) {
  const v: Record<string, string> = {};
  const custom: Record<string, string> = {};
  mapping.forEach((field, i) => {
    const cell = (row[i] ?? "").trim();
    if (!cell || field === "skip") return;
    if (field.startsWith("custom:")) custom[field.slice(7)] = cell;
    else v[field] = cell;
  });
  let firstName: string | null = v.firstName ?? null;
  let lastName: string | null = v.lastName ?? null;
  if (!firstName && !lastName && v.fullName) {
    const parts = v.fullName.split(/\s+/);
    firstName = parts[0];
    lastName = parts.slice(1).join(" ") || null;
  }
  const sourceRaw = v.source?.toLowerCase().replace(/[\s-]+/g, "_");
  const source = (CUSTOMER_SOURCES as readonly string[]).includes(sourceRaw ?? "") ? (sourceRaw as (typeof CUSTOMER_SOURCES)[number]) : "import";
  const identities = (["instagram", "facebook", "tiktok", "whatsapp"] as const)
    .filter((p) => v[p])
    .map((provider) => ({ provider: provider as (typeof IDENTITY_PROVIDERS)[number], handle: v[provider] }));
  const companyName = v.companyName ?? null;
  const type: "person" | "business" = v.type?.toLowerCase().startsWith("b") && companyName ? "business" : "person";
  return {
    type,
    firstName,
    lastName,
    companyName,
    source,
    emails: [v.email, v.email2].filter(Boolean).map((email) => ({ email })),
    phones: [v.phone, v.phone2, v.whatsapp].filter(Boolean).map((phone) => ({ phone })),
    identities,
    addresses: v.line1 ? [{ kind: "shipping" as const, line1: v.line1, line2: v.line2, city: v.city, region: v.region, postalCode: v.postalCode, country: v.country }] : [],
    tagNames: (v.tags ?? "").split(/[,;|]/).map((t) => t.trim()).filter(Boolean),
    customFields: custom,
  };
}

/**
 * Imports rows one by one (each in its own transaction) so one bad row never blocks the rest.
 * Matching on email / phone / social handle decides whether a row is a duplicate.
 */
export async function importCustomers(ctx: OrgContext, csvText: string, mapping: ImportField[], mode: DuplicateMode): Promise<ImportReport> {
  requirePerm(ctx, "customers.import", "customers.write");
  const { headers, rows } = parseCsv(csvText);
  if (mapping.length !== headers.length) throw new ValidationError("Column mapping doesn't match the file.");
  if (!mapping.some((m) => m !== "skip")) throw new ValidationError("Map at least one column.");
  const report: ImportReport = { created: 0, updated: 0, skipped: 0, failed: [], total: rows.length };

  for (const [i, row] of rows.entries()) {
    const rowNo = i + 2; // header is row 1
    try {
      const input = rowToInput(row, mapping);
      if (mode !== "create") {
        const matches = await findMatchesForIdentifiers(ctx, {
          emails: input.emails.map((e) => e.email),
          phones: input.phones.map((p) => p.phone),
          identities: input.identities,
        });
        if (matches.length > 1 && mode === "update") {
          report.failed.push({ row: rowNo, error: `Matches ${matches.length} existing customers (${matches.map((m) => `CUS-${m.number}`).join(", ")}); merge them first` });
          continue;
        }
        if (matches.length >= 1) {
          if (mode === "skip") {
            report.skipped += 1;
            continue;
          }
          await appendToCustomer(ctx, matches[0].id, input);
          report.updated += 1;
          continue;
        }
      }
      await createCustomer(ctx, input, { source: "import" });
      report.created += 1;
    } catch (err) {
      const e = err as ValidationError;
      const detail = e.fieldErrors ? Object.values(e.fieldErrors).flat()[0] : undefined;
      report.failed.push({ row: rowNo, error: detail ?? e.message ?? "Could not import row" });
    }
  }

  await withTenant(ctx, (tx) =>
    audit(tx, ctx, { action: "customers.imported", entityType: "customer_import", metadata: { ...report, failed: report.failed.length, mode, columns: mapping.filter((m) => m !== "skip") } }),
  );
  return report;
}

/** Import "update" mode: fills empty fields and adds new identifiers/tags; never removes or overwrites. */
async function appendToCustomer(ctx: OrgContext, id: string, input: ReturnType<typeof rowToInput>) {
  await withTenant(ctx, async (tx) => {
    const [c] = await tx.select().from(customers).where(and(eq(customers.organizationId, ctx.orgId), eq(customers.id, id))).for("update");
    const patch: Record<string, unknown> = {};
    for (const f of ["firstName", "lastName", "companyName"] as const) if (!c[f] && input[f]) patch[f] = input[f];
    if (!c.source && input.source) patch.source = input.source;
    const cf = await validateCustomFields(tx, ctx.orgId, input.customFields, { partial: true });
    const fillCf = Object.fromEntries(Object.entries(cf).filter(([k]) => c.customFields?.[k] === undefined || c.customFields?.[k] === null));
    if (Object.keys(fillCf).length) patch.customFields = { ...c.customFields, ...fillCf };

    for (const e of input.emails) {
      await tx.insert(customerEmails).values({ organizationId: ctx.orgId, customerId: id, email: e.email, normalizedEmail: normalizeEmail(e.email) }).onConflictDoNothing();
    }
    for (const p of input.phones) {
      const e164 = normalizePhone(p.phone);
      if (e164) await tx.insert(customerPhones).values({ organizationId: ctx.orgId, customerId: id, phone: p.phone, e164 }).onConflictDoNothing();
    }
    for (const ident of input.identities) {
      const nh = normalizeHandle(ident.handle);
      const [exists] = await tx.select({ id: customerIdentities.id }).from(customerIdentities).where(and(eq(customerIdentities.customerId, id), eq(customerIdentities.provider, ident.provider), eq(customerIdentities.normalizedHandle, nh)));
      if (!exists) await tx.insert(customerIdentities).values({ organizationId: ctx.orgId, customerId: id, provider: ident.provider, handle: ident.handle.replace(/^@/, ""), normalizedHandle: nh });
    }
    const tagIds = await ensureTags(tx, ctx.orgId, input.tagNames);
    if (tagIds.length) await tx.insert(customerTags).values(tagIds.map((tagId) => ({ organizationId: ctx.orgId, customerId: id, tagId }))).onConflictDoNothing();
    if (patch.firstName || patch.lastName || patch.companyName) patch.displayName = deriveDisplayName({ ...c, ...patch });
    if (Object.keys(patch).length) await tx.update(customers).set(patch).where(eq(customers.id, id));
    await audit(tx, ctx, { action: "customer.updated_by_import", entityType: "customer", entityId: id, metadata: { filled: Object.keys(patch) } });
  });
}

/* ───────────────────────── Export ───────────────────────── */

/** Neutralises spreadsheet formula injection (cells beginning with = + - @). */
export function csvSafe(value: unknown): string {
  const s = value === null || value === undefined ? "" : value instanceof Date ? value.toISOString() : String(value);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

export async function exportCustomersCsv(ctx: OrgContext, filters: CustomerListFilters): Promise<{ csv: string; count: number }> {
  requirePerm(ctx, "customers.export");
  assertCanRead(ctx);
  const ids = await listCustomerIds(ctx, filters, MAX_EXPORT_ROWS);
  const defs = await listCustomFields(ctx);
  const csv = await withTenant(ctx, async (tx) => {
    const rows = ids.length
      ? await tx
          .select({ c: customers, ownerName: user.name })
          .from(customers)
          .leftJoin(memberships, eq(memberships.id, customers.ownerMembershipId))
          .leftJoin(user, eq(user.id, memberships.userId))
          .where(and(eq(customers.organizationId, ctx.orgId), inArray(customers.id, ids)))
      : [];
    const order = new Map(ids.map((id, i) => [id, i]));
    rows.sort((a, b) => order.get(a.c.id)! - order.get(b.c.id)!);
    const [emails, phones, idents, tagRows] = ids.length
      ? await Promise.all([
          tx.select().from(customerEmails).where(inArray(customerEmails.customerId, ids)).orderBy(asc(customerEmails.createdAt)),
          tx.select().from(customerPhones).where(inArray(customerPhones.customerId, ids)).orderBy(asc(customerPhones.createdAt)),
          tx.select().from(customerIdentities).where(inArray(customerIdentities.customerId, ids)),
          tx.select({ customerId: customerTags.customerId, name: tags.name }).from(customerTags).innerJoin(tags, eq(tags.id, customerTags.tagId)).where(inArray(customerTags.customerId, ids)),
        ])
      : [[], [], [], []];
    const header = ["Customer ID", "Number", "Display name", "First name", "Last name", "Company", "Type", "Status", "Emails", "Phones", "Instagram", "Facebook", "TikTok", "Source", "Owner", "Tags", "Email marketing", "Created at", ...defs.map((d) => d.label)];
    const data = rows.map(({ c, ownerName }) => {
      const h = (p: string) => idents.filter((i) => i.customerId === c.id && i.provider === p).map((i) => i.handle).join("; ");
      return [
        c.id, `CUS-${c.number}`, c.displayName, c.firstName, c.lastName, c.companyName, c.type, c.status,
        emails.filter((e) => e.customerId === c.id).map((e) => e.email).join("; "),
        phones.filter((p) => p.customerId === c.id).map((p) => p.phone).join("; "),
        h("instagram"), h("facebook"), h("tiktok"), c.source, ownerName,
        tagRows.filter((t) => t.customerId === c.id).map((t) => t.name).join("; "),
        c.emailMarketing, c.createdAt,
        ...defs.map((d) => c.customFields?.[d.key]),
      ].map(csvSafe);
    });
    await audit(tx, ctx, { action: "customers.exported", entityType: "customer_export", metadata: { count: rows.length, filters } });
    return Papa.unparse([header, ...data]);
  });
  return { csv: `﻿${csv}`, count: ids.length };
}
