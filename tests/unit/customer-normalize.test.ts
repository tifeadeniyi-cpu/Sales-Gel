import { describe, expect, it } from "vitest";
import { deriveDisplayName, normalizeEmail, normalizeHandle, normalizePhone } from "@/domains/customers/normalize";

describe("identifier normalization", () => {
  it("emails", () => expect(normalizeEmail("  Ada@Example.COM ")).toBe("ada@example.com"));
  it("phones to E.164 regardless of formatting", () => {
    expect(normalizePhone("(214) 555-0101")).toBe("+12145550101");
    expect(normalizePhone("+1 214 555 0101")).toBe("+12145550101");
    expect(normalizePhone("+234 803 123 4567")).toBe("+2348031234567");
    expect(normalizePhone("123")).toBeNull();
  });
  it("handles", () => {
    expect(normalizeHandle("@AdaCooks")).toBe("adacooks");
    expect(normalizeHandle("https://www.instagram.com/AdaCooks/")).toBe("adacooks");
  });
});

describe("deriveDisplayName", () => {
  it("prefers person name, then company, then identifiers", () => {
    expect(deriveDisplayName({ firstName: "Ada", lastName: "Obi", companyName: "X" })).toBe("Ada Obi");
    expect(deriveDisplayName({ type: "business", firstName: "Ada", companyName: "Lagos Foods" })).toBe("Lagos Foods");
    expect(deriveDisplayName({ email: "a@b.c" })).toBe("a@b.c");
    expect(deriveDisplayName({ handle: "@Tola" })).toBe("@tola");
    expect(deriveDisplayName({})).toBe("Unnamed customer");
  });
});
