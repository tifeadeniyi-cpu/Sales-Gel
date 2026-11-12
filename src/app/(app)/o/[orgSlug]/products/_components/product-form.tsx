"use client";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { FormField } from "@/components/app/form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { CURRENCY_OPTIONS } from "../../customers/_components/labels";
import { createProductAction, updateProductAction } from "../actions";
import { blankVariant, type ProductFormValue } from "./product-defaults";

export function ProductForm({ orgSlug, initial, currencyLocked, categories }: { orgSlug: string; initial: ProductFormValue; currencyLocked?: boolean; categories: string[] }) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const setVariant = (i: number, patch: Partial<ProductFormValue["variants"][number]>) => setV({ ...v, variants: v.variants.map((x, j) => (j === i ? { ...x, ...patch } : x)) });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const input = {
        name: v.name,
        description: v.description || null,
        category: v.category || null,
        brand: v.brand || null,
        imageUrl: v.imageUrl || null,
        status: v.status,
        currency: v.currency,
        tags: v.tags.split(",").map((t) => t.trim()).filter(Boolean),
        variants: v.variants.map((x) => ({ id: x.id, name: x.name || "Default", sku: x.sku || null, price: x.price, inventoryQuantity: x.inventoryQuantity === "" ? null : x.inventoryQuantity })),
      };
      const res = v.id ? await updateProductAction(orgSlug, v.id, input as never) : await createProductAction(orgSlug, input as never);
      if (res.ok) {
        toast.success(v.id ? "Product saved" : "Product created");
        const id = v.id ?? (res.data as { id: string }).id;
        router.push(`/o/${orgSlug}/products/${id}`);
        router.refresh();
      } else {
        setErrors(res.fieldErrors ?? {});
        setFormError(res.error);
      }
    });
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      {formError && <p className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">{formError}</p>}
      <Card>
        <CardHeader><CardTitle>Details</CardTitle></CardHeader>
        <CardContent className="grid gap-4">
          <FormField label="Product name" htmlFor="p-name" required errors={errors.name}>
            <Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="e.g. Ankara wrap dress" />
          </FormField>
          <FormField label="Description" htmlFor="p-desc" errors={errors.description}>
            <Textarea rows={3} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField label="Category" htmlFor="p-cat" errors={errors.category}>
              <Input list="p-categories" value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })} />
            </FormField>
            <datalist id="p-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
            <FormField label="Brand" htmlFor="p-brand" errors={errors.brand}>
              <Input value={v.brand} onChange={(e) => setV({ ...v, brand: e.target.value })} />
            </FormField>
            <FormField label="Status" htmlFor="p-status">
              <NativeSelect value={v.status} onChange={(e) => setV({ ...v, status: e.target.value as ProductFormValue["status"] })}>
                <option value="active">Active</option>
                <option value="draft">Draft</option>
                <option value="archived">Archived</option>
              </NativeSelect>
            </FormField>
          </div>
          <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
            <FormField label="Image URL" htmlFor="p-img" errors={errors.imageUrl} hint="Link to a hosted image. File uploads arrive with storage in Phase 5.">
              <Input value={v.imageUrl} onChange={(e) => setV({ ...v, imageUrl: e.target.value })} placeholder="https://…" />
            </FormField>
            <FormField label="Currency" htmlFor="p-cur" hint={currencyLocked ? "Fixed after creation" : undefined}>
              <NativeSelect value={v.currency} disabled={currencyLocked} onChange={(e) => setV({ ...v, currency: e.target.value })}>
                {CURRENCY_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </NativeSelect>
            </FormField>
          </div>
          <FormField label="Tags" htmlFor="p-tags" hint="Comma-separated">
            <Input value={v.tags} onChange={(e) => setV({ ...v, tags: e.target.value })} />
          </FormField>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Variants & pricing</CardTitle>
          <Button type="button" variant="outline" size="sm" onClick={() => setV({ ...v, variants: [...v.variants, { ...blankVariant(), name: "" }] })}><Plus /> Add variant</Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {errors.variants && <p className="text-xs text-danger" role="alert">{errors.variants[0]}</p>}
          {errors.sku && <p className="text-xs text-danger" role="alert">{errors.sku[0]}</p>}
          <div className="hidden grid-cols-[1fr_9rem_8rem_7rem_2.5rem] gap-2 text-xs font-medium text-muted-foreground sm:grid">
            <span>Variant</span><span>SKU</span><span>Price</span><span>Stock</span><span />
          </div>
          {v.variants.map((x, i) => (
            <div key={x.id ?? i} className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_9rem_8rem_7rem_2.5rem]">
              <Input aria-label={`Variant ${i + 1} name`} value={x.name} onChange={(e) => setVariant(i, { name: e.target.value })} placeholder="e.g. Small / Red" />
              <Input aria-label={`Variant ${i + 1} SKU`} value={x.sku} onChange={(e) => setVariant(i, { sku: e.target.value })} placeholder="SKU" />
              <Input aria-label={`Variant ${i + 1} price`} inputMode="decimal" value={x.price} onChange={(e) => setVariant(i, { price: e.target.value })} placeholder="0.00" aria-invalid={!!errors[`variants.${i}.price`]} />
              <Input aria-label={`Variant ${i + 1} stock`} inputMode="numeric" value={x.inventoryQuantity} onChange={(e) => setVariant(i, { inventoryQuantity: e.target.value })} placeholder="Not tracked" />
              <Button type="button" variant="ghost" size="icon" aria-label={`Remove variant ${i + 1}`} disabled={v.variants.length === 1} onClick={() => setV({ ...v, variants: v.variants.filter((_, j) => j !== i) })}><Trash2 /></Button>
              {errors[`variants.${i}.price`] && <p className="col-span-full text-xs text-danger">{errors[`variants.${i}.price`][0]}</p>}
            </div>
          ))}
          <p className="text-xs text-muted-foreground">Removing a variant archives it. Past orders keep the name, SKU and price they were sold at.</p>
        </CardContent>
      </Card>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : v.id ? "Save product" : "Create product"}</Button>
      </div>
    </form>
  );
}
