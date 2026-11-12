"use client";
import { useUrlParams } from "@/components/app/use-url-params";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/money";
import { formatRelative } from "@/lib/utils";
import { LEAD_STATUS, PRIORITY, STAGE_BAR } from "./labels";

export interface LeadRowView {
  id: string; number: number; title: string; status: string; valueAmount: number | null; currency: string; priority: string;
  expectedCloseDate: string | null; customerName: string | null; ownerName: string | null; createdAt: Date; stage: { name: string; color: string } | null;
}

export function LeadTable({ rows }: { rows: LeadRowView[] }) {
  const { set } = useUrlParams();
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/50">
          <tr>{["Lead", "Customer", "Stage", "Value", "Priority", "Representative", "Expected close", "Created"].map((h) => <th key={h} className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r) => (
            <tr key={r.id} className="cursor-pointer hover:bg-muted/30" onClick={() => set({ open: r.id })}>
              <td className="px-3 py-2.5"><button type="button" className="text-left font-medium hover:underline">{r.title}</button><div className="text-xs text-muted-foreground">LEAD-{r.number}</div></td>
              <td className="px-3 py-2.5">{r.customerName ?? "—"}</td>
              <td className="px-3 py-2.5">
                <span className="inline-flex items-center gap-1.5"><span className={`size-2 rounded-full ${STAGE_BAR[r.stage?.color ?? "teal"]}`} />{r.stage?.name}</span>
                {r.status !== "open" && <Badge tone={LEAD_STATUS[r.status].tone} className="ml-1">{LEAD_STATUS[r.status].label}</Badge>}
              </td>
              <td className="px-3 py-2.5 font-medium">{formatMoney(r.valueAmount, r.currency)}</td>
              <td className="px-3 py-2.5"><Badge tone={PRIORITY[r.priority].tone}>{PRIORITY[r.priority].label}</Badge></td>
              <td className="px-3 py-2.5">{r.ownerName ?? "Unassigned"}</td>
              <td className="px-3 py-2.5">{r.expectedCloseDate ?? "—"}</td>
              <td className="px-3 py-2.5 text-xs text-muted-foreground">{formatRelative(r.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
