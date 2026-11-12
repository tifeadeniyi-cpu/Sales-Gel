"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/input";

const COMMON = ["Price too high", "Chose a competitor", "No response", "Out of stock", "Budget cut", "Not a fit"];

export function LostReasonDialog({ open, onCancel, onConfirm, title }: { open: boolean; onCancel: () => void; onConfirm: (reason: string) => void; title: string }) {
  const [reason, setReason] = useState("");
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark “{title}” as lost</DialogTitle>
          <DialogDescription>Recording why helps you spot patterns in lost deals.</DialogDescription>
        </DialogHeader>
        <div className="mb-2 flex flex-wrap gap-1">
          {COMMON.map((c) => (
            <button key={c} type="button" onClick={() => setReason(c)} className="rounded-full border px-2 py-0.5 text-xs hover:bg-muted">{c}</button>
          ))}
        </div>
        <label htmlFor="lost-reason" className="text-sm font-medium">Reason</label>
        <Textarea id="lost-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button variant="destructive" disabled={reason.trim().length < 2} onClick={() => { onConfirm(reason.trim()); setReason(""); }}>Mark as lost</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
