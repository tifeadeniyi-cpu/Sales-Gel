"use client";
import Link from "next/link";
import { useState } from "react";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMinutes, parseDuration } from "@/domains/support/business-time";
import { CHANNEL_LABELS, PRIORITY_LABELS } from "@/domains/support/validation";
import { archiveSlaPolicyAction, moveSlaPolicyAction, saveSlaPolicyAction } from "../actions";
import { CheckGroup, firstError, useRun } from "../parts";

type Targets = Record<string, { firstResponse: number | null; resolution: number | null }>;
interface Policy { id: string; name: string; isActive: number; calendar: string; escalateOnBreach: number; conditions: { priorities?: string[]; channels?: string[]; ticketTypeIds?: string[] }; targets: Targets }
const PRIOS = ["urgent", "high", "normal", "low"] as const;

export function SlaPolicies({ orgSlug, policies, types, hoursConfigured }: { orgSlug: string; policies: Policy[]; types: { id: string; name: string }[]; hoursConfigured: boolean }) {
  const { pending, run } = useRun();
  const [editing, setEditing] = useState<string | "new" | null>(policies.length ? null : "new");
  const typeName = (id: string) => types.find((t) => t.id === id)?.name ?? "Unknown type";
  const when = (p: Policy) => {
    const parts = [
      p.conditions.priorities?.length ? p.conditions.priorities.map((x) => PRIORITY_LABELS[x as keyof typeof PRIORITY_LABELS]).join(" or ") + " priority" : null,
      p.conditions.channels?.length ? "from " + p.conditions.channels.map((x) => CHANNEL_LABELS[x as keyof typeof CHANNEL_LABELS]).join(" or ") : null,
      p.conditions.ticketTypeIds?.length ? p.conditions.ticketTypeIds.map(typeName).join(" or ") : null,
    ].filter(Boolean);
    return parts.length ? parts.join(", ") : "All tickets";
  };
  return (
    <div className="space-y-4">
      {!hoursConfigured && <p className="text-sm text-muted-foreground">Business-hours policies use Monday–Friday 9:00–17:00 until you <Link href={`/o/${orgSlug}/settings/support/hours`} className="text-primary hover:underline">set your hours</Link>.</p>}
      {policies.length === 0 && editing !== "new" && <p className="text-sm text-muted-foreground">No SLA policies yet, so tickets have no due times.</p>}
      <ol className="space-y-3">
        {policies.map((p, i) => (
          <li key={p.id} className="rounded-lg border">
            {editing === p.id ? (
              <PolicyEditor orgSlug={orgSlug} policy={p} types={types} onDone={() => setEditing(null)} />
            ) : (
              <div className="p-4">
                <div className="flex flex-wrap items-start gap-2">
                  <span className="mt-0.5 grid size-6 place-items-center rounded-full bg-muted text-xs font-semibold" aria-label={`Order ${i + 1}`}>{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-medium">{p.name}</h3>
                    <p className="text-sm text-muted-foreground">Applies to: {when(p)} · {p.calendar === "24x7" ? "24/7 clock" : "Business hours"}{p.escalateOnBreach ? " · Escalates when missed" : ""}</p>
                  </div>
                  {!p.isActive && <Badge tone="inactive">Off</Badge>}
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" disabled={pending || i === 0} aria-label={`Move ${p.name} up`} onClick={() => run(() => moveSlaPolicyAction(orgSlug, p.id, "up"), "Order updated")}>↑</Button>
                    <Button size="sm" variant="ghost" disabled={pending || i === policies.length - 1} aria-label={`Move ${p.name} down`} onClick={() => run(() => moveSlaPolicyAction(orgSlug, p.id, "down"), "Order updated")}>↓</Button>
                    <Button size="sm" variant="outline" onClick={() => setEditing(p.id)}>Edit</Button>
                    <ConfirmDialog trigger={<Button size="sm" variant="ghost">Delete</Button>} title={`Delete "${p.name}"?`} confirmLabel="Delete policy"
                      description="Open tickets using it will move to the next matching policy, or have no due times." onConfirm={() => archiveSlaPolicyAction(orgSlug, p.id)} successMessage="Policy deleted" />
                  </div>
                </div>
                <table className="mt-3 w-full max-w-lg text-sm">
                  <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1 font-medium">Priority</th><th className="font-medium">First reply</th><th className="font-medium">Resolution</th></tr></thead>
                  <tbody>
                    {PRIOS.filter((x) => p.targets[x]).map((x) => (
                      <tr key={x} className="border-t"><td className="py-1.5">{PRIORITY_LABELS[x]}</td><td>{p.targets[x].firstResponse ? formatMinutes(p.targets[x].firstResponse!) : "—"}</td><td>{p.targets[x].resolution ? formatMinutes(p.targets[x].resolution!) : "—"}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </li>
        ))}
      </ol>
      {editing === "new" ? <div className="rounded-lg border"><PolicyEditor orgSlug={orgSlug} policy={null} types={types} onDone={() => setEditing(null)} /></div>
        : <Button onClick={() => setEditing("new")}>Add SLA policy</Button>}
    </div>
  );
}

const DEFAULT_TARGETS: Record<string, { fr: string; res: string }> = { urgent: { fr: "1h", res: "8h" }, high: { fr: "4h", res: "1d" }, normal: { fr: "8h", res: "3d" }, low: { fr: "1d", res: "5d" } };

function PolicyEditor({ orgSlug, policy, types, onDone }: { orgSlug: string; policy: Policy | null; types: { id: string; name: string }[]; onDone: () => void }) {
  const { pending, run } = useRun();
  const [name, setName] = useState(policy?.name ?? (policy ? "" : "Standard support"));
  const [active, setActive] = useState(policy ? !!policy.isActive : true);
  const [calendar, setCalendar] = useState(policy?.calendar ?? "business");
  const [escalate, setEscalate] = useState(policy ? !!policy.escalateOnBreach : true);
  const [priorities, setPriorities] = useState(policy?.conditions.priorities ?? []);
  const [channels, setChannels] = useState(policy?.conditions.channels ?? []);
  const [typeIds, setTypeIds] = useState(policy?.conditions.ticketTypeIds ?? []);
  const [targets, setTargets] = useState<Record<string, { fr: string; res: string }>>(() =>
    Object.fromEntries(PRIOS.map((x) => [x, policy ? { fr: policy.targets[x]?.firstResponse ? formatMinutes(policy.targets[x].firstResponse!) : "", res: policy.targets[x]?.resolution ? formatMinutes(policy.targets[x].resolution!) : "" } : DEFAULT_TARGETS[x]])));
  const [error, setError] = useState<string | null>(null);
  const save = () => {
    setError(null);
    const out: Targets = {};
    for (const x of PRIOS) {
      const t = targets[x];
      const fr = t.fr.trim() ? parseDuration(t.fr) : null;
      const res = t.res.trim() ? parseDuration(t.res) : null;
      if ((t.fr.trim() && !fr) || (t.res.trim() && !res)) return setError(`Use durations like 30m, 4h or 2d (${PRIORITY_LABELS[x]}).`);
      if (fr || res) out[x] = { firstResponse: fr, resolution: res };
    }
    run(() => saveSlaPolicyAction(orgSlug, policy?.id ?? null, { name, isActive: active, calendar, escalateOnBreach: escalate, conditions: { priorities, channels, ticketTypeIds: typeIds }, targets: out }),
      policy ? "Policy saved" : "Policy added", onDone, (r) => setError(firstError(r)));
  };
  return (
    <form className="grid gap-4 p-4" onSubmit={(e) => { e.preventDefault(); save(); }}>
      <div className="flex flex-wrap items-end gap-4">
        <label className="grid flex-1 gap-1 text-sm font-medium">Policy name<Input value={name} onChange={(e) => setName(e.target.value)} className="max-w-sm" /></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-[var(--brand-primary)]" checked={active} onChange={(e) => setActive(e.target.checked)} />Active</label>
      </div>
      <div className="grid gap-3 rounded-md bg-muted/40 p-3">
        <p className="text-sm font-medium">Which tickets?</p>
        <CheckGroup legend="Priority" options={PRIOS.map((x) => ({ value: x, label: PRIORITY_LABELS[x] }))} value={priorities} onChange={setPriorities} />
        <CheckGroup legend="Received via" options={Object.entries(CHANNEL_LABELS).map(([value, label]) => ({ value, label }))} value={channels} onChange={setChannels} />
        {types.length > 0 && <CheckGroup legend="Ticket type" options={types.map((t) => ({ value: t.id, label: t.name }))} value={typeIds} onChange={setTypeIds} />}
      </div>
      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium">Targets <span className="font-normal text-muted-foreground">(e.g. 30m, 4h, 2d — leave blank for none)</span></legend>
        <table className="w-full max-w-lg text-sm">
          <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1 font-medium">Priority</th><th className="font-medium">First reply within</th><th className="font-medium">Resolve within</th></tr></thead>
          <tbody>
            {PRIOS.map((x) => (
              <tr key={x}>
                <td className="py-1 pr-2">{PRIORITY_LABELS[x]}</td>
                <td className="pr-2"><Input aria-label={`${PRIORITY_LABELS[x]} first reply target`} value={targets[x].fr} onChange={(e) => setTargets({ ...targets, [x]: { ...targets[x], fr: e.target.value } })} className="h-8" /></td>
                <td><Input aria-label={`${PRIORITY_LABELS[x]} resolution target`} value={targets[x].res} onChange={(e) => setTargets({ ...targets, [x]: { ...targets[x], res: e.target.value } })} className="h-8" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </fieldset>
      <fieldset className="grid gap-2 text-sm">
        <legend className="mb-1 font-medium">Clock</legend>
        <label className="flex items-center gap-2"><input type="radio" name="calendar" checked={calendar === "business"} onChange={() => setCalendar("business")} className="accent-[var(--brand-primary)]" />Business hours only</label>
        <label className="flex items-center gap-2"><input type="radio" name="calendar" checked={calendar === "24x7"} onChange={() => setCalendar("24x7")} className="accent-[var(--brand-primary)]" />24/7 (every hour counts)</label>
      </fieldset>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-[var(--brand-primary)]" checked={escalate} onChange={(e) => setEscalate(e.target.checked)} />Escalate the ticket and alert managers when a target is missed</label>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending || !name.trim()}>{pending ? "Saving…" : policy ? "Save policy" : "Add policy"}</Button>
        <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}
