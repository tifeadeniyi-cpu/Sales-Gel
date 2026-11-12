"use client";
import { Check, Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { setTaskDoneAction } from "../actions";

/** Green completed-state check circle. Optimistic, rolls back on failure. */
export function TaskCheck({ orgSlug, id, title, done, disabled }: { orgSlug: string; id: string; title: string; done: boolean; disabled?: boolean }) {
  const [checked, setChecked] = useState(done);
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={checked ? `Mark “${title}” as not done` : `Mark “${title}” as done`}
      disabled={disabled || pending}
      onClick={(e) => {
        e.stopPropagation();
        const next = !checked;
        setChecked(next);
        start(async () => {
          const res = await setTaskDoneAction(orgSlug, id, next);
          if (!res.ok) { setChecked(!next); toast.error(res.error); }
          else if (next && res.data.nextId) toast.success("Done — next occurrence scheduled");
        });
      }}
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition",
        checked ? "border-success bg-success text-white" : "border-muted-foreground/40 hover:border-success",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      {pending ? <Loader2 className="size-3 animate-spin" /> : checked ? <Check className="size-3" strokeWidth={3} /> : null}
    </button>
  );
}
