import { createHmac, randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { decryptJson, encryptJson, encryptionConfigured, safeEqual } from "@/server/crypto";
import { missingScopes, normalizeShopDomain, verifyCallbackHmac, verifyWebhookHmac } from "@/domains/integrations/shopify/client";

beforeAll(() => {
  process.env.INTEGRATIONS_ENCRYPTION_KEY = randomBytes(32).toString("base64");
});

describe("credential encryption", () => {
  it("round-trips and never stores plaintext", () => {
    expect(encryptionConfigured()).toBe(true);
    const sealed = encryptJson({ apiKey: "rk_test_secret123" });
    expect(sealed).toMatch(/^v1:/);
    expect(sealed).not.toContain("rk_test");
    expect(decryptJson<{ apiKey: string }>(sealed).apiKey).toBe("rk_test_secret123");
  });
  it("detects tampering", () => {
    const sealed = encryptJson({ a: 1 });
    const parts = sealed.split(":");
    parts[3] = Buffer.from("tampered!").toString("base64");
    expect(() => decryptJson(parts.join(":"))).toThrow();
  });
  it("rejects a wrong-size key", () => {
    const prev = process.env.INTEGRATIONS_ENCRYPTION_KEY;
    process.env.INTEGRATIONS_ENCRYPTION_KEY = Buffer.from("short").toString("base64");
    expect(encryptionConfigured()).toBe(false);
    process.env.INTEGRATIONS_ENCRYPTION_KEY = prev;
  });
  it("safeEqual handles different lengths", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});

describe("shopify helpers", () => {
  it("normalizes store domains", () => {
    expect(normalizeShopDomain("My-Store")).toBe("my-store.myshopify.com");
    expect(normalizeShopDomain("https://my-store.myshopify.com/admin")).toBe("my-store.myshopify.com");
    expect(normalizeShopDomain("https://admin.shopify.com/store/my-store/orders")).toBe("my-store.myshopify.com");
    expect(normalizeShopDomain("evil.com")).toBeNull();
    expect(normalizeShopDomain("my-store.myshopify.com.evil.com")).toBeNull();
    expect(normalizeShopDomain("")).toBeNull();
  });

  it("verifies webhook HMACs over the raw body", () => {
    const body = JSON.stringify({ id: 1, note: "héllo" });
    const good = createHmac("sha256", "app-secret").update(body).digest("base64");
    expect(verifyWebhookHmac(body, good, "app-secret")).toBe(true);
    expect(verifyWebhookHmac(body + " ", good, "app-secret")).toBe(false);
    expect(verifyWebhookHmac(body, good, "other-secret")).toBe(false);
    expect(verifyWebhookHmac(body, null, "app-secret")).toBe(false);
  });

  it("verifies OAuth callback HMACs over sorted params", () => {
    const p = new URLSearchParams({ shop: "s.myshopify.com", code: "abc", state: "n1", timestamp: "1700000000", host: "aG9zdA" });
    const msg = [...p.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("&");
    p.set("hmac", createHmac("sha256", "app-secret").update(msg).digest("hex"));
    expect(verifyCallbackHmac(p, "app-secret")).toBe(true);
    p.set("code", "changed");
    expect(verifyCallbackHmac(p, "app-secret")).toBe(false);
  });

  it("reports missing scopes (write implies read)", () => {
    expect(missingScopes("read_orders,read_products,read_customers")).toEqual([]);
    expect(missingScopes("read_orders,write_products")).toEqual(["read_customers"]);
  });
});
