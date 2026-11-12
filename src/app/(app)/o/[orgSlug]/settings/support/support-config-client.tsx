"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { CATEGORY_LABELS } from "@/domains/support/validation";
import type { ActionResult } from "@/server/actions";
import { archiveTicketStatusAction, archiveTicketTypeAction, createTicketStatusAction, createTicketTypeAction, updateTicketStatusDefAction } from "../../support/tickets/actions";

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<ActionResult<unknown>>, ok: string, after?: () => void) =>
    start(async () => { const r = await fn(); if (r.ok) { toast.success(ok); after?.(); router.refresh(); } else toast.error(r.error); });
  return { pending, run };
}

export function StatusManager({ orgSlug, statuses, canManage }: { orgSlug: string; statuses: { id: string; name: string; category: string; color: string; isDefault: number; archivedAt: Date | null }[]; canManage: boolean }) {
  const { pending, run } = useRun();
  const [v, setV] = useState({ name: "", category: "open", color: "#0ea5a4" });
  return (
    <div className="space-y-4">
      <ul className="divide-y rounded-md border text-sm">
        {statuses.filter((s) => !s.archivedAt).map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
            <span className="size-3 rounded-full" style={{ background: s.color }} aria-hidden />
            <span className="flex-1 font-medium">{s.name}</span>
            <span className="text-xs text-muted-foreground">{CATEGORY_LABELS[s.category as keyof typeof CATEGORY_LABELS]}</span>
            {s.isDefault ? <Badge tone="brand">Default for new tickets</Badge> : canManage && !["resolved", "closed"].includes(s.category) && (
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => updateTicketStatusDefAction(orgSlug, s.id, { isDefault: true }), "Default status updated")}>Make default</Button>
            )}
            {canManage && !s.isDefault && <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => archiveTicketStatusAction(orgSlug, s.id), "Status archived")}>Archive</Button>}
          </li>
        ))}
      </ul>
      {canManage && (
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); run(() => createTicketStatusAction(orgSlug, v), "Status added", () => setV({ ...v, name: "" })); }}>
          <label className="grid gap-1 text-xs font-medium">Name<Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} className="w-48" /></label>
          <label className="grid gap-1 text-xs font-medium">Behaves like
            <NativeSelect value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })} className="w-48">
              {Object.entries(CATEGORY_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </NativeSelect>
          </label>
          <label className="grid gap-1 text-xs font-medium">Color<input type="color" value={v.color} onChange={(e) => setV({ ...v, color: e.target.value })} className="h-9 w-12 rounded border" /></label>
          <Button type="submit" disabled={pending || !v.name.trim()}>Add status</Button>
        </form>
      )}
    </div>
  );
}

export function TypeManager({ orgSlug, types, canManage }: { orgSlug: string; types: { id: string; name: string; archivedAt: Date | null }[]; canManage: boolean }) {
  const { pending, run } = useRun();
  const [name, setName] = useState("");
  return (
    <div className="space-y-4">
      <ul className="flex flex-wrap gap-2">
        {types.filter((t) => !t.archivedAt).map((t) => (
          <li key={t.id} className="flex items-center gap-1 rounded-full border px-3 py-1 text-sm">
            {t.name}
            {canManage && <button type="button" className="text-xs text-muted-foreground hover:text-danger" aria-label={`Archive ${t.name}`} disabled={pending} onClick={() => run(() => archiveTicketTypeAction(orgSlug, t.id), "Type archived")}>×</button>}
          </li>
        ))}
      </ul>
      {canManage && (
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); run(() => createTicketTypeAction(orgSlug, { name }), "Type added", () => setName("")); }}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New type" className="w-56" aria-label="New ticket type" />
          <Button type="submit" disabled={pending || !name.trim()}>Add type</Button>
        </form>
      )}
    </div>
  );
}
