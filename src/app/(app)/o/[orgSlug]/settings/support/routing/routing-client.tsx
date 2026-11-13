"use client";
import { useState } from "react";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { CHANNEL_LABELS, PRIORITY_LABELS } from "@/domains/support/validation";
import { archiveRoutingRuleAction, moveRoutingRuleAction, saveRoutingRuleAction } from "../actions";
import { CheckGroup, firstError, splitList, useRun } from "../parts";

interface Rule {
  id: string; name: string; isActive: number; matchedCount: number;
  conditions: { channels?: string[]; priorities?: string[]; ticketTypeIds?: string[]; keywords?: string[]; customerTags?: string[]; formIds?: string[] };
  actions: { teamId?: string | null; assign?: "none" | "member" | "round_robin"; membershipId?: string | null; priority?: string | null; ticketTypeId?: string | null; addTags?: string[] };
}
type Opt = { id: string; name: string };

export function RoutingRules({ orgSlug, rules, teams, people, types, forms }: { orgSlug: string; rules: Rule[]; teams: (Opt & { members: number })[]; people: Opt[]; types: Opt[]; forms: Opt[] }) {
  const { pending, run } = useRun();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const name = (list: Opt[], id?: string | null) => list.find((x) => x.id === id)?.name ?? "—";
  const whenText = (c: Rule["conditions"]) => {
    const p = [
      c.keywords?.length && `mentions ${c.keywords.map((k) => `“${k}”`).join(" or ")}`,
      c.channels?.length && `via ${c.channels.map((x) => CHANNEL_LABELS[x as keyof typeof CHANNEL_LABELS]).join(" or ")}`,
      c.priorities?.length && `${c.priorities.map((x) => PRIORITY_LABELS[x as keyof typeof PRIORITY_LABELS]).join(" or ")} priority`,
      c.ticketTypeIds?.length && c.ticketTypeIds.map((x) => name(types, x)).join(" or "),
      c.formIds?.length && `form ${c.formIds.map((x) => name(forms, x)).join(" or ")}`,
      c.customerTags?.length && `customer tagged ${c.customerTags.join(" or ")}`,
    ].filter(Boolean);
    return p.length ? p.join(", ") : "any new ticket";
  };
  const thenText = (a: Rule["actions"]) => {
    const p = [
      a.teamId && `team ${name(teams, a.teamId)}`,
      a.assign === "member" && `assign to ${name(people, a.membershipId)}`,
      a.assign === "round_robin" && "assign in turn (round robin)",
      a.priority && `priority ${PRIORITY_LABELS[a.priority as keyof typeof PRIORITY_LABELS]}`,
      a.ticketTypeId && `type ${name(types, a.ticketTypeId)}`,
      a.addTags?.length && `tag ${a.addTags.join(", ")}`,
    ].filter(Boolean);
    return p.join(" · ");
  };
  return (
    <div className="space-y-4">
      {rules.length === 0 && editing !== "new" && <p className="text-sm text-muted-foreground">No rules yet. New tickets wait in the Unassigned queue.</p>}
      <ol className="space-y-3">
        {rules.map((r, i) => (
          <li key={r.id} className="rounded-lg border">
            {editing === r.id ? <RuleEditor orgSlug={orgSlug} rule={r} teams={teams} people={people} types={types} forms={forms} onDone={() => setEditing(null)} /> : (
              <div className="flex flex-wrap items-start gap-2 p-4">
                <span className="mt-0.5 grid size-6 place-items-center rounded-full bg-muted text-xs font-semibold">{i + 1}</span>
                <div className="min-w-0 flex-1 text-sm">
                  <h3 className="font-medium">{r.name}</h3>
                  <p className="text-muted-foreground"><span className="font-medium text-ink">When</span> {whenText(r.conditions)}</p>
                  <p className="text-muted-foreground"><span className="font-medium text-ink">Then</span> {thenText(r.actions)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Matched {r.matchedCount} ticket{r.matchedCount === 1 ? "" : "s"}</p>
                </div>
                {!r.isActive && <Badge tone="inactive">Off</Badge>}
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" disabled={pending || i === 0} aria-label={`Move ${r.name} up`} onClick={() => run(() => moveRoutingRuleAction(orgSlug, r.id, "up"), "Order updated")}>↑</Button>
                  <Button size="sm" variant="ghost" disabled={pending || i === rules.length - 1} aria-label={`Move ${r.name} down`} onClick={() => run(() => moveRoutingRuleAction(orgSlug, r.id, "down"), "Order updated")}>↓</Button>
                  <Button size="sm" variant="outline" onClick={() => setEditing(r.id)}>Edit</Button>
                  <ConfirmDialog trigger={<Button size="sm" variant="ghost">Delete</Button>} title={`Delete "${r.name}"?`} confirmLabel="Delete rule" description="Tickets already routed keep their assignment." onConfirm={() => archiveRoutingRuleAction(orgSlug, r.id)} successMessage="Rule deleted" />
                </div>
              </div>
            )}
          </li>
        ))}
      </ol>
      {editing === "new" ? <div className="rounded-lg border"><RuleEditor orgSlug={orgSlug} rule={null} teams={teams} people={people} types={types} forms={forms} onDone={() => setEditing(null)} /></div>
        : <Button onClick={() => setEditing("new")}>Add rule</Button>}
    </div>
  );
}

function RuleEditor({ orgSlug, rule, teams, people, types, forms, onDone }: { orgSlug: string; rule: Rule | null; teams: (Opt & { members: number })[]; people: Opt[]; types: Opt[]; forms: Opt[]; onDone: () => void }) {
  const { pending, run } = useRun();
  const c = rule?.conditions ?? {};
  const a = rule?.actions ?? {};
  const [v, setV] = useState({
    name: rule?.name ?? "", active: rule ? !!rule.isActive : true,
    channels: c.channels ?? [], priorities: c.priorities ?? [], ticketTypeIds: c.ticketTypeIds ?? [], formIds: c.formIds ?? [],
    keywords: (c.keywords ?? []).join(", "), customerTags: (c.customerTags ?? []).join(", "),
    teamId: a.teamId ?? "", assign: a.assign ?? "none", membershipId: a.membershipId ?? "", priority: a.priority ?? "", ticketTypeId: a.ticketTypeId ?? "", addTags: (a.addTags ?? []).join(", "),
  });
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV((x) => ({ ...x, [k]: val }));
  const team = teams.find((t) => t.id === v.teamId);
  const save = () => {
    setError(null);
    run(() => saveRoutingRuleAction(orgSlug, rule?.id ?? null, {
      name: v.name, isActive: v.active,
      conditions: { channels: v.channels, priorities: v.priorities, ticketTypeIds: v.ticketTypeIds, formIds: v.formIds, keywords: splitList(v.keywords), customerTags: splitList(v.customerTags) },
      actions: { teamId: v.teamId || null, assign: v.assign, membershipId: v.membershipId || null, priority: v.priority || null, ticketTypeId: v.ticketTypeId || null, addTags: splitList(v.addTags) },
    }), rule ? "Rule saved" : "Rule added", onDone, (r) => setError(firstError(r)));
  };
  return (
    <form className="grid gap-4 p-4" onSubmit={(e) => { e.preventDefault(); save(); }}>
      <div className="flex flex-wrap items-end gap-4">
        <label className="grid flex-1 gap-1 text-sm font-medium">Rule name<Input value={v.name} placeholder="e.g. Delivery problems to the logistics team" onChange={(e) => set("name", e.target.value)} className="max-w-md" /></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-[var(--brand-primary)]" checked={v.active} onChange={(e) => set("active", e.target.checked)} />Active</label>
      </div>
      <div className="grid gap-3 rounded-md bg-muted/40 p-3">
        <p className="text-sm font-medium">When a new ticket… <span className="font-normal text-muted-foreground">(leave everything empty to match all)</span></p>
        <label className="grid gap-1 text-xs font-medium">Mentions any of these words (subject or message)<Input value={v.keywords} placeholder="delivery, courier, tracking" onChange={(e) => set("keywords", e.target.value)} /></label>
        <CheckGroup legend="Came in via" options={Object.entries(CHANNEL_LABELS).map(([value, label]) => ({ value, label }))} value={v.channels} onChange={(x) => set("channels", x)} />
        <CheckGroup legend="Priority" options={Object.entries(PRIORITY_LABELS).map(([value, label]) => ({ value, label }))} value={v.priorities} onChange={(x) => set("priorities", x)} />
        {types.length > 0 && <CheckGroup legend="Ticket type" options={types.map((t) => ({ value: t.id, label: t.name }))} value={v.ticketTypeIds} onChange={(x) => set("ticketTypeIds", x)} />}
        {forms.length > 0 && <CheckGroup legend="Submitted with form" options={forms.map((t) => ({ value: t.id, label: t.name }))} value={v.formIds} onChange={(x) => set("formIds", x)} />}
        <label className="grid gap-1 text-xs font-medium">Customer has any of these tags<Input value={v.customerTags} placeholder="VIP, wholesale" onChange={(e) => set("customerTags", e.target.value)} /></label>
      </div>
      <div className="grid gap-3 rounded-md bg-muted/40 p-3 sm:grid-cols-2">
        <p className="text-sm font-medium sm:col-span-2">Then…</p>
        <label className="grid gap-1 text-xs font-medium">Team
          <NativeSelect value={v.teamId} onChange={(e) => set("teamId", e.target.value)}><option value="">No change</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.members})</option>)}</NativeSelect>
        </label>
        <label className="grid gap-1 text-xs font-medium">Assign
          <NativeSelect value={v.assign} onChange={(e) => set("assign", e.target.value as typeof v.assign)}>
            <option value="none">Don&apos;t assign</option><option value="member">To a specific person</option><option value="round_robin" disabled={!v.teamId}>In turn within the team (round robin)</option>
          </NativeSelect>
        </label>
        {v.assign === "member" && (
          <label className="grid gap-1 text-xs font-medium">Person
            <NativeSelect value={v.membershipId} onChange={(e) => set("membershipId", e.target.value)}><option value="">Choose…</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</NativeSelect>
          </label>
        )}
        {v.assign === "round_robin" && team && team.members === 0 && <p className="text-xs text-warning sm:col-span-2">{team.name} has no members yet, so tickets will stay unassigned.</p>}
        <label className="grid gap-1 text-xs font-medium">Set priority <span className="font-normal text-muted-foreground">(portal tickets only)</span>
          <NativeSelect value={v.priority} onChange={(e) => set("priority", e.target.value)}><option value="">No change</option>{Object.entries(PRIORITY_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</NativeSelect>
        </label>
        <label className="grid gap-1 text-xs font-medium">Set type
          <NativeSelect value={v.ticketTypeId} onChange={(e) => set("ticketTypeId", e.target.value)}><option value="">No change</option>{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</NativeSelect>
        </label>
        <label className="grid gap-1 text-xs font-medium sm:col-span-2">Add tags<Input value={v.addTags} placeholder="shipping" onChange={(e) => set("addTags", e.target.value)} /></label>
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending || !v.name.trim()}>{pending ? "Saving…" : rule ? "Save rule" : "Add rule"}</Button>
        <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}
