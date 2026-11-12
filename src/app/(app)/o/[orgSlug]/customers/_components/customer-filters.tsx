"use client";
import { LayoutGrid, List, Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import { NativeSelect } from "@/components/ui/input";
import { useUrlParams } from "@/components/app/use-url-params";
import { cn } from "@/lib/utils";
import { SOURCE_OPTIONS } from "./labels";

const VIEWS = [
  { key: "active", label: "Active" },
  { key: "provisional", label: "Provisional" },
  { key: "archived", label: "Archived" },
  { key: "all", label: "All" },
];

export function CustomerFilters({
  members,
  tags,
  canSeeAll,
}: {
  members: { membershipId: string; name: string }[];
  tags: { id: string; name: string }[];
  canSeeAll: boolean;
}) {
  const { params, set, pending } = useUrlParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  useEffect(() => {
    const t = setTimeout(() => {
      if ((params.get("q") ?? "") !== q) set({ q: q || null }, { resetPage: true, replace: true });
    }, 300);
    return () => clearTimeout(t);
  }, [q, params, set]);

  const view = params.get("view") ?? "active";
  const layout = params.get("layout") ?? "list";
  const active = ["owner", "tag", "source", "type", "marketing"].filter((k) => params.get(k));

  return (
    <div className="space-y-3" aria-busy={pending}>
      <div className="flex flex-wrap items-center gap-2">
        <nav className="flex rounded-md border bg-card p-0.5" aria-label="Customer views">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              type="button"
              aria-pressed={view === v.key}
              onClick={() => set({ view: v.key === "active" ? null : v.key }, { resetPage: true })}
              className={cn("rounded px-3 py-1 text-sm", view === v.key ? "bg-primary text-white" : "text-ink/70 hover:bg-muted")}
            >
              {v.label}
            </button>
          ))}
        </nav>
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, email, phone, @handle or CUS-number"
            aria-label="Search customers"
            className="h-9 w-full rounded-md border bg-card pl-8 pr-3 text-sm"
          />
        </div>
        <NativeSelect aria-label="Sort" className="w-auto" value={params.get("sort") ?? "created_desc"} onChange={(e) => set({ sort: e.target.value === "created_desc" ? null : e.target.value })}>
          <option value="created_desc">Newest first</option>
          <option value="created_asc">Oldest first</option>
          <option value="name_asc">Name A–Z</option>
          <option value="name_desc">Name Z–A</option>
          <option value="activity_desc">Recent activity</option>
          <option value="updated_desc">Recently updated</option>
        </NativeSelect>
        <div className="flex rounded-md border bg-card p-0.5">
          <button type="button" aria-label="List view" aria-pressed={layout === "list"} onClick={() => set({ layout: null })} className={cn("rounded p-1.5", layout === "list" ? "bg-muted" : "")}><List className="size-4" /></button>
          <button type="button" aria-label="Card view" aria-pressed={layout === "cards"} onClick={() => set({ layout: "cards" })} className={cn("rounded p-1.5", layout === "cards" ? "bg-muted" : "")}><LayoutGrid className="size-4" /></button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <NativeSelect aria-label="Filter by owner" className="h-8 w-auto text-xs" value={params.get("owner") ?? ""} onChange={(e) => set({ owner: e.target.value }, { resetPage: true })}>
          <option value="">Any owner</option>
          <option value="me">Owned by me</option>
          {canSeeAll && <option value="unassigned">Unassigned</option>}
          {canSeeAll && members.map((m) => <option key={m.membershipId} value={m.membershipId}>{m.name}</option>)}
        </NativeSelect>
        <NativeSelect aria-label="Filter by tag" className="h-8 w-auto text-xs" value={params.get("tag") ?? ""} onChange={(e) => set({ tag: e.target.value }, { resetPage: true })}>
          <option value="">Any tag</option>
          {tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </NativeSelect>
        <NativeSelect aria-label="Filter by source" className="h-8 w-auto text-xs" value={params.get("source") ?? ""} onChange={(e) => set({ source: e.target.value }, { resetPage: true })}>
          <option value="">Any source</option>
          {SOURCE_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </NativeSelect>
        <NativeSelect aria-label="Filter by type" className="h-8 w-auto text-xs" value={params.get("type") ?? ""} onChange={(e) => set({ type: e.target.value }, { resetPage: true })}>
          <option value="">Any type</option>
          <option value="person">People</option>
          <option value="business">Businesses</option>
        </NativeSelect>
        <NativeSelect aria-label="Filter by email marketing" className="h-8 w-auto text-xs" value={params.get("marketing") ?? ""} onChange={(e) => set({ marketing: e.target.value }, { resetPage: true })}>
          <option value="">Any marketing status</option>
          <option value="subscribed">Subscribed</option>
          <option value="unsubscribed">Unsubscribed</option>
          <option value="unknown">No consent</option>
        </NativeSelect>
        {active.length > 0 && (
          <button type="button" onClick={() => set(Object.fromEntries(active.map((k) => [k, null])), { resetPage: true })} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
            <X className="size-3" /> Clear filters
          </button>
        )}
      </div>
    </div>
  );
}
