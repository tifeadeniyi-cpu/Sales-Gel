import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  addNote,
  bulkUpdateCustomers,
  createCustomer,
  deleteNote,
  getCustomer,
  getCustomerStats,
  getCustomerTimeline,
  listCustomers,
  listNotes,
  recordConsent,
  setCustomerArchived,
  updateCustomer,
  updateCustomerField,
  updateNote,
} from "@/domains/customers/service";
import { dismissDuplicate, findDuplicateSuggestions, findMatchesForIdentifiers, mergeCustomers, unmergeCustomers } from "@/domains/customers/duplicates";
import { createCustomField, setCustomFieldArchived, updateCustomField } from "@/domains/customers/custom-fields";
import { csvSafe, exportCustomersCsv, importCustomers, parseCsv, suggestMapping } from "@/domains/customers/import-export";
import { customerConsents, customers } from "@/domains/customers/schema";
import { listNotifications } from "@/domains/platform/notifications";
import { isPermissionDenied } from "@/server/db/errors";
import { withTenant } from "@/server/db/tenant";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { addMember, createOrgWithOwner } from "../support/factories";

describe("customer create / read / update", () => {
  it("creates a full customer with identifiers, address, tags and a sequential number", async () => {
    const { ctx } = await createOrgWithOwner("Cust");
    const a = await createCustomer(ctx, {
      firstName: "Ada",
      lastName: "Obi",
      emails: [{ email: "Ada@Example.com" }, { email: "ada.work@example.com", isPrimary: true }],
      phones: [{ phone: "(214) 555-0101" }],
      identities: [{ provider: "instagram", handle: "@AdaCooks" }],
      addresses: [{ kind: "shipping", line1: "1 Main St", city: "Dallas", region: "TX", postalCode: "75201", country: "US" }],
      tagNames: ["VIP", "vip", "Wholesale"],
      source: "instagram",
    });
    const b = await createCustomer(ctx, { companyName: "Lagos Foods", type: "business" });
    expect(b.number).toBe(a.number + 1);

    const c = (await getCustomer(ctx, a.id))!;
    expect(c.displayName).toBe("Ada Obi");
    expect(c.emails.map((e) => e.normalizedEmail)).toEqual(["ada.work@example.com", "ada@example.com"]);
    expect(c.phones[0].e164).toBe("+12145550101");
    expect(c.identities[0]).toMatchObject({ provider: "instagram", handle: "AdaCooks", normalizedHandle: "adacooks" });
    expect(c.tags.map((t) => t.name)).toEqual(["VIP", "Wholesale"]);
    expect((await getCustomer(ctx, b.id))!.displayName).toBe("Lagos Foods");
  });

  it("allows a provisional contact from just a social handle, but not an empty record", async () => {
    const { ctx } = await createOrgWithOwner("Prov");
    const p = await createCustomer(ctx, { identities: [{ provider: "instagram", handle: "mystery_buyer" }], provisional: true, source: "instagram" });
    const c = (await getCustomer(ctx, p.id))!;
    expect(c).toMatchObject({ status: "provisional", displayName: "@mystery_buyer" });
    await expect(createCustomer(ctx, {})).rejects.toBeInstanceOf(ValidationError);
    await expect(createCustomer(ctx, { type: "business", firstName: "x" })).rejects.toMatchObject({ fieldErrors: { companyName: expect.any(Array) } });
  });

  it("full update replaces identifiers and audits a diff", async () => {
    const { ctx } = await createOrgWithOwner("Upd");
    const { id } = await createCustomer(ctx, { firstName: "Bayo", emails: [{ email: "old@example.com" }] });
    await updateCustomer(ctx, id, { firstName: "Bayo", lastName: "Ade", emails: [{ email: "new@example.com" }], tagNames: ["Retail"] });
    const c = (await getCustomer(ctx, id))!;
    expect(c.displayName).toBe("Bayo Ade");
    expect(c.emails.map((e) => e.email)).toEqual(["new@example.com"]);
    const tl = await getCustomerTimeline(ctx, id);
    expect(tl.find((t) => t.action === "customer.updated")?.changes).toMatchObject({ lastName: { from: null, to: "Ade" } });
  });

  it("inline edits validate, persist, recompute display name and return the saved value", async () => {
    const { ctx } = await createOrgWithOwner("Inline");
    const { id } = await createCustomer(ctx, { firstName: "Chi" });
    const r = await updateCustomerField(ctx, id, "lastName", "Eze");
    expect(r).toEqual({ value: "Eze", displayName: "Chi Eze" });
    await expect(updateCustomerField(ctx, id, "preferredCurrency", "dollars")).rejects.toBeInstanceOf(ValidationError);
    await expect(updateCustomerField(ctx, id, "number", 5)).rejects.toBeInstanceOf(ValidationError);
    await expect(updateCustomerField(ctx, id, "type", "business")).rejects.toMatchObject({ fieldErrors: { companyName: expect.any(Array) } });
    expect((await getCustomer(ctx, id))!.lastName).toBe("Eze");
  });

  it("assigning an owner validates membership and notifies them", async () => {
    const { ctx } = await createOrgWithOwner("Assign");
    const { ctx: rep } = await addMember(ctx, "sales_rep");
    const other = await createOrgWithOwner("AssignOther");
    const { id } = await createCustomer(ctx, { firstName: "Dayo" });
    await expect(updateCustomerField(ctx, id, "ownerMembershipId", other.ctx.membershipId)).rejects.toBeInstanceOf(ValidationError);
    await updateCustomerField(ctx, id, "ownerMembershipId", rep.membershipId);
    const notes = await listNotifications(rep);
    expect(notes[0]).toMatchObject({ type: "customer.assigned", title: expect.stringContaining("Dayo") });
  });

  it("archive / restore and list views", async () => {
    const { ctx } = await createOrgWithOwner("Arch");
    const { id } = await createCustomer(ctx, { firstName: "Efe" });
    await createCustomer(ctx, { firstName: "Funmi", provisional: true, emails: [{ email: "f@example.com" }] });
    await setCustomerArchived(ctx, id, true);
    expect((await listCustomers(ctx)).rows.map((r) => r.displayName)).toEqual(["Funmi"]);
    expect((await listCustomers(ctx, { view: "archived" })).rows.map((r) => r.displayName)).toEqual(["Efe"]);
    expect((await listCustomers(ctx, { view: "provisional" })).total).toBe(1);
    await setCustomerArchived(ctx, id, false);
    expect((await listCustomers(ctx)).total).toBe(2);
    expect(await getCustomerStats(ctx)).toMatchObject({ active: 2, provisional: 1 });
  });
});

