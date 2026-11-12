"use client";
import { useUrlParams } from "@/components/app/use-url-params";
import { cn } from "@/lib/utils";

/** Opens a record in the dashboard's side panel (keeps filters and scroll position). */
export function OpenRecord({ kind, id, children, className, label }: { kind: "order" | "ticket" | "task"; id: string; children: React.ReactNode; className?: string; label?: string }) {
  const { set } = useUrlParams();
  return (
    <button type="button" aria-label={label} onClick={(e) => { e.stopPropagation(); set({ open: `${kind}:${id}` }); }} className={cn("text-left hover:underline", className)}>
      {children}
    </button>
  );
}

/** A table row whose click opens the record; inner links/buttons keep their own behaviour. */
export function OpenRow({ kind, id, children }: { kind: "order" | "ticket"; id: string; children: React.ReactNode }) {
  const { set } = useUrlParams();
  return (
    <tr className="cursor-pointer hover:bg-muted/40" onClick={(e) => { if ((e.target as HTMLElement).closest("a,button,select,input")) return; set({ open: `${kind}:${id}` }); }}>
      {children}
    </tr>
  );
}
