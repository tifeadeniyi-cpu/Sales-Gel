import "server-only";
import { and, asc, count, desc, eq, ilike, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import { audit, diff } from "@/server/audit/audit";
import type { OrgContext } from "@/server/authz/context";
import type { Tx } from "@/server/db/client";
import { isUniqueViolation } from "@/server/db/errors";
import { withTenant } from "@/server/db/tenant";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { parseInput } from "@/server/validate";
import { newId } from "@/lib/ids";
import { parseMoney } from "@/lib/money";
import { orderItems, orders, products, productVariants, stores } from "./schema";
import { productInputSchema, type ProductInput } from "./validation";

function need(ctx: OrgContext, p: "products.read" | "products.write") {
  if (!ctx.permissions.has(p)) throw new ForbiddenError(undefined, p);
}

/** Every org has exactly one manual store (enforced by a partial unique index). */
export async function ensureManualStore(tx: Tx, ctx: Pick<OrgContext, "orgId" | "orgName" | "defaultCurrency">) {
  const [s] = await tx.select({ id: stores.id }).from(stores).where(and(eq(stores.organizationId, ctx.orgId), eq(stores.provider, "manual")));
  if (s) return s.id;
  const [created] = await tx
    .insert(stores)
    .values({ organizationId: ctx.orgId, name: `${ctx.orgName} (manual)`, provider: "manual", currency: ctx.defaultCurrency })
    .onConflictDoNothing()
    .returning({ id: stores.id });
  if (created) return created.id;
  const [again] = await tx.select({ id: stores.id }).from(stores).where(and(eq(stores.organizationId, ctx.orgId), eq(stores.provider, "manual")));
  return again.id;
}

function parseVariants(data: ReturnType<typeof productInputSchema.parse>, currency: string) {
  return data.variants.map((v, i) => {
    const price = parseMoney(v.price, currency);
    if (price === null || price < 0) throw new ValidationError("Enter a valid price.", { [`variants.${i}.price`]: ["Enter a valid price, e.g. 12.99"] });
    return { ...v, priceAmount: price, position: i };
  });
}

export async function createProduct(ctx: OrgContext, input: ProductInput) {
  need(ctx, "products.write");
  const data = parseInput(productInputSchema, input);
  const currency = data.currency ?? ctx.defaultCurrency;
  const variants = parseVariants(data, currency);
  try {
    return await withTenant(ctx, async (tx) => {
      const storeId = await ensureManualStore(tx, ctx);
      const id = newId();
      await tx.insert(products).values({ id, organizationId: ctx.orgId, storeId, name: data.name, description: data.description, category: data.category, brand: data.brand, imageUrl: data.imageUrl ?? null, status: data.status, tags: data.tags });
      await tx.insert(productVariants).values(
        variants.map((v) => ({ organizationId: ctx.orgId, productId: id, name: v.name, sku: v.sku, priceAmount: v.priceAmount, currency, inventoryQuantity: v.inventoryQuantity ?? null, inventorySyncedAt: v.inventoryQuantity !== null && v.inventoryQuantity !== undefined ? new Date() : null, position: v.position })),
      );
      await audit(tx, ctx, { action: "product.created", entityType: "product", entityId: id, metadata: { name: data.name, variants: variants.length } });
      return { id };
    });
  } catch (err) {
    if (isUniqueViolation(err, "product_variants_sku_uq")) throw new ValidationError("SKU already used.", { sku: ["That SKU is already used by another product."] });
    throw err;
  }
}

/**
 * Updates a product. Variants are matched by id: changed ones are updated, removed ones are
 * archived (never deleted — past orders keep their snapshot), new ones are inserted.
 * Price changes never affect existing orders.
 */
export async function updateProduct(ctx: OrgContext, id: string, input: ProductInput) {
  need(ctx, "products.write");
  const data = parseInput(productInputSchema, input);
  try {
    return await withTenant(ctx, async (tx) => {
      const [before] = await tx.select().from(products).where(and(eq(products.organizationId, ctx.orgId), eq(products.id, id))).for("update");
      if (!before) throw new NotFoundError("Product not found.");
      const existing = await tx.select().from(productVariants).where(and(eq(productVariants.productId, id), ne(productVariants.status, "archived")));
      const currency = existing[0]?.currency ?? data.currency ?? ctx.defaultCurrency;
      const variants = parseVariants(data, currency);
      const patch = { name: data.name, description: data.description, category: data.category, brand: data.brand, imageUrl: data.imageUrl ?? null, status: data.status, tags: data.tags };
      await tx.update(products).set(patch).where(eq(products.id, id));
      const keep = new Set(variants.filter((v) => v.id).map((v) => v.id!));
      for (const e of existing) if (!keep.has(e.id)) await tx.update(productVariants).set({ status: "archived" }).where(eq(productVariants.id, e.id));
      for (const v of variants) {
        const values = { name: v.name, sku: v.sku, priceAmount: v.priceAmount, inventoryQuantity: v.inventoryQuantity ?? null, position: v.position };
        if (v.id) {
          const e = existing.find((x) => x.id === v.id);
          if (!e) throw new ValidationError("A variant was removed by someone else. Refresh and try again.");
          const invChanged = (e.inventoryQuantity ?? null) !== (v.inventoryQuantity ?? null);
          await tx.update(productVariants).set({ ...values, ...(invChanged ? { inventorySyncedAt: new Date() } : {}) }).where(eq(productVariants.id, v.id));
        } else {
          await tx.insert(productVariants).values({ organizationId: ctx.orgId, productId: id, currency, ...values, inventorySyncedAt: v.inventoryQuantity !== null && v.inventoryQuantity !== undefined ? new Date() : null });
        }
      }
      await audit(tx, ctx, { action: "product.updated", entityType: "product", entityId: id, changes: diff(before, patch), metadata: { variants: variants.length } });
      return { id };
    });
  } catch (err) {
    if (isUniqueViolation(err, "product_variants_sku_uq")) throw new ValidationError("SKU already used.", { sku: ["That SKU is already used by another product."] });
    throw err;
  }
}

export async function setProductStatus(ctx: OrgContext, id: string, status: "active" | "draft" | "archived") {
  need(ctx, "products.write");
  return withTenant(ctx, async (tx) => {
    const [p] = await tx.update(products).set({ status }).where(and(eq(products.organizationId, ctx.orgId), eq(products.id, id))).returning();
    if (!p) throw new NotFoundError("Product not found.");
    await audit(tx, ctx, { action: "product.status_changed", entityType: "product", entityId: id, metadata: { status } });
  });
}

export async function listProducts(ctx: OrgContext, opts: { q?: string; status?: string; category?: string } = {}) {
  need(ctx, "products.read");
  return withTenant(ctx, async (tx) => {
    const conds: (SQL | undefined)[] = [eq(products.organizationId, ctx.orgId)];
    if (opts.status && opts.status !== "all") conds.push(eq(products.status, opts.status));
    else if (!opts.status) conds.push(ne(products.status, "archived"));
    if (opts.category) conds.push(eq(products.category, opts.category));
    if (opts.q) {
      const like = `%${opts.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
      conds.push(or(ilike(products.name, like), sql`exists (select 1 from ${productVariants} v where v.product_id = ${products.id} and v.sku ilike ${like})`));
    }
    const rows = await tx.select().from(products).where(and(...conds)).orderBy(asc(products.name)).limit(500);
    const ids = rows.map((r) => r.id);
    const vs = ids.length ? await tx.select().from(productVariants).where(and(inArray(productVariants.productId, ids), ne(productVariants.status, "archived"))).orderBy(asc(productVariants.position)) : [];
    return rows.map((p) => {
      const pv = vs.filter((v) => v.productId === p.id);
      const prices = pv.map((v) => v.priceAmount);
      const tracked = pv.filter((v) => v.inventoryQuantity !== null);
      return {
        ...p,
        variantCount: pv.length,
        currency: pv[0]?.currency ?? ctx.defaultCurrency,
        minPrice: prices.length ? Math.min(...prices) : null,
        maxPrice: prices.length ? Math.max(...prices) : null,
        inventory: tracked.length ? tracked.reduce((a, v) => a + (v.inventoryQuantity ?? 0), 0) : null,
        skus: pv.map((v) => v.sku).filter(Boolean) as string[],
      };
    });
  });
}

export async function listCategories(ctx: OrgContext) {
  need(ctx, "products.read");
  return withTenant(ctx, async (tx) =>
    (await tx.selectDistinct({ c: products.category }).from(products).where(and(eq(products.organizationId, ctx.orgId), sql`${products.category} is not null`)).orderBy(asc(products.category))).map((r) => r.c!),
  );
}

export async function getProduct(ctx: OrgContext, id: string) {
  need(ctx, "products.read");
  return withTenant(ctx, async (tx) => {
    const [p] = await tx.select().from(products).where(and(eq(products.organizationId, ctx.orgId), eq(products.id, id)));
    if (!p) return null;
    const variants = await tx.select().from(productVariants).where(eq(productVariants.productId, id)).orderBy(asc(productVariants.position));
    const financials = ctx.permissions.has("orders.financials") && ctx.permissions.has("orders.read");
    const sales = ctx.permissions.has("orders.read")
      ? await tx
          .select({
            currency: orders.currency,
            orders: sql<number>`count(distinct ${orders.id})::int`,
            units: sql<number>`coalesce(sum(${orderItems.quantity}),0)::int`,
            revenue: sql<number>`coalesce(sum(${orderItems.lineTotalAmount}),0)::bigint`,
          })
          .from(orderItems)
          .innerJoin(orders, eq(orders.id, orderItems.orderId))
          .where(and(eq(orderItems.organizationId, ctx.orgId), eq(orderItems.productId, id), ne(orders.orderStatus, "cancelled")))
          .groupBy(orders.currency)
      : [];
    const recent = ctx.permissions.has("orders.read")
      ? await tx
          .select({ orderId: orders.id, number: orders.number, placedAt: orders.placedAt, quantity: orderItems.quantity, variantName: orderItems.variantName, lineTotal: orderItems.lineTotalAmount, currency: orders.currency, status: orders.orderStatus })
          .from(orderItems)
          .innerJoin(orders, eq(orders.id, orderItems.orderId))
          .where(and(eq(orderItems.organizationId, ctx.orgId), eq(orderItems.productId, id)))
          .orderBy(desc(orders.placedAt))
          .limit(20)
      : [];
    return {
      ...p,
      variants,
      sales: sales.map((s) => ({ ...s, revenue: financials ? Number(s.revenue) : null })),
      recentOrders: recent.map((r) => ({ ...r, lineTotal: financials ? r.lineTotal : null })),
    };
  });
}
export type ProductDetail = NonNullable<Awaited<ReturnType<typeof getProduct>>>;

/** Variant search for the order wizard and lead product picker. */
export async function searchVariants(ctx: OrgContext, q: string, limit = 12) {
  need(ctx, "products.read");
  const like = `%${q.trim().replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  return withTenant(ctx, async (tx) => {
    const rows = await tx
      .select({ id: productVariants.id, productId: products.id, productName: products.name, variantName: productVariants.name, sku: productVariants.sku, priceAmount: productVariants.priceAmount, currency: productVariants.currency, inventoryQuantity: productVariants.inventoryQuantity })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(and(eq(productVariants.organizationId, ctx.orgId), eq(productVariants.status, "active"), eq(products.status, "active"), or(ilike(products.name, like), ilike(productVariants.sku, like), ilike(productVariants.name, like))))
      .orderBy(asc(products.name), asc(productVariants.position))
      .limit(limit);
    return rows;
  });
}

export async function countProducts(ctx: OrgContext) {
  return withTenant(ctx, async (tx) => (await tx.select({ n: count() }).from(products).where(and(eq(products.organizationId, ctx.orgId), eq(products.status, "active"))))[0].n);
}