describe("customer list search, filter, sort, paginate", () => {
  it("searches across name, company, email, phone, handle and number", async () => {
    const { ctx } = await createOrgWithOwner("Search");
    const a = await createCustomer(ctx, { firstName: "Grace", lastName: "Okafor", emails: [{ email: "grace@shop.ng" }], phones: [{ phone: "+234 803 123 4567" }] });
    await createCustomer(ctx, { companyName: "Kente House", type: "business", identities: [{ provider: "instagram", handle: "kentehouse" }] });
    await createCustomer(ctx, { firstName: "Hassan", source: "whatsapp", tagNames: ["Wholesale"] });
    const q = async (s: string) => (await listCustomers(ctx, { q: s })).rows.map((r) => r.displayName);
    expect(await q("okaf")).toEqual(["Grace Okafor"]);
    expect(await q("shop.ng")).toEqual(["Grace Okafor"]);
    expect(await q("8031234")).toEqual(["Grace Okafor"]);
    expect(await q("@KenteHouse")).toEqual(["Kente House"]);
    expect(await q(`CUS-${a.number}`)).toEqual(["Grace Okafor"]);
    expect(await q("100%_")).toEqual([]);
    expect((await listCustomers(ctx, { source: "whatsapp" })).rows.map((r) => r.displayName)).toEqual(["Hassan"]);
    expect((await listCustomers(ctx, { type: "business" })).total).toBe(1);
  });

  it("sorts and paginates deterministically", async () => {
    const { ctx } = await createOrgWithOwner("Page");
    for (const n of ["Zara", "amaka", "Bisi", "Chidi", "dele"]) await createCustomer(ctx, { firstName: n });
    const asc = (await listCustomers(ctx, { sort: "name_asc", pageSize: 25 })).rows.map((r) => r.displayName);
    expect(asc).toEqual(["amaka", "Bisi", "Chidi", "dele", "Zara"]);
    const p1 = await listCustomers(ctx, { sort: "name_asc", pageSize: 25, page: 1 });
    expect(p1).toMatchObject({ total: 5, pageCount: 1 });
    const filters = { sort: "name_desc" as const, pageSize: 25, page: 1 };
    expect((await listCustomers(ctx, filters)).rows[0].displayName).toBe("Zara");
  });
});

