"use client";
import { Check, Loader2, Pencil, X } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { ActionResult } from "@/server/actions";

type SaveFn = (value: string | null) => Promise<ActionResult<unknown>>;

/**
 * Click-to-edit text field. Validates on the server, shows saving state, keeps the
 * previous value and shows the error when saving fails.
 */
export function InlineText({
  value,
  onSave,
  label,
  placeholder = "Add…",
  disabled,
  className,
}: {
  value: string | null;
  onSave: SaveFn;
  label: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [shown, setShown] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing) inputRef.current?.select(); }, [editing]);

  const commit = () => {
    const next = draft.trim() === "" ? null : draft.trim();
    if (next === (shown ?? null)) { setEditing(false); return; }
    start(async () => {
      const res = await onSave(next);
      if (res.ok) {
        setShown(next);
        setEditing(false);
        setError(null);
      } else {
        setError(res.fieldErrors ? Object.values(res.fieldErrors).flat()[0] ?? res.error : res.error);
      }
    });
  };

  if (disabled) return <span className={cn("text-sm", !shown && "text-muted-foreground", className)}>{shown || "—"}</span>;

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => { setDraft(shown ?? ""); setEditing(true); }}
        className={cn("group -mx-1 flex min-h-7 w-full items-center gap-1 rounded px-1 text-left text-sm hover:bg-muted", !shown && "text-muted-foreground", className)}
        aria-label={`Edit ${label}`}
      >
        <span className="flex-1 truncate">{shown || placeholder}</span>
        <Pencil className="size-3 opacity-0 group-hover:opacity-60" aria-hidden />
      </button>
    );
  }
  return (
    <div className="grid gap-1">
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          aria-label={label}
          aria-invalid={!!error}
          className="h-7 w-full rounded border bg-card px-2 text-sm aria-invalid:border-danger"
          value={draft}
          disabled={pending}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commit(); }
            if (e.key === "Escape") { setEditing(false); setError(null); }
          }}
        />
        {pending ? <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Saving" /> : (
          <>
            <button type="button" onClick={commit} aria-label={`Save ${label}`} className="rounded p-1 hover:bg-muted"><Check className="size-4 text-success" /></button>
            <button type="button" onClick={() => { setEditing(false); setError(null); }} aria-label="Cancel" className="rounded p-1 hover:bg-muted"><X className="size-4" /></button>
          </>
        )}
      </div>
      {error && <p className="text-xs text-danger" role="alert">{error}</p>}
    </div>
  );
}

/** Select that saves on change and rolls back on failure. */
export function InlineSelect({
  value,
  options,
  onSave,
  label,
  emptyLabel,
  disabled,
  className,
}: {
  value: string | null;
  options: { value: string; label: string }[];
  onSave: SaveFn;
  label: string;
  emptyLabel?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [current, setCurrent] = useState(value ?? "");
  const [pending, start] = useTransition();
  if (disabled) {
    return <span className="text-sm">{options.find((o) => o.value === current)?.label ?? emptyLabel ?? "—"}</span>;
  }
  return (
    <span className="inline-flex items-center gap-1">
      <select
        aria-label={label}
        value={current}
        disabled={pending}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => {
          const prev = current;
          const next = e.target.value;
          setCurrent(next);
          start(async () => {
            const res = await onSave(next === "" ? null : next);
            if (!res.ok) {
              setCurrent(prev);
              toast.error(res.fieldErrors ? Object.values(res.fieldErrors).flat()[0] ?? res.error : res.error);
            } else toast.success(`${label} saved`);
          });
        }}
        className={cn("h-7 max-w-full rounded border border-transparent bg-transparent px-1 text-sm hover:border-border focus:border-border", className)}
      >
        {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {pending && <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-label="Saving" />}
    </span>
  );
}
