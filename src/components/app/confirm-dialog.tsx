"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { ActionResult } from "@/server/actions";

/**
 * Confirmation for destructive or consequential actions. Optionally requires typing a phrase.
 * Shows the server's error message if the action is refused (e.g. last-owner protection).
 */
export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel = "Confirm",
  confirmVariant = "destructive",
  typeToConfirm,
  onConfirm,
  successMessage,
}: {
  trigger: React.ReactNode;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  confirmVariant?: ButtonProps["variant"];
  typeToConfirm?: string;
  onConfirm: () => Promise<ActionResult<unknown>>;
  successMessage?: string;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setTyped(""); setError(null); } }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {typeToConfirm && (
          <div className="grid gap-1.5">
            <label htmlFor="confirm-phrase" className="text-sm">Type <strong>{typeToConfirm}</strong> to confirm</label>
            <Input id="confirm-phrase" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          </div>
        )}
        {error && <p className="mt-3 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">{error}</p>}
        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
          <Button
            variant={confirmVariant}
            disabled={pending || (typeToConfirm ? typed !== typeToConfirm : false)}
            onClick={() =>
              start(async () => {
                const res = await onConfirm();
                if (res.ok) {
                  setOpen(false);
                  if (successMessage) toast.success(successMessage);
                } else setError(res.error);
              })
            }
          >
            {pending ? "Working…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
