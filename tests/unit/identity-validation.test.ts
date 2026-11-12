import { describe, expect, it } from "vitest";
import { createOrganizationSchema, slugSchema, suggestSlug } from "@/domains/identity/validation";
import { diff } from "@/server/audit/audit";
import { parseInput } from "@/server/validate";
import { ValidationError } from "@/server/errors";

describe("slug rules", () => {
  it.each(["acme", "my-sasun", "shop-123"])("accepts %s", (s) => expect(slugSchema.safeParse(s).success).toBe(true));
  it.each(["ab", "-acme", "acme-", "has space", "UPPER!", "a".repeat(49)])("rejects %s", (s) =>
    expect(slugSchema.safeParse(s).success).toBe(false),
  );
  it("lowercases input", () => expect(slugSchema.parse("MySasun")).toBe("mysasun"));
});

describe("suggestSlug", () => {
  it("derives a valid slug from a business name", () => {
    for (const name of ["My Sasun African Market", "Café Ọ̀ṣun", "A", "!!!", "Ade & Sons Ltd."]) {
      const s = suggestSlug(name);
      expect(slugSchema.safeParse(s).success, `${name} → ${s}`).toBe(true);
    }
    expect(suggestSlug("My Sasun African Market")).toBe("my-sasun-african-market");
  });
});

describe("createOrganizationSchema", () => {
  it("applies defaults and rejects bad timezone/currency", () => {
    expect(createOrganizationSchema.parse({ name: "Acme", slug: "acme" })).toMatchObject({ timezone: "UTC", defaultCurrency: "USD" });
    expect(createOrganizationSchema.safeParse({ name: "Acme", slug: "acme", timezone: "Mars/Base" }).success).toBe(false);
    expect(createOrganizationSchema.safeParse({ name: "Acme", slug: "acme", defaultCurrency: "XXX" }).success).toBe(false);
  });
});

describe("parseInput", () => {
  it("returns field-keyed messages", () => {
    try {
      parseInput(createOrganizationSchema, { name: "", slug: "x" });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect(Object.keys((e as ValidationError).fieldErrors!)).toEqual(expect.arrayContaining(["name", "slug"]));
    }
  });
});

describe("audit diff", () => {
  it("captures only changed keys", () => {
    const d = new Date("2026-01-01");
    expect(diff({ a: 1, b: "x", c: d }, { a: 1, b: "y", c: new Date("2026-01-01") })).toEqual({ b: { from: "x", to: "y" } });
    expect(diff<{ a: string | null }>({ a: null }, { a: "set" })).toEqual({ a: { from: null, to: "set" } });
  });
});
