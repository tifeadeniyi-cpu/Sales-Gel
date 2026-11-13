"use client";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { toHhmm, toMinutes } from "@/domains/support/business-time";
import { addHolidayAction, removeHolidayAction, saveBusinessHoursAction } from "../actions";

const DAYS: [string, string][] = [["1", "Monday"], ["2", "Tuesday"], ["3", "Wednesday"], ["4", "Thursday"], ["5", "Friday"], ["6", "Saturday"], ["0", "Sunday"]];
type Row = { start: string; end: string }[];

export function BusinessHoursEditor({ orgSlug, timezone, schedule, configured }: { orgSlug: string; timezone: string; schedule: Record<string, [number, number][]>; configured: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [tz, setTz] = useState(timezone);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState<Record<string, Row>>(() => Object.fromEntries(DAYS.map(([k]) => [k, (schedule[k] ?? []).map(([a, b]) => ({ start: toHhmm(a), end: toHhmm(b) }))])));
  const zones = useMemo(() => { try { return Intl.supportedValuesOf("timeZone"); } catch { return [timezone]; } }, [timezone]);
  const set = (k: string, rows: Row) => setDays((d) => ({ ...d, [k]: rows }));
  const save = () => {
    setError(null);
    const out: Record<string, [number, number][]> = {};
    for (const [k, rows] of Object.entries(days)) {
      const list: [number, number][] = [];
      for (const r of rows) {
        const a = toMinutes(r.start);
        const b = toMinutes(r.end);
        if (a === null || b === null || b <= a) return setError(`Check the hours on ${DAYS.find((d) => d[0] === k)![1]}: the end must be after the start.`);
        list.push([a, b]);
      }
      if (list.length) out[k] = list;
    }
    start(async () => {
      const r = await saveBusinessHoursAction(orgSlug, { timezone: tz, schedule: out });
      if (!r.ok) return void setError(Object.values(r.fieldErrors ?? {})[0]?.[0] ?? r.error);
      toast.success(r.data.reapplied ? `Business hours saved. Updated ${r.data.reapplied} open ticket${r.data.reapplied === 1 ? "" : "s"}.` : "Business hours saved");
      router.refresh();
    });
  };
  return (
    <div className="space-y-4">
      {!configured && <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">Not set yet. SLAs currently use Monday–Friday, 9:00–17:00 in your workspace timezone.</p>}
      <label className="grid max-w-sm gap-1 text-sm font-medium">Timezone
        <NativeSelect value={tz} onChange={(e) => setTz(e.target.value)}>{zones.map((z) => <option key={z} value={z}>{z.replaceAll("_", " ")}</option>)}</NativeSelect>
      </label>
      <ul className="divide-y rounded-md border">
        {DAYS.map(([k, label]) => {
          const rows = days[k];
          const open = rows.length > 0;
          return (
            <li key={k} className="flex flex-wrap items-start gap-3 px-3 py-2.5 text-sm">
              <label className="flex w-36 items-center gap-2 pt-1.5 font-medium">
                <input type="checkbox" className="size-4 accent-[var(--brand-primary)]" checked={open} onChange={(e) => set(k, e.target.checked ? [{ start: "09:00", end: "17:00" }] : [])} />
                {label}
              </label>
              <div className="flex flex-1 flex-col gap-2">
                {!open && <span className="pt-1.5 text-muted-foreground">Closed</span>}
                {rows.map((r, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <Input type="time" aria-label={`${label} opens`} value={r.start} onChange={(e) => set(k, rows.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} className="w-32" />
                    <span className="text-muted-foreground">to</span>
                    <Input type="time" aria-label={`${label} closes`} value={r.end} onChange={(e) => set(k, rows.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} className="w-32" />
                    {rows.length > 1 && <Button size="sm" variant="ghost" onClick={() => set(k, rows.filter((_, j) => j !== i))}>Remove</Button>}
                  </div>
                ))}
                {open && rows.length < 4 && <Button size="sm" variant="ghost" className="w-fit px-0 text-primary" onClick={() => set(k, [...rows, { start: "13:00", end: "17:00" }])}>+ Add a period (e.g. after lunch)</Button>}
              </div>
            </li>
          );
        })}
      </ul>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <Button onClick={save} disabled={pending}>{pending ? "Saving…" : "Save business hours"}</Button>
    </div>
  );
}

export function HolidayManager({ orgSlug, holidays }: { orgSlug: string; holidays: { id: string; date: string; name: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [v, setV] = useState({ date: "", name: "" });
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string, after?: () => void) => start(async () => { const r = await fn(); if (r.ok) { toast.success(ok); after?.(); router.refresh(); } else toast.error(r.error); });
  const fmt = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  return (
    <div className="space-y-4 text-sm">
      {holidays.length === 0 ? <p className="text-muted-foreground">No holidays added.</p> : (
        <ul className="divide-y rounded-md border">
          {holidays.map((h) => (
            <li key={h.id} className="flex items-center gap-2 px-3 py-2">
              <span className="flex-1"><span className="font-medium">{h.name}</span><span className="block text-xs text-muted-foreground">{fmt(h.date)}</span></span>
              <Button size="sm" variant="ghost" disabled={pending} aria-label={`Remove ${h.name}`} onClick={() => run(() => removeHolidayAction(orgSlug, h.id), "Holiday removed")}>Remove</Button>
            </li>
          ))}
        </ul>
      )}
      <form className="grid gap-2" onSubmit={(e) => { e.preventDefault(); run(() => addHolidayAction(orgSlug, v), "Holiday added", () => setV({ date: "", name: "" })); }}>
        <label className="grid gap-1 text-xs font-medium">Holiday date<Input type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} /></label>
        <label className="grid gap-1 text-xs font-medium">Holiday name<Input value={v.name} placeholder="e.g. Thanksgiving" onChange={(e) => setV({ ...v, name: e.target.value })} /></label>
        <Button type="submit" variant="outline" disabled={pending || !v.date || !v.name.trim()}>Add holiday</Button>
      </form>
    </div>
  );
}
