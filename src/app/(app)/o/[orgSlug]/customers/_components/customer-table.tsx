"use client";
import { Archive, ArchiveRestore, Tag, UserRound, X } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { InlineSelect } from "@/components/app/inline-field";
import { useUrlParams } from "@/components/app/use-url-params";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { cn, formatRelative, initials } from "@/lib/utils";
import { bulkAction, updateCustomerFieldAction } from "../actions";
import { MARKETING, SOURCE_OPTIONS, STATUS, sourceLabel } from "./labels";
import { TagChip } from "./tag-chip";

export interface CustomerRowView {
  id: string;
  number: number;
  displayName: string;
  companyName: string | null;
  type: string;
  source: string | null;
  status: string;
  emailMarketing: string;
  ownerMembershipId: string | null;
  ownerName: string | null;
  primaryEmail: string | null;
  primaryPhone: string | null;
  createdAt: Date;
  lastActivityAt: Date | null;
  tags: { id: string; name: string; color: string }[];
}

interface Perms {
  write: boolean;
  archive: boolean;
  assign: boolean;
}

export function CustomerTable({ orgSlug, rows, members, tags, perms, layout }: { orgSlug: string; rows: CustomerRowView[]; members: { membershipId: string; name: string }[]; tags: { id: string; name: string }[]; perms: Perms; layout: "list" | "cards" }) {
  const { set, params } = useUrlParams();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const [tagDraft, setTagDraft] = useState("");
  const openId = params.get("open");
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const canBulk = perms.write || perms.archive;
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const open = (id: string) => set({ open: id });

  const runBulk = (op: Parameters<typeof bulkAction>[2], label: string) =>
    start(async () => {
      const res = await bulkAction(orgSlug, [...selected], op);
      if (res.ok) { toast.success(`${label}: ${res.data.count} customer(s)`); setSelected(new Set()); setTagDraft(""); }
      else toast.error(res.error);
    });

  const ownerOptions = members.map((m) => ({ value: m.membershipId, label: m.name }));
  const showArchived = params.get("view") === "archived";

  return (
    <>
      {selected.size > 0 && (
        <div className="sticky top-14 z-20 flex flex-wrap items-center gap-2 border-b bg-primary/5 px-4 py-2 text-sm" role="region" aria-label="Bulk actions">
          <span className="font-medium">{selected.size} selected</span>
          {perms.assign && (
            <NativeSelect aria-label="Assign selected to" className="h-8 w-auto text-xs" value="" disabled={pending} onChange={(e) => e.target.value && runBulk({ kind: "assign", ownerMembershipId: e.target.value === "none" ? null : e.target.value }, "Assigned")}>
              <option value="">Assign to…</option>
              <option value="none">Unassigned</option>
              {members.map((m) => <option key={m.membershipId} value={m.membershipId}>{m.name}</option>)}
            </NativeSelect>
          )}
          {perms.write && (
            <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); if (tagDraft.trim()) runBulk({ kind: "addTag", tagName: tagDraft }, "Tagged"); }}>
              <Input aria-label="Tag to add" list="bulk-tags" value={tagDraft} onChange={(e) => setTagDraft(e.target.value)} placeholder="Add tag…" className="h-8 w-36 text-xs" />
              <datalist id="bulk-tags">{tags.map((t) => <option key={t.id} value={t.name} />)}</datalist>
              <Button size="sm" variant="outline" type="submit" disabled={pending || !tagDraft.trim()}><Tag /> Tag</Button>
            </form>
          )}
          {perms.write && tags.length > 0 && (
            <NativeSelect aria-label="Remove tag from selected" className="h-8 w-auto text-xs" value="" disabled={pending} onChange={(e) => e.target.value && runBulk({ kind: "removeTag", tagId: e.target.value }, "Untagged")}>
              <option value="">Remove tag…</option>
              {tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </NativeSelect>
          )}
          {perms.archive && (showArchived ? (
            <Button size="sm" variant="outline" disabled={pending} onClick={() => runBulk({ kind: "restore" }, "Restored")}><ArchiveRestore /> Restore</Button>
          ) : (
            <Button size="sm" variant="outline" disabled={pending} onClick={() => { if (confirm(`Archive ${selected.size} customer(s)? They can be restored from the Archived view.`)) runBulk({ kind: "archive" }, "Archived"); }}><Archive /> Archive</Button>
          ))}
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())} className="ml-auto"><X /> Clear</Button>
        </div>
      )}

      {layout === "cards" ? (
        <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((r) => (
            <div
              key={r.id}
              role="button"
              tabIndex={0}
              onClick={() => open(r.id)}
              onKeyDown={(e) => { if (e.key === "Enter") open(r.id); }}
              aria-label={`Open ${r.displayName}`}
              className={cn("relative cursor-pointer rounded-lg border bg-card p-4 text-left transition hover:border-primary/40 hover:shadow-sm", openId === r.id && "border-primary ring-1 ring-primary")}
            >
              {canBulk && (
                <input type="checkbox" aria-label={`Select ${r.displayName}`} className="absolute right-3 top-3 size-4 accent-[var(--brand-primary)]" checked={selected.has(r.id)} onClick={(e) => e.stopPropagation()} onChange={() => toggle(r.id)} />
              )}
              <div className="flex items-center gap-3 pr-6">
                <span className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">{initials(r.displayName)}</span>
                <div className="min-w-0">
                  <div className="truncate font-medium">{r.displayName}</div>
                  <div className="truncate text-xs text-muted-foreground">{r.primaryEmail ?? r.primaryPhone ?? `CUS-${r.number}`}</div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1">
                <Badge tone={STATUS[r.status]?.tone ?? "neutral"}>{STATUS[r.status]?.label ?? r.status}</Badge>
                {r.tags.slice(0, 3).map((t) => <TagChip key={t.id} name={t.name} color={t.color} />)}
              </div>
              <div className="mt-3 flex justify-between text-xs text-muted-foreground">
                <span>{sourceLabel(r.source)}</span>
                <span>{r.ownerName ?? "Unassigned"}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                {canBulk && (
                  <th className="w-10 px-4 py-2">
                    <input type="checkbox" aria-label="Select all on this page" className="size-4 accent-[var(--brand-primary)]" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))} />
                  </th>
                )}
                {["Customer", "Contact", "Tags", "Source", "Owner", "Marketing", "Last activity"].map((h) => (
                  <th key={h} className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => open(r.id)}
                  className={cn("cursor-pointer hover:bg-muted/30", openId === r.id && "bg-primary/5", selected.has(r.id) && "bg-primary/5")}
                >
                  {canBulk && (
                    <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" aria-label={`Select ${r.displayName}`} className="size-4 accent-[var(--brand-primary)]" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                    </td>
                  )}
                  <td className="px-3 py-2.5">
                    <button type="button" className="text-left font-medium hover:underline" onClick={(e) => { e.stopPropagation(); open(r.id); }}>{r.displayName}</button>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span>CUS-{r.number}</span>
                      {r.status !== "active" && <Badge tone={STATUS[r.status]?.tone ?? "neutral"}>{STATUS[r.status]?.label}</Badge>}
                      {r.type === "business" && <span>· Business</span>}
                    </div>
                  </td>
                  <td className="max-w-56 px-3 py-2.5 text-xs">
                    <div className="truncate">{r.primaryEmail ?? "—"}</div>
                    <div className="truncate text-muted-foreground">{r.primaryPhone ?? ""}</div>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex max-w-48 flex-wrap gap-1">{r.tags.slice(0, 3).map((t) => <TagChip key={t.id} name={t.name} color={t.color} />)}{r.tags.length > 3 && <span className="text-xs text-muted-foreground">+{r.tags.length - 3}</span>}</div>
                  </td>
                  <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                    <InlineSelect label={`Source for ${r.displayName}`} value={r.source} options={SOURCE_OPTIONS} emptyLabel="—" disabled={!perms.write || r.status === "merged"} onSave={(v) => updateCustomerFieldAction(orgSlug, r.id, "source", v)} />
                  </td>
                  <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                    {perms.assign ? (
                      <InlineSelect label={`Owner for ${r.displayName}`} value={r.ownerMembershipId} options={ownerOptions} emptyLabel="Unassigned" onSave={(v) => updateCustomerFieldAction(orgSlug, r.id, "ownerMembershipId", v)} />
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs"><UserRound className="size-3" /> {r.ownerName ?? "Unassigned"}</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5"><Badge tone={MARKETING[r.emailMarketing].tone}>{MARKETING[r.emailMarketing].label}</Badge></td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-xs text-muted-foreground">{r.lastActivityAt ? formatRelative(r.lastActivityAt) : formatRelative(r.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
