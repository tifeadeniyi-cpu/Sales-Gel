"use client";
import { CalendarRange } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { useUrlParams } from "@/components/app/use-url-params";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { COMPARE_LABELS, COMPARES, greeting, RANGE_LABELS, RANGES } from "@/domains/reporting/period";

const subscribe = () => () => {};

/** Greeting from the viewer's own clock (server renders a neutral greeting until hydration). */
function Greeting({ firstName }: { firstName: string }) {
  const hour = useSyncExternalStore(subscribe, () => new Date().getHours(), () => -1);
  return <>{hour < 0 ? "Welcome back" : greeting(hour)}, {firstName}</>;
}

export function DashboardHeader({
  firstName, range, compare, from, to, memberId, members, onCustomize,
}: {
  firstName: string; range: string; compare: string; from?: string; to?: string; memberId: string | null;
  members: { membershipId: string; name: string }[]; onCustomize?: React.ReactNode;
}) {
  const { set, pending } = useUrlParams();
  const [custom, setCustom] = useState({ from: from ?? "", to: to ?? "" });
  return (
    <div className="mb-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl" suppressHydrationWarning><Greeting firstName={firstName} /> <span aria-hidden>👋</span></h1>
          <p className="mt-1 text-muted-foreground">Here&apos;s what&apos;s happening across your business today.</p>
        </div>
        {onCustomize}
      </div>
      <div className={`mt-4 flex flex-wrap items-center gap-2 ${pending ? "opacity-70" : ""}`} role="group" aria-label="Dashboard filters">
        <label className="flex items-center gap-2 rounded-lg border bg-card px-2 shadow-sm">
          <CalendarRange className="size-4 text-muted-foreground" aria-hidden />
          <span className="sr-only">Date range</span>
          <NativeSelect aria-label="Date range" className="h-9 border-0 bg-transparent pl-0 shadow-none focus:ring-0" value={range}
            onChange={(e) => set(e.target.value === "custom" ? { range: "custom", from: custom.from || null, to: custom.to || null } : { range: e.target.value, from: null, to: null })}>
            {RANGES.map((r) => <option key={r} value={r}>{RANGE_LABELS[r]}</option>)}
          </NativeSelect>
        </label>
        {range === "custom" && (
          <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); set({ range: "custom", from: custom.from, to: custom.to }); }}>
            <Input type="date" aria-label="From date" className="h-9 w-40" value={custom.from} max={custom.to || undefined} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
            <span className="text-muted-foreground">–</span>
            <Input type="date" aria-label="To date" className="h-9 w-40" value={custom.to} min={custom.from || undefined} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
            <Button type="submit" variant="outline" size="sm" disabled={!custom.from || !custom.to}>Apply</Button>
          </form>
        )}
        <NativeSelect aria-label="Compare with" className="h-9 w-auto bg-card shadow-sm" value={compare} onChange={(e) => set({ compare: e.target.value === "previous" ? null : e.target.value })}>
          {COMPARES.map((c) => <option key={c} value={c}>{c === "none" ? COMPARE_LABELS[c] : `vs ${COMPARE_LABELS[c].toLowerCase()}`}</option>)}
        </NativeSelect>
        {members.length > 0 && (
          <NativeSelect aria-label="Team member" className="h-9 w-auto bg-card shadow-sm" value={memberId ?? ""} onChange={(e) => set({ member: e.target.value || null })}>
            <option value="">Whole team</option>
            {members.map((m) => <option key={m.membershipId} value={m.membershipId}>{m.name}</option>)}
          </NativeSelect>
        )}
      </div>
    </div>
  );
}

