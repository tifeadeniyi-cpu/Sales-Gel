"use client";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/server/actions";

export function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = <T,>(fn: () => Promise<ActionResult<T>>, ok: string, after?: (data: T) => void, onError?: (r: Extract<ActionResult<T>, { ok: false }>) => void) =>
    start(async () => {
      const r = await fn();
      if (r.ok) { toast.success(ok); after?.(r.data); router.refresh(); }
      else if (onError) onError(r);
      else toast.error(r.error);
    });
  return { pending, run };
}

/** Toggle chips for multi-select conditions. Empty selection = "any". */
export function CheckGroup({ legend, options, value, onChange, anyLabel = "Any" }: { legend: string; options: { value: string; label: string }[]; value: string[]; onChange: (v: string[]) => void; anyLabel?: string }) {
  return (
    <fieldset className="grid gap-1.5">
      <legend className="mb-1 text-xs font-medium">{legend} <span className="font-normal text-muted-foreground">({value.length ? `${value.length} selected` : anyLabel})</span></legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = value.includes(o.value);
          return (
            <label key={o.value} className={`cursor-pointer rounded-full border px-2.5 py-1 text-xs transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring ${on ? "border-primary bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted"}`}>
              <input type="checkbox" className="sr-only" checked={on} onChange={() => onChange(on ? value.filter((x) => x !== o.value) : [...value, o.value])} />
              {o.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export const firstError = (r: { error: string; fieldErrors?: Record<string, string[]> }) => Object.values(r.fieldErrors ?? {})[0]?.[0] ?? r.error;
export const splitList = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
