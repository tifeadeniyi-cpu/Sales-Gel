"use client";
import Link from "next/link";
import { GitMerge } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { formatDateTime } from "@/lib/utils";
import { dismissDuplicateAction, mergeAction } from "../actions";

interface Side { id: string; number: number; displayName: string; status: string; createdAt: Date }

export function DuplicatePair({ orgSlug, a, b, reasons, values }: { orgSlug: string; a: Side; b: Side; reasons: string[]; values: string[] }) {
  const [survivor, setSurvivor] = useState<string>(a.status === "active" && b.status !== "active" ? a.id : b.status === "active" && a.status !== "active" ? b.id : a.createdAt <= b.createdAt ? a.id : b.id);
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [gone, setGone] = useState(false);
  const other = survivor === a.id ? b : a;
  const keep = survivor === a.id ? a : b;
  if (gone) return null;

  const card = (s: Side) => (
    <div className="rounded-md border p-3">
      <Link href={`/o/${orgSlug}/customers/${s.id}`} target="_blank" className="font-medium hover:underline">{s.displayName}</Link>
      <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
        CUS-{s.number} <Badge tone={s.status === "provisional" ? "warning" : "success"}>{s.status === "provisional" ? "Provisional" : "Active"}</Badge>
      </div>
      <div className="text-xs text-muted-foreground">Created {formatDateTime(s.createdAt)}</div>
    </div>
  );

  return (
    <li className="rounded-lg border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">Same {reasons.join(" & ")}</span>
        <span className="truncate text-xs text-muted-foreground">{values.map((v) => v.replace(/^[a-z]+:/, "@")).join(", ")}</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">{card(a)}{card(b)}</div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm"><GitMerge /> Merge…</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Merge these customers</DialogTitle>
              <DialogDescription>Choose which record to keep. The other record&apos;s emails, phones, handles, addresses, notes, tags and consent history move to it, and empty fields are filled in. Nothing is overwritten, and you can undo the merge later.</DialogDescription>
            </DialogHeader>
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">Keep</legend>
              {[a, b].map((s) => (
                <label key={s.id} className="flex items-center gap-2 rounded-md border p-2 text-sm">
                  <input type="radio" name={`survivor-${a.id}-${b.id}`} checked={survivor === s.id} onChange={() => setSurvivor(s.id)} className="accent-[var(--brand-primary)]" />
                  {s.displayName} <span className="text-xs text-muted-foreground">CUS-{s.number}</span>
                </label>
              ))}
            </fieldset>
            <p className="mt-3 text-sm">
              <strong>{other.displayName}</strong> will be merged into <strong>{keep.displayName}</strong>.
            </p>
            <DialogFooter>
              <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
              <Button
                disabled={pending}
                onClick={() => start(async () => {
                  const res = await mergeAction(orgSlug, keep.id, other.id);
                  if (res.ok) { toast.success("Customers merged"); setOpen(false); setGone(true); } else toast.error(res.error);
                })}
              >
                {pending ? "Merging…" : "Merge customers"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => start(async () => {
            const res = await dismissDuplicateAction(orgSlug, a.id, b.id);
            if (res.ok) { toast.success("Marked as not duplicates"); setGone(true); } else toast.error(res.error);
          })}
        >
          Not a duplicate
        </Button>
      </div>
    </li>
  );
}
