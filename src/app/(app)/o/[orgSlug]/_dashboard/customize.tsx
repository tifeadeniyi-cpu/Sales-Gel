"use client";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, SlidersHorizontal } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { NativeSelect } from "@/components/ui/input";
import { WIDGETS, type WidgetPref } from "@/domains/reporting/widgets";
import { resetLayoutAction, saveLayoutAction } from "./actions";

const LABEL = Object.fromEntries(WIDGETS.map((w) => [w.key, w.label]));

export function CustomizeDashboard({ orgSlug, layout, source, canSetDefault, hasWorkspaceDefault }: { orgSlug: string; layout: WidgetPref[]; source: string; canSetDefault: boolean; hasWorkspaceDefault: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(layout);
  const [pending, start] = useTransition();
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    setItems(next);
  };
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, msg: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) { toast.success(msg); setOpen(false); router.refresh(); } else toast.error(r.error ?? "Couldn't save the layout");
    });
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setItems(layout); }}>
      <DialogTrigger asChild><Button variant="outline" className="bg-card shadow-sm"><SlidersHorizontal /> Customize dashboard</Button></DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Customize dashboard</DialogTitle>
          <DialogDescription>
            Show, hide, reorder and resize widgets. Your layout is personal and doesn&apos;t change anyone else&apos;s dashboard.
            {source === "workspace" && " You're currently using the workspace default."}
          </DialogDescription>
        </DialogHeader>
        <ul className="divide-y rounded-lg border" aria-label="Widgets">
          {items.map((w, i) => (
            <li key={w.key} className="flex items-center gap-2 px-3 py-2">
              <input id={`customize-${w.key}`} type="checkbox" className="size-4 accent-[var(--brand-primary)]" checked={w.visible} onChange={(e) => setItems(items.map((x) => (x.key === w.key ? { ...x, visible: e.target.checked } : x)))} />
              <label htmlFor={`customize-${w.key}`} className="flex-1 text-sm font-medium">{LABEL[w.key]}</label>
              <NativeSelect aria-label={`${LABEL[w.key]} width`} className="h-8 w-28 text-xs" value={w.width} onChange={(e) => setItems(items.map((x) => (x.key === w.key ? { ...x, width: e.target.value as "half" | "full" } : x)))}>
                <option value="half">Half width</option>
                <option value="full">Full width</option>
              </NativeSelect>
              <Button type="button" size="icon" variant="ghost" className="size-8" aria-label={`Move ${LABEL[w.key]} up`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp /></Button>
              <Button type="button" size="icon" variant="ghost" className="size-8" aria-label={`Move ${LABEL[w.key]} down`} disabled={i === items.length - 1} onClick={() => move(i, 1)}><ArrowDown /></Button>
            </li>
          ))}
        </ul>
        <DialogFooter className="flex-wrap gap-2 sm:justify-between">
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="ghost" disabled={pending || source !== "personal"} onClick={() => run(() => resetLayoutAction(orgSlug), hasWorkspaceDefault ? "Reset to the workspace default" : "Reset to the standard layout")}>
              Reset to {hasWorkspaceDefault ? "workspace default" : "standard layout"}
            </Button>
            {canSetDefault && <Button type="button" variant="outline" disabled={pending} onClick={() => run(() => saveLayoutAction(orgSlug, items, "workspace"), "Saved as the workspace default")}>Save as workspace default</Button>}
          </div>
          <Button type="button" disabled={pending} onClick={() => run(() => saveLayoutAction(orgSlug, items, "personal"), "Dashboard layout saved")}>Save my layout</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
