export interface ProductFormValue {
  id?: string;
  name: string;
  description: string;
  category: string;
  brand: string;
  imageUrl: string;
  status: "active" | "draft" | "archived";
  currency: string;
  tags: string;
  variants: { id?: string; name: string; sku: string; price: string; inventoryQuantity: string }[];
}

export const blankVariant = () => ({ name: "Default", sku: "", price: "", inventoryQuantity: "" });

export function emptyProduct(currency: string): ProductFormValue {
  return { name: "", description: "", category: "", brand: "", imageUrl: "", status: "active", currency, tags: "", variants: [blankVariant()] };
}
