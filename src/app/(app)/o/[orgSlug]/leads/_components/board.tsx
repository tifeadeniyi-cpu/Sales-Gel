"use client";
import { CalendarDays, GripVertical, UserRound } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useUrlParams } from "@/components/app/use-url-params";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { moveLeadAction } from "../actions";
import { LostReasonDialog } from "./lost-reason-dialog";
import { PRIORITY, STAGE_BAR } from "./labels";

export interface BoardLead {
  id: string;
  number: number;
  title: string;
  status: string;
  stageId: string;
  valueAmount: number | null;
  currency: string;
  priority: string;
  expectedCloseDate: string | null;
  customerName: string | null;
  ownerName: string | null;
}
export interface BoardStage {
  id: string;
  name: string;
  color: string;
  category: string;
  probability: number;
  leads: BoardLead[];
  totals: Record<string, number>;
}

function totalsText(t: Record<string, number>) {
  const parts = Object.entries(t).map(([cur, v]) => formatMoney(v, cur));
  return parts.length ? parts.join(" · ") : "—";
}

export function Board({ orgSlug, stages: initial, canWrite }: { orgSlug: string; stages: BoardStage[]; canWrite: boolean }) {
  const [stages, setStages] = useState(initial);
  // Re-sync when the server sends fresh data (React's "adjust state on prop change" pattern).
  const [source, setSource] = useState(initial);
  if (source !== initial) {
    setSource(initial);
    setStages(initial);
  }
  const { set, params } = useUrlParams();
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<{ stageId: string; beforeId: string | null } | null>(null);
  const [pendingLost, setPendingLost] = useState<{ leadId: string; stageId: string; beforeId: string | null; title: string } | null>(null);
  const [, start] = useTransition();
  const openId = params.get("open");

  const findLead = (id: string) => stages.flatMap((s) => s.leads).find((l) => l.id === id);

  const apply = (leadId: string, stageId: string, beforeId: string | null, lostReason?: string) => {
    const prev = stages;
    const lead = findLead(leadId);
    if (!lead) return;
    const target = stages.find((s) => s.id === stageId)!;
    // Optimistic move; rolled back if the server refuses (e.g. required fields missing).
    setStages((cur) =>
      cur.map((s) => {
        let leads = s.leads.filter((l) => l.id !== leadId);
        if (s.id === stageId) {
          const moved = { ...lead, stageId, status: target.category };
          const idx = beforeId ? leads.findIndex((l) => l.id === beforeId) : -1;
          leads = idx >= 0 ? [...leads.slice(0, idx), moved, ...leads.slice(idx)] : [...leads, moved];
        }
        return { ...s, leads };
      }),
    );
    start(async () => {
      const res = await moveLeadAction(orgSlug, leadId, stageId, beforeId, lostReason);
      if (!res.ok) {
        setStages(prev);
        toast.error(res.error);
      } else if (lead.stageId !== stageId) toast.success(`Moved to ${target.name}`);
    });
  };

  const drop = (stageId: string, beforeId: string | null) => {
    const id = dragId;
    setDragId(null);
    setOver(null);
    if (!id || id === beforeId) return;
    const lead = findLead(id);
    const target = stages.find((s) => s.id === stageId);
    if (!lead || !target) return;
    if (target.category === "lost" && lead.stageId !== stageId) {
      setPendingLost({ leadId: id, stageId, beforeId, title: lead.title });
      return;
    }
    apply(id, stageId, beforeId);
  };

  return (
    <>
      <div className="flex gap-3 overflow-x-auto pb-4" role="list" aria-label="Pipeline stages">
        {stages.map((s) => (
          <section
            key={s.id}
            role="listitem"
            aria-label={`${s.name}, ${s.leads.length} leads`}
            className={cn("flex w-72 shrink-0 flex-col rounded-lg border bg-muted/40", over?.stageId === s.id && "ring-2 ring-accent")}
            onDragOver={(e) => { if (!canWrite || !dragId) return; e.preventDefault(); if (over?.stageId !== s.id || over.beforeId !== null) setOver((o) => (o?.stageId === s.id ? o : { stageId: s.id, beforeId: null })); }}
            onDrop={(e) => { e.preventDefault(); drop(s.id, over?.stageId === s.id ? over.beforeId : null); }}
          >
            <header className="border-b px-3 py-2">
              <div className="flex items-center gap-2">
                <span className={cn("size-2.5 rounded-full", STAGE_BAR[s.color] ?? "bg-primary")} aria-hidden />
                <h2 className="flex-1 truncate text-sm font-semibold">{s.name}</h2>
                <span className="rounded-full bg-card px-1.5 text-xs text-muted-foreground">{s.leads.length}</span>
              </div>
              <div className="mt-0.5 truncate text-xs text-muted-foreground" title="Total estimated value (per currency)">
                {totalsText(s.totals)} {s.category === "open" && <span className="opacity-70">· {s.probability}%</span>}
              </div>
            </header>
            <ol className="flex min-h-24 flex-1 flex-col gap-2 p-2">
              {s.leads.map((l) => (
                <li
                  key={l.id}
                  draggable={canWrite}
                  onDragStart={(e) => { setDragId(l.id); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", l.id); }}
                  onDragEnd={() => { setDragId(null); setOver(null); }}
                  onDragOver={(e) => { if (!canWrite || !dragId) return; e.preventDefault(); e.stopPropagation(); if (over?.beforeId !== l.id) setOver({ stageId: s.id, beforeId: l.id }); }}
                  onDrop={(e) => { e.preventDefault(); e.stopPropagation(); drop(s.id, l.id); }}
                  className={cn(
                    "group rounded-md border bg-card shadow-xs transition",
                    dragId === l.id && "opacity-40",
                    over?.beforeId === l.id && dragId !== l.id && "border-t-2 border-t-accent",
                    openId === l.id && "ring-1 ring-primary",
                  )}
                >
                  <div className="flex items-start gap-1 p-2.5">
                    {canWrite && <GripVertical className="mt-0.5 size-4 shrink-0 cursor-grab text-muted-foreground opacity-0 group-hover:opacity-100" aria-hidden />}
                    <button type="button" onClick={() => set({ open: l.id })} className="min-w-0 flex-1 text-left" aria-label={`Open lead ${l.title}`}>
                      <div className="truncate text-sm font-medium">{l.title}</div>
                      <div className="truncate text-xs text-muted-foreground">{l.customerName ?? "No customer"} · LEAD-{l.number}</div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                        <span className="font-semibold">{l.valueAmount !== null ? formatMoney(l.valueAmount, l.currency) : "—"}</span>
                        {l.priority !== "medium" && <Badge tone={PRIORITY[l.priority].tone}>{PRIORITY[l.priority].label}</Badge>}
                        {l.expectedCloseDate && <span className="inline-flex items-center gap-0.5 text-muted-foreground"><CalendarDays className="size-3" />{l.expectedCloseDate}</span>}
                      </div>
                      <div className="mt-1.5 inline-flex items-center gap-1 text-xs text-muted-foreground"><UserRound className="size-3" />{l.ownerName ?? "Unassigned"}</div>
                    </button>
                  </div>
                  {canWrite && (
                    <div className="border-t px-2.5 py-1.5">
                      <select
                        aria-label={`Move ${l.title} to stage`}
                        value={s.id}
                        onChange={(e) => {
                          const target = stages.find((x) => x.id === e.target.value)!;
                          if (target.category === "lost") setPendingLost({ leadId: l.id, stageId: target.id, beforeId: null, title: l.title });
                          else apply(l.id, target.id, null);
                        }}
                        className="w-full bg-transparent text-xs text-muted-foreground focus:text-ink"
                      >
                        {stages.map((x) => <option key={x.id} value={x.id}>{x.id === s.id ? `Stage: ${x.name}` : `Move to ${x.name}`}</option>)}
                      </select>
                    </div>
                  )}
                </li>
              ))}
              {s.leads.length === 0 && <li className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">{canWrite ? "Drop leads here" : "No leads"}</li>}
            </ol>
          </section>
        ))}
      </div>
      <LostReasonDialog
        open={!!pendingLost}
        title={pendingLost?.title ?? ""}
        onCancel={() => setPendingLost(null)}
        onConfirm={(reason) => { if (pendingLost) apply(pendingLost.leadId, pendingLost.stageId, pendingLost.beforeId, reason); setPendingLost(null); }}
      />
    </>
  );
}
