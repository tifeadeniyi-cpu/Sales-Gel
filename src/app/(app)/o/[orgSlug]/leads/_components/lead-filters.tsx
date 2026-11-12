"use client";
import { Columns3, List, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { NativeSelect } from "@/components/ui/input";
import { useUrlParams } from "@/components/app/use-url-params";
import { cn } from "@/lib/utils";

export function LeadFilters({ pipelines, members, canSeeAll }: { pipelines: { id: string; name: string }[]; members: { membershipId: string; name: string }[]; canSeeAll: boolean }) {
  const { params, set } = useUrlParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  useEffect(() => {
    const t = setTimeout(() => { if ((params.get("q") ?? "") !== q) set({ q: q || null }, { replace: true }); }, 300);
    return () => clearTimeout(t);
  }, [q, params, set]);
  const view = params.get("view") ?? "board";
  return (
    <div className="flex flex-wrap items-center gap-2">
      {pipelines.length > 1 && (
        <NativeSelect aria-label="Pipeline" className="w-auto" value={params.get("pipeline") ?? pipelines[0]?.id} onChange={(e) => set({ pipeline: e.target.value })}>
          {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </NativeSelect>
      )}
      <div className="relative min-w-56 flex-1">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search leads or customers" aria-label="Search leads" className="h-9 w-full rounded-md border bg-card pl-8 pr-3 text-sm" />
      </div>
      <NativeSelect aria-label="Filter by representative" className="h-9 w-auto text-sm" value={params.get("owner") ?? ""} onChange={(e) => set({ owner: e.target.value })}>
        <option value="">Everyone</option>
        <option value="me">My leads</option>
        {canSeeAll && <option value="unassigned">Unassigned</option>}
        {canSeeAll && members.map((m) => <option key={m.membershipId} value={m.membershipId}>{m.name}</option>)}
      </NativeSelect>
      {view === "list" && (
        <NativeSelect aria-label="Status" className="h-9 w-auto text-sm" value={params.get("status") ?? "open"} onChange={(e) => set({ status: e.target.value === "open" ? null : e.target.value })}>
          <option value="open">Open</option><option value="won">Won</option><option value="lost">Lost</option><option value="all">All</option>
        </NativeSelect>
      )}
      <div className="flex rounded-md border bg-card p-0.5">
        <button type="button" aria-label="Board view" aria-pressed={view === "board"} onClick={() => set({ view: null })} className={cn("rounded p-1.5", view === "board" && "bg-muted")}><Columns3 className="size-4" /></button>
        <button type="button" aria-label="List view" aria-pressed={view === "list"} onClick={() => set({ view: "list" })} className={cn("rounded p-1.5", view === "list" && "bg-muted")}><List className="size-4" /></button>
      </div>
    </div>
  );
}
