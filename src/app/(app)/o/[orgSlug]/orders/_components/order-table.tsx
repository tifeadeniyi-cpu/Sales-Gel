"use client";
import { useRouter } from "next/navigation";
import { useUrlParams } from "@/components/app/use-url-params";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/money";
import { formatRelative } from "@/lib/utils";
import { FULFILLMENT_STATUS, ORDER_STATUS, PAYMENT_STATUS, SOURCE_LABELS } from "./labels";

export interface OrderRowView {
  id: string; number: number; source: string; currency: string; totalAmount: number | null; paymentStatus: string; orderStatus: string;
  fulfillmentStatus: string; placedAt: Date; customerName: string | null; assignedName: string | null; itemCount: number;
}

export function OrderTable({ rows, linkBase }: { rows: OrderRowView[]; linkBase?: string }) {
  const { set } = useUrlParams();
  const router = useRouter();
  const open = (id: string) => (linkBase ? router.push(`${linkBase}/${id}`) : set({ open: id }));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/50">
          <tr>{["Order", "Customer", "Items", "Total", "Payment", "Fulfillment", "Assigned", "Placed"].map((h) => <th key={h} className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r) => (
            <tr key={r.id} className="cursor-pointer hover:bg-muted/30" onClick={() => open(r.id)}>
              <td className="px-3 py-2.5">
                <button type="button" className="font-medium hover:underline">ORD-{r.number}</button>
                <div className="text-xs text-muted-foreground">{SOURCE_LABELS[r.source] ?? r.source}{r.orderStatus !== "open" && <> · <Badge tone={ORDER_STATUS[r.orderStatus].tone}>{ORDER_STATUS[r.orderStatus].label}</Badge></>}</div>
              </td>
              <td className="px-3 py-2.5">{r.customerName ?? <span className="text-muted-foreground">No customer</span>}</td>
              <td className="px-3 py-2.5">{r.itemCount}</td>
              <td className="px-3 py-2.5 font-medium">{r.totalAmount === null ? <span className="text-muted-foreground">Hidden</span> : formatMoney(r.totalAmount, r.currency)}</td>
              <td className="px-3 py-2.5"><Badge tone={PAYMENT_STATUS[r.paymentStatus].tone}>{PAYMENT_STATUS[r.paymentStatus].label}</Badge></td>
              <td className="px-3 py-2.5"><Badge tone={FULFILLMENT_STATUS[r.fulfillmentStatus].tone}>{FULFILLMENT_STATUS[r.fulfillmentStatus].label}</Badge></td>
              <td className="px-3 py-2.5">{r.assignedName ?? "Unassigned"}</td>
              <td className="px-3 py-2.5 text-xs text-muted-foreground">{formatRelative(r.placedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
