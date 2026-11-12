"use client";
import { useRouter } from "next/navigation";
import { useUrlParams } from "@/components/app/use-url-params";
import { Badge } from "@/components/ui/badge";
import { CHANNEL_LABELS } from "@/domains/support/validation";
import { formatRelative } from "@/lib/utils";
import { CATEGORY_TONE, PRIORITY } from "./labels";

export interface TicketRowView {
  id: string; number: number; subject: string; priority: string; channel: string; statusCategory: string; statusName: string;
  customerName: string | null; assigneeName: string | null; typeName: string | null; lastActivityAt: Date; createdAt: Date;
}

export function TicketTable({ rows, linkBase, compact }: { rows: TicketRowView[]; linkBase?: string; compact?: boolean }) {
  const { set } = useUrlParams();
  const router = useRouter();
  const open = (id: string) => (linkBase ? router.push(`${linkBase}/${id}`) : set({ open: id }));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/50">
          <tr>
            {["Ticket", "Customer", "Priority", "Status", ...(compact ? [] : ["Type", "Assignee"]), "Last activity"].map((h) => (
              <th key={h} className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r) => (
            <tr key={r.id} className="cursor-pointer hover:bg-muted/30" onClick={() => open(r.id)}>
              <td className="max-w-80 px-3 py-2.5">
                <button type="button" className="block truncate text-left font-medium hover:underline" onClick={(e) => { e.stopPropagation(); open(r.id); }}>
                  <span className="text-muted-foreground">TCK-{r.number}</span> {r.subject}
                </button>
                <div className="text-xs text-muted-foreground">{CHANNEL_LABELS[r.channel as keyof typeof CHANNEL_LABELS] ?? r.channel}</div>
              </td>
              <td className="px-3 py-2.5">{r.customerName ?? <span className="text-muted-foreground">No customer</span>}</td>
              <td className="px-3 py-2.5"><Badge tone={PRIORITY[r.priority]?.tone}>{PRIORITY[r.priority]?.label}</Badge></td>
              <td className="px-3 py-2.5"><Badge tone={CATEGORY_TONE[r.statusCategory]}>{r.statusName}</Badge></td>
              {!compact && <td className="px-3 py-2.5">{r.typeName ?? "—"}</td>}
              {!compact && <td className="px-3 py-2.5">{r.assigneeName ?? <span className="text-warning">Unassigned</span>}</td>}
              <td className="px-3 py-2.5 text-xs text-muted-foreground">{formatRelative(r.lastActivityAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