describe("customer permissions & tenant isolation", () => {
  it("sales reps (read_assigned) only see and edit customers they own", async () => {
    const { ctx } = await createOrgWithOwner("Scope");
    const { ctx: rep } = await addMember(ctx, "sales_manager");
    const { ctx: agent } = await addMember(ctx, "support_agent");
    // Make a rep-like custom role: read_assigned + write.
    const { createRole, changeMemberRole } = await import("@/domains/identity/service");
    const role = await createRole(ctx, { name: "Assigned Only", permissions: ["customers.read_assigned", "customers.write"] });
    await changeMemberRole(ctx, { membershipId: rep.membershipId, roleId: role.id });
    const { loadOrgContext } = await import("@/server/authz/context");
    const repCtx = (await loadOrgContext(rep.userId, ctx.orgSlug))!;

    const mine = await createCustomer(repCtx, { firstName: "Mine" });
    const theirs = await createCustomer(ctx, { firstName: "Theirs" });
    expect((await getCustomer(repCtx, mine.id))?.ownerMembershipId).toBe(repCtx.membershipId);
    expect((await listCustomers(repCtx)).rows.map((r) => r.displayName)).toEqual(["Mine"]);
    expect(await getCustomer(repCtx, theirs.id)).toBeNull();
    await expect(updateCustomerField(repCtx, theirs.id, "firstName", "Hacked")).rejects.toBeInstanceOf(NotFoundError);
    await expect(updateCustomerField(repCtx, mine.id, "ownerMembershipId", null)).rejects.toBeInstanceOf(ForbiddenError);

    // Support agents can read but not write or export.
    expect((await listCustomers(agent)).total).toBe(2);
    await expect(createCustomer(agent, { firstName: "X" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(exportCustomersCsv(agent, {})).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setCustomerArchived(agent, theirs.id, true)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(mergeCustomers(agent, mine.id, theirs.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("cannot read, edit, merge or export another org's customers", async () => {
    const a = await createOrgWithOwner("CustA");
    const b = await createOrgWithOwner("CustB");
    const bc = await createCustomer(b.ctx, { firstName: "Secret", emails: [{ email: "secret@b.test" }] });
    const ac = await createCustomer(a.ctx, { firstName: "Mine", emails: [{ email: "secret@b.test" }] });
    expect(await getCustomer(a.ctx, bc.id)).toBeNull();
    await expect(updateCustomerField(a.ctx, bc.id, "firstName", "x")).rejects.toBeInstanceOf(NotFoundError);
    await expect(addNote(a.ctx, bc.id, { body: "x" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(mergeCustomers(a.ctx, ac.id, bc.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(bulkUpdateCustomers(a.ctx, [bc.id], { kind: "archive" })).rejects.toBeInstanceOf(NotFoundError);
    expect((await listCustomers(a.ctx, { q: "secret" })).rows.map((r) => r.id)).toEqual([ac.id]);
    expect(await findDuplicateSuggestions(a.ctx)).toHaveLength(0);
    const { csv } = await exportCustomersCsv(a.ctx, {});
    expect(csv).not.toContain("Secret");
  });
});

describe("notes, consent, bulk actions", () => {
  it("notes: add, pin, author-only edit, manager delete; all on the timeline", async () => {
    const { ctx } = await createOrgWithOwner("Notes");
    const { ctx: mgr } = await addMember(ctx, "sales_manager");
    const { id } = await createCustomer(ctx, { firstName: "Ife" });
    const n1 = await addNote(mgr, id, { body: "Prefers delivery on Saturdays" });
    await addNote(ctx, id, { body: "Asked about bulk pricing" });
    await updateNote(ctx, n1.id, { pinned: true });
    expect((await listNotes(ctx, id))[0]).toMatchObject({ body: "Prefers delivery on Saturdays", pinned: true });
    await expect(updateNote(ctx, n1.id, { body: "rewrite" })).rejects.toBeInstanceOf(ForbiddenError);
    await updateNote(mgr, n1.id, { body: "Prefers Saturday delivery" });
    await deleteNote(ctx, n1.id); // owner has customers.archive
    expect((await listNotes(ctx, id)).map((n) => n.body)).toEqual(["Asked about bulk pricing"]);
    const actions = (await getCustomerTimeline(ctx, id)).map((t) => t.action);
    expect(actions).toEqual(expect.arrayContaining(["customer.note_added", "customer.note_pinned", "customer.note_edited", "customer.note_deleted"]));
  });

  it("consent history is append-only and drives email marketing status", async () => {
    const { ctx } = await createOrgWithOwner("Consent");
    const { id } = await createCustomer(ctx, { firstName: "Jide", emails: [{ email: "j@example.com" }] });
    await recordConsent(ctx, id, { channel: "email", status: "granted", source: "Checkout checkbox" });
    await recordConsent(ctx, id, { channel: "email", status: "revoked", source: "Customer asked by phone" });
    const c = (await getCustomer(ctx, id))!;
    expect(c.emailMarketing).toBe("unsubscribed");
    expect(c.consents.map((x) => x.status)).toEqual(["revoked", "granted"]);
    await expect(withTenant(ctx, (tx) => tx.update(customerConsents).set({ status: "granted" }).where(eq(customerConsents.customerId, id)))).rejects.toSatisfy(isPermissionDenied);
    await expect(withTenant(ctx, (tx) => tx.delete(customerConsents).where(eq(customerConsents.customerId, id)))).rejects.toSatisfy(isPermissionDenied);
  });

  it("bulk assign, tag, untag, archive", async () => {
    const { ctx } = await createOrgWithOwner("Bulk");
    const { ctx: rep } = await addMember(ctx, "sales_rep");
    const ids = [];
    for (const n of ["K1", "K2", "K3"]) ids.push((await createCustomer(ctx, { firstName: n })).id);
    expect(await bulkUpdateCustomers(ctx, ids, { kind: "assign", ownerMembershipId: rep.membershipId })).toEqual({ count: 3 });
    await bulkUpdateCustomers(ctx, ids.slice(0, 2), { kind: "addTag", tagName: "Spring Promo" });
    const tagged = await listCustomers(ctx, { q: "", sort: "name_asc" });
    const tag = tagged.rows[0].tags[0];
    expect(tag.name).toBe("Spring Promo");
    expect((await listCustomers(ctx, { tag: tag.id })).total).toBe(2);
    await bulkUpdateCustomers(ctx, ids, { kind: "removeTag", tagId: tag.id });
    expect((await listCustomers(ctx, { tag: tag.id })).total).toBe(0);
    await bulkUpdateCustomers(ctx, ids, { kind: "archive" });
    expect((await listCustomers(ctx)).total).toBe(0);
    expect((await listCustomers(ctx, { owner: rep.membershipId, view: "archived" })).total).toBe(3);
    await expect(bulkUpdateCustomers(ctx, [], { kind: "archive" })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("duplicates and merging (Scenario 5)", () => {
  it("suggests matches by email, phone and handle; never merges automatically; supports dismissal", async () => {
    const { ctx } = await createOrgWithOwner("Dupes");
    const a = await createCustomer(ctx, { identities: [{ provider: "instagram", handle: "@TolaBakes" }], provisional: true });
    const b = await createCustomer(ctx, { firstName: "Tola", emails: [{ email: "tola@example.com" }], identities: [{ provider: "instagram", handle: "tolabakes" }] });
    const c = await createCustomer(ctx, { firstName: "Tola B", emails: [{ email: " TOLA@example.com " }] });
    const d = await createCustomer(ctx, { firstName: "Unrelated", phones: [{ phone: "214-555-0199" }] });
    const e = await createCustomer(ctx, { firstName: "Same phone", phones: [{ phone: "+1 (214) 555 0199" }] });

    const sugg = await findDuplicateSuggestions(ctx);
    const pairKey = (x: string, y: string) => [x, y].sort().join("|");
    const keys = sugg.map((s) => pairKey(s.a.id, s.b.id));
    expect(keys).toEqual(expect.arrayContaining([pairKey(a.id, b.id), pairKey(b.id, c.id), pairKey(d.id, e.id)]));
    expect(sugg.find((s) => pairKey(s.a.id, s.b.id) === pairKey(a.id, b.id))?.reasons).toEqual(["identity"]);
    // nothing was merged
    expect((await getCustomer(ctx, a.id))!.status).toBe("provisional");

    expect((await findMatchesForIdentifiers(ctx, { emails: ["Tola@Example.com"] })).map((m) => m.id).sort()).toEqual([b.id, c.id].sort());

    await dismissDuplicate(ctx, e.id, d.id);
    expect((await findDuplicateSuggestions(ctx)).map((s) => pairKey(s.a.id, s.b.id))).not.toContain(pairKey(d.id, e.id));
  });

  it("merge preserves notes, identifiers, tags, consent and audit history; unmerge reconciles", async () => {
    const { ctx } = await createOrgWithOwner("Merge");
    const { ctx: rep } = await addMember(ctx, "sales_rep");
    const prov = await createCustomer(ctx, {
      identities: [{ provider: "instagram", handle: "@NkemStyles" }],
      phones: [{ phone: "214-555-0123" }],
      provisional: true,
      source: "instagram",
      tagNames: ["IG Lead"],
    });
    await addNote(ctx, prov.id, { body: "DM'd asking for ankara prices" });
    await recordConsent(ctx, prov.id, { channel: "email", status: "revoked", source: "Replied STOP" });
    const full = await createCustomer(ctx, {
      firstName: "Nkem",
      lastName: "Eze",
      emails: [{ email: "nkem@example.com" }],
      phones: [{ phone: "(214) 555-0123" }],
      ownerMembershipId: rep.membershipId,
      tagNames: ["Retail"],
    });

    const { mergeId } = await mergeCustomers(ctx, full.id, prov.id);
    const survivor = (await getCustomer(ctx, full.id))!;
    expect(survivor.firstName).toBe("Nkem");
    expect(survivor.source).toBe("instagram"); // filled because survivor had none
    expect(survivor.ownerMembershipId).toBe(rep.membershipId); // kept, not overwritten
    expect(survivor.emailMarketing).toBe("unsubscribed"); // most restrictive consent wins
    expect(survivor.identities.map((i) => i.normalizedHandle)).toEqual(["nkemstyles"]);
    expect(survivor.phones).toHaveLength(1); // same number not duplicated
    expect(survivor.tags.map((t) => t.name).sort()).toEqual(["IG Lead", "Retail"]);
    expect(survivor.consents).toHaveLength(1);
    expect((await listNotes(ctx, full.id)).map((n) => n.body)).toEqual(["DM'd asking for ankara prices"]);
    const merged = (await getCustomer(ctx, prov.id))!;
    expect(merged).toMatchObject({ status: "merged", mergedIntoId: full.id });
    expect((await listCustomers(ctx, { view: "all" })).rows.map((r) => r.id)).toEqual([full.id]);
    // Merged record can't be edited and can't be merged again.
    await expect(updateCustomerField(ctx, prov.id, "firstName", "x")).rejects.toBeInstanceOf(ValidationError);
    expect((await getCustomerTimeline(ctx, full.id)).some((t) => t.action === "customer.merged_in")).toBe(true);
    expect((await getCustomerTimeline(ctx, prov.id)).some((t) => t.action === "customer.merged_into")).toBe(true);

    // Unmerge restores both records.
    await unmergeCustomers(ctx, mergeId);
    await expect(unmergeCustomers(ctx, mergeId)).rejects.toBeInstanceOf(ConflictError);
    const back = (await getCustomer(ctx, prov.id))!;
    expect(back).toMatchObject({ status: "provisional", mergedIntoId: null });
    expect(back.identities.map((i) => i.normalizedHandle)).toEqual(["nkemstyles"]);
    expect(back.consents).toHaveLength(1);
    expect((await listNotes(ctx, prov.id))).toHaveLength(1);
    const restored = (await getCustomer(ctx, full.id))!;
    expect(restored.source).toBeNull();
    expect(restored.emailMarketing).toBe("unknown");
    expect(restored.tags.map((t) => t.name)).toEqual(["Retail"]);
    expect(restored.identities).toHaveLength(0);
    // The separated pair isn't immediately re-suggested.
    expect(await findDuplicateSuggestions(ctx, { customerId: full.id })).toHaveLength(0);
  });

  it("chained merges must be reverted in order", async () => {
    const { ctx } = await createOrgWithOwner("Chain");
    const a = await createCustomer(ctx, { firstName: "A" });
    const b = await createCustomer(ctx, { firstName: "B" });
    const c = await createCustomer(ctx, { firstName: "C" });
    const m1 = await mergeCustomers(ctx, b.id, a.id);
    await mergeCustomers(ctx, c.id, b.id);
    await expect(unmergeCustomers(ctx, m1.mergeId)).rejects.toBeInstanceOf(ConflictError);
    await expect(mergeCustomers(ctx, c.id, a.id)).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("custom fields", () => {
  it("defines fields, validates values by type, enforces required, keeps values when archived", async () => {
    const { ctx } = await createOrgWithOwner("Fields");
    await createCustomField(ctx, { label: "Birthday", key: "birthday", type: "date" });
    await createCustomField(ctx, { label: "Tier", key: "tier", type: "select", options: ["Bronze", "Gold"], required: true });
    await createCustomField(ctx, { label: "Household size", key: "household", type: "number" });
    await expect(createCustomField(ctx, { label: "Tier again", key: "tier", type: "text" })).rejects.toBeInstanceOf(ValidationError);

    await expect(createCustomer(ctx, { firstName: "L" })).rejects.toMatchObject({ fieldErrors: { "customFields.tier": expect.any(Array) } });
    await expect(createCustomer(ctx, { firstName: "L", customFields: { tier: "Platinum" } })).rejects.toBeInstanceOf(ValidationError);
    await expect(createCustomer(ctx, { firstName: "L", customFields: { tier: "Gold", birthday: "31/12/1990" } })).rejects.toBeInstanceOf(ValidationError);
    const { id } = await createCustomer(ctx, { firstName: "L", customFields: { tier: "Gold", birthday: "1990-12-31", household: "4", unknown: "dropped" } });
    expect((await getCustomer(ctx, id))!.customFields).toEqual({ tier: "Gold", birthday: "1990-12-31", household: 4 });

    const { listCustomFields } = await import("@/domains/customers/custom-fields");
    const tier = (await listCustomFields(ctx)).find((f) => f.key === "tier")!;
    await updateCustomField(ctx, tier.id, { required: false, options: ["Bronze", "Gold", "Platinum"] });
    await createCustomer(ctx, { firstName: "M" });
    await setCustomFieldArchived(ctx, tier.id, true);
    expect((await getCustomer(ctx, id))!.customFields.tier).toBe("Gold");

    const { ctx: agent } = await addMember(ctx, "sales_manager");
    await expect(createCustomField(agent, { label: "X", key: "x", type: "text" })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("import / export", () => {
  const csv = [
    "Full Name,E-mail,Phone,Instagram,Tags,Source,City,Ignored",
    "Ada Obi,ada@example.com,214-555-0101,@adacooks,VIP; Wholesale,instagram,Dallas,x",
    "Bisi Cole,bisi@example.com,,,Retail,,,",
    "Bad Row,not-an-email,,,,,,",
    ",,,,,,,",
    '"=HYPERLINK(""http://evil"")",evil@example.com,,,,,,',
  ].join("\n");

  it("parses and suggests a column mapping", () => {
    const { headers, rows } = parseCsv(csv);
    expect(rows).toHaveLength(4); // fully blank line skipped
    expect(suggestMapping(headers)).toEqual(["fullName", "email", "phone", "instagram", "tags", "source", "city", "skip"]);
  });

  it("imports with per-row errors, skip/update duplicate modes, and a safe export", async () => {
    const { ctx } = await createOrgWithOwner("Import");
    const mapping = suggestMapping(parseCsv(csv).headers);
    const r1 = await importCustomers(ctx, csv, mapping, "skip");
    expect(r1).toMatchObject({ created: 3, updated: 0, skipped: 0, total: 4 });
    expect(r1.failed).toEqual([{ row: 4, error: "Enter a valid email" }]);
    const ada = (await listCustomers(ctx, { q: "ada@example.com" })).rows[0];
    expect(ada).toMatchObject({ displayName: "Ada Obi", source: "instagram" });
    expect(ada.tags.map((t) => t.name)).toEqual(["VIP", "Wholesale"]);

    const r2 = await importCustomers(ctx, csv, mapping, "skip");
    expect(r2).toMatchObject({ created: 0, skipped: 3 });

    const csv2 = "Email,Company,Tags\nbisi@example.com,Cole Traders,Repeat buyer";
    const r3 = await importCustomers(ctx, csv2, suggestMapping(parseCsv(csv2).headers), "update");
    expect(r3).toMatchObject({ updated: 1, created: 0 });
    const bisi = (await listCustomers(ctx, { q: "bisi@" })).rows[0];
    expect(bisi.companyName).toBe("Cole Traders");
    expect(bisi.tags.map((t) => t.name)).toEqual(["Repeat buyer", "Retail"]);
    expect((await listCustomers(ctx)).total).toBe(3);

    const { csv: out, count } = await exportCustomersCsv(ctx, { sort: "name_asc" });
    expect(count).toBe(3);
    expect(out).toContain("Ada Obi");
    expect(out).toContain(`'=HYPERLINK`);
    expect(out).not.toMatch(/,=HYPERLINK/);
    const { listAuditLogs } = await import("@/domains/platform/audit-queries");
    const actions = (await listAuditLogs(ctx)).rows.map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(["customers.imported", "customers.exported"]));
  });

  it("rejects oversized or empty files and requires import permission", async () => {
    const { ctx } = await createOrgWithOwner("ImpLimits");
    expect(() => parseCsv("Name\n")).toThrow(ValidationError);
    expect(() => parseCsv(`Name\n${"x\n".repeat(5001)}`)).toThrow(/5,000/);
    const { ctx: mgr } = await addMember(ctx, "sales_manager");
    await expect(importCustomers(mgr, "Name\nA", ["fullName"], "skip")).rejects.toBeInstanceOf(ForbiddenError);
    expect(csvSafe("+1 555")).toBe("'+1 555");
    expect(csvSafe("normal")).toBe("normal");
  });
});

void customers;
