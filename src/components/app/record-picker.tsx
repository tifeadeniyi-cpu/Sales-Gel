"use client";
import { Search, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { ActionResult } from "@/server/actions";

export interface PickerOption { id: string; label: string; sub?: string }

/** Async searchable picker (combobox) for linking records like customers or leads. */
export function RecordPicker({
  value,
  onChange,
  search,
  placeholder = "Search…",
  label,
  invalid,
}: {
  value: PickerOption | null;
  onChange: (v: PickerOption | null) => void;
  search: (q: string) => Promise<ActionResult<PickerOption[]>>;
  placeholder?: string;
  label: string;
  invalid?: boolean;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<PickerOption[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const listId = useId();
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (q.trim().length < 2) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      const res = await search(q);
      if (!cancelled) {
        setOptions(res.ok ? res.data : []);
        setActive(0);
        setLoading(false);
      }
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q, search]);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  if (value) {
    return (
      <div className="flex h-9 items-center justify-between rounded-md border bg-card px-3 text-sm">
        <span className="truncate">{value.label}{value.sub && <span className="ml-2 text-xs text-muted-foreground">{value.sub}</span>}</span>
        <button type="button" onClick={() => onChange(null)} aria-label={`Clear ${label}`} className="rounded p-0.5 hover:bg-muted"><X className="size-4" /></button>
      </div>
    );
  }
  const shown = q.trim().length >= 2 ? options : [];
  return (
    <div ref={wrap} className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        role="combobox"
        aria-label={label}
        aria-expanded={open && shown.length > 0}
        aria-controls={listId}
        aria-invalid={invalid}
        value={q}
        placeholder={placeholder}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, shown.length - 1)); }
          if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          if (e.key === "Enter" && shown[active]) { e.preventDefault(); onChange(shown[active]); setQ(""); setOpen(false); }
          if (e.key === "Escape") setOpen(false);
        }}
        className="h-9 w-full rounded-md border bg-card pl-8 pr-3 text-sm aria-invalid:border-danger"
      />
      {open && q.trim().length >= 2 && (
        <ul id={listId} role="listbox" className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border bg-card p-1 shadow-lg">
          {loading && <li className="px-2 py-1.5 text-sm text-muted-foreground">Searching…</li>}
          {!loading && shown.length === 0 && <li className="px-2 py-1.5 text-sm text-muted-foreground">No matches</li>}
          {shown.map((o, i) => (
            <li
              key={o.id}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); onChange(o); setQ(""); setOpen(false); }}
              onMouseEnter={() => setActive(i)}
              className={`cursor-pointer rounded px-2 py-1.5 text-sm ${i === active ? "bg-muted" : ""}`}
            >
              <div>{o.label}</div>
              {o.sub && <div className="text-xs text-muted-foreground">{o.sub}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
