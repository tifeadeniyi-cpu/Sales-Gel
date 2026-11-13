"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, NativeSelect, Textarea } from "@/components/ui/input";
import type { NumberRouting, PhoneSettings } from "@/domains/phone/schema";
import { archiveQueueAction, purchaseNumberAction, releaseNumberAction, saveQueueAction, searchNumbersAction, updateNumberAction, updatePhoneSettingsAction } from "../actions";

type Result = { ok: true; data: unknown } | { ok: false; error: string; fieldErrors?: Record<string, string[]> };
const msg = (r: Extract<Result, { ok: false }>) => Object.values(r.fieldErrors ?? {})[0]?.[0] ?? r.error;
type Opt = { id: string; name: string };

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return { pending, run: (fn: () => Promise<Result>, ok: string, after?: () => void) => start(async () => { const r = await fn(); if (r.ok) { toast.success(ok); after?.(); router.refresh(); } else toast.error(msg(r)); }) };
}

/* ───────── numbers ───────── */

type Num = { id: string; e164: string; label: string | null; routing: NumberRouting };
type Found = { e164: string; display: string; locality: string | null; region: string | null; voice: boolean; sms: boolean };

export function NumbersManager({ orgSlug, numbers, queues, members }: { orgSlug: string; numbers: Num[]; queues: Opt[]; members: Opt[] }) {
  return (
    <div className="space-y-6">
      {numbers.length ? (
        <ul className="divide-y rounded-md border">
          {numbers.map((n) => <NumberRow key={n.id} orgSlug={orgSlug} n={n} queues={queues} members={members} />)}
        </ul>
      ) : <p className="text-sm text-muted-foreground">No numbers yet. Buy one below to start calling.</p>}
      <BuyNumber orgSlug={orgSlug} />
    </div>
  );
}

function NumberRow({ orgSlug, n, queues, members }: { orgSlug: string; n: Num; queues: Opt[]; members: Opt[] }) {
  const { pending, run } = useRun();
  const [label, setLabel] = useState(n.label ?? "");
  const [type, setType] = useState(n.routing.type);
  const [target, setTarget] = useState(n.routing.type === "queue" ? n.routing.queueId ?? "" : n.routing.type === "agent" ? n.routing.membershipId ?? "" : "");
  const routing = type === "queue" ? { type, queueId: target } : type === "agent" ? { type, membershipId: target } : { type };
  return (
    <li className="space-y-2 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium tabular-nums">{n.e164}</p>
        <ConfirmDialog trigger={<Button size="sm" variant="ghost" className="text-danger">Release</Button>} title={`Release ${n.e164}?`}
          description="Twilio gives the number back and you may not get it again. Calls to it will stop reaching you." confirmLabel="Release number" typeToConfirm={n.e164}
          onConfirm={() => releaseNumberAction(orgSlug, n.id)} successMessage="Number released" />
      </div>
      <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); run(() => updateNumberAction(orgSlug, n.id, { label: label || null, routing }), "Routing saved"); }}>
        <div className="grid gap-1"><Label htmlFor={`label-${n.id}`}>Label</Label><Input id={`label-${n.id}`} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Main line" className="w-40" /></div>
        <div className="grid gap-1">
          <Label htmlFor={`route-${n.id}`}>Calls go to</Label>
          <NativeSelect id={`route-${n.id}`} value={type} onChange={(e) => { setType(e.target.value as Num["routing"]["type"]); setTarget(""); }} className="w-36">
            <option value="voicemail">Voicemail</option><option value="queue">A queue</option><option value="agent">A person</option>
          </NativeSelect>
        </div>
        {type !== "voicemail" && (
          <div className="grid gap-1">
            <Label htmlFor={`target-${n.id}`}>{type === "queue" ? "Queue" : "Person"}</Label>
            <NativeSelect id={`target-${n.id}`} value={target} onChange={(e) => setTarget(e.target.value)} className="w-48" required>
              <option value="">Choose…</option>
              {(type === "queue" ? queues : members).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </NativeSelect>
          </div>
        )}
        <Button type="submit" size="sm" variant="outline" disabled={pending || (type !== "voicemail" && !target)}>Save</Button>
      </form>
    </li>
  );
}

function BuyNumber({ orgSlug }: { orgSlug: string }) {
  const [areaCode, setAreaCode] = useState("");
  const [contains, setContains] = useState("");
  const [found, setFound] = useState<Found[] | null>(null);
  const [searching, start] = useTransition();
  return (
    <div className="space-y-3 rounded-md border border-dashed p-3">
      <p className="text-sm font-medium">Buy a US number</p>
      <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await searchNumbersAction(orgSlug, { areaCode, contains }); if (r.ok) setFound(r.data); else toast.error(msg(r)); }); }}>
        <div className="grid gap-1"><Label htmlFor="area">Area code</Label><Input id="area" value={areaCode} onChange={(e) => setAreaCode(e.target.value)} inputMode="numeric" maxLength={3} placeholder="512" className="w-24" /></div>
        <div className="grid gap-1"><Label htmlFor="contains">Contains</Label><Input id="contains" value={contains} onChange={(e) => setContains(e.target.value)} inputMode="numeric" placeholder="optional" className="w-32" /></div>
        <Button type="submit" variant="outline" size="sm" disabled={searching}>{searching ? "Searching…" : "Search"}</Button>
      </form>
      {found && (found.length ? (
        <ul className="divide-y rounded-md border">
          {found.map((f) => (
            <li key={f.e164} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <span><span className="font-medium tabular-nums">{f.display}</span> <span className="text-xs text-muted-foreground">{[f.locality, f.region].filter(Boolean).join(", ")}</span> {f.sms && <Badge>SMS</Badge>}</span>
              <ConfirmDialog trigger={<Button size="sm">Buy</Button>} title={`Buy ${f.display}?`} confirmVariant="default" confirmLabel="Buy number"
                description="Twilio charges a monthly fee for this number to the workspace's Twilio account, starting today. You can release it later."
                onConfirm={async () => { const r = await purchaseNumberAction(orgSlug, { e164: f.e164 }); if (r.ok) setFound(null); return r; }} successMessage="Number bought" />
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-muted-foreground">No numbers available for that search. Try another area code.</p>)}
    </div>
  );
}

/* ───────── queues ───────── */

type Queue = { id: string; name: string; strategy: "simultaneous" | "round_robin"; ringTimeoutSec: number; fallback: "voicemail" | "hangup"; memberIds: string[] };
const EMPTY: Omit<Queue, "id"> = { name: "", strategy: "simultaneous", ringTimeoutSec: 20, fallback: "voicemail", memberIds: [] };

export function QueuesManager({ orgSlug, queues, members }: { orgSlug: string; queues: Queue[]; members: Opt[] }) {
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const { run } = useRun();
  return (
    <div className="space-y-3">
      {queues.map((q) => editing === q.id ? (
        <QueueForm key={q.id} orgSlug={orgSlug} id={q.id} initial={q} members={members} onDone={() => setEditing(null)} />
      ) : (
        <div key={q.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
          <div>
            <p className="font-medium">{q.name}</p>
            <p className="text-xs text-muted-foreground">{q.strategy === "simultaneous" ? "Rings everyone at once" : "Rings one at a time"} · {q.ringTimeoutSec}s · then {q.fallback === "voicemail" ? "voicemail" : "hang up"} · {q.memberIds.length} {q.memberIds.length === 1 ? "member" : "members"}</p>
          </div>
          <div className="flex gap-1">
            <Button size="sm" variant="outline" onClick={() => setEditing(q.id)}>Edit</Button>
            <Button size="sm" variant="ghost" onClick={() => run(() => archiveQueueAction(orgSlug, q.id), "Queue archived")}>Archive</Button>
          </div>
        </div>
      ))}
      {editing === "new" ? <QueueForm orgSlug={orgSlug} id={null} initial={EMPTY} members={members} onDone={() => setEditing(null)} />
        : <Button size="sm" variant="outline" onClick={() => setEditing("new")}>New queue</Button>}
    </div>
  );
}

function QueueForm({ orgSlug, id, initial, members, onDone }: { orgSlug: string; id: string | null; initial: Omit<Queue, "id">; members: Opt[]; onDone: () => void }) {
  const { pending, run } = useRun();
  const [q, setQ] = useState(initial);
  const toggle = (m: string) => setQ((x) => ({ ...x, memberIds: x.memberIds.includes(m) ? x.memberIds.filter((i) => i !== m) : [...x.memberIds, m] }));
  const fid = id ?? "new";
  return (
    <form className="space-y-3 rounded-md border p-3" onSubmit={(e) => { e.preventDefault(); run(() => saveQueueAction(orgSlug, id, q), id ? "Queue saved" : "Queue created", onDone); }}>
      <div className="flex flex-wrap gap-3">
        <div className="grid gap-1"><Label htmlFor={`qn-${fid}`}>Queue name</Label><Input id={`qn-${fid}`} value={q.name} onChange={(e) => setQ({ ...q, name: e.target.value })} className="w-48" /></div>
        <div className="grid gap-1"><Label htmlFor={`qs-${fid}`}>Ringing</Label>
          <NativeSelect id={`qs-${fid}`} value={q.strategy} onChange={(e) => setQ({ ...q, strategy: e.target.value as Queue["strategy"] })} className="w-48"><option value="simultaneous">Everyone at once</option><option value="round_robin">One at a time (rotating)</option></NativeSelect>
        </div>
        <div className="grid gap-1"><Label htmlFor={`qt-${fid}`}>Ring for (seconds)</Label><Input id={`qt-${fid}`} type="number" min={5} max={120} value={q.ringTimeoutSec} onChange={(e) => setQ({ ...q, ringTimeoutSec: Number(e.target.value) })} className="w-28" /></div>
        <div className="grid gap-1"><Label htmlFor={`qf-${fid}`}>If no one answers</Label>
          <NativeSelect id={`qf-${fid}`} value={q.fallback} onChange={(e) => setQ({ ...q, fallback: e.target.value as Queue["fallback"] })} className="w-40"><option value="voicemail">Voicemail</option><option value="hangup">Hang up politely</option></NativeSelect>
        </div>
      </div>
      <fieldset>
        <legend className="mb-1 text-xs font-medium">Members</legend>
        {members.length ? <div className="flex flex-wrap gap-x-4 gap-y-1">{members.map((m) => (
          <label key={m.id} className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={q.memberIds.includes(m.id)} onChange={() => toggle(m.id)} /> {m.name}</label>
        ))}</div> : <p className="text-sm text-muted-foreground">No one has permission to take calls yet.</p>}
      </fieldset>
      <div className="flex gap-2"><Button type="submit" size="sm" disabled={pending}>{id ? "Save queue" : "Create queue"}</Button><Button type="button" size="sm" variant="ghost" onClick={onDone}>Cancel</Button></div>
    </form>
  );
}

/* ───────── calling rules ───────── */

export function CallingRules({ orgSlug, settings }: { orgSlug: string; settings: PhoneSettings }) {
  const { pending, run } = useRun();
  const [s, setS] = useState({ ...settings, countries: settings.allowedCountries.join(", "), limit: settings.dailySpendLimitCents === null ? "" : (settings.dailySpendLimitCents / 100).toFixed(2) });
  const submit = () => run(() => updatePhoneSettingsAction(orgSlug, {
    allowedCountries: s.countries.split(/[\s,]+/).filter(Boolean).map((c) => c.toUpperCase()),
    blockPremium: s.blockPremium, dailySpendLimitCents: s.limit.trim() === "" ? null : Math.round(Number(s.limit) * 100),
    ringTimeoutSec: s.ringTimeoutSec, voicemailGreeting: s.voicemailGreeting, afterHours: s.afterHours, useBusinessHours: s.useBusinessHours,
  }), "Calling rules saved");
  return (
    <form className="grid max-w-2xl gap-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <div className="grid gap-1"><Label htmlFor="countries">Countries people can call</Label><Input id="countries" value={s.countries} onChange={(e) => setS({ ...s, countries: e.target.value })} placeholder="US, CA" /><p className="text-xs text-muted-foreground">Two-letter country codes. Emergency numbers can never be dialed from the browser.</p></div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={s.blockPremium} onChange={(e) => setS({ ...s, blockPremium: e.target.checked })} /> Block premium-rate and shared-cost numbers</label>
      <div className="grid gap-1"><Label htmlFor="limit">Daily spending limit (USD)</Label><Input id="limit" type="number" min={1} step="0.01" value={s.limit} onChange={(e) => setS({ ...s, limit: e.target.value })} className="w-40" placeholder="No limit" /><p className="text-xs text-muted-foreground">Outbound calls stop for the day once Twilio&apos;s billed charges reach this.</p></div>
      <div className="grid gap-1"><Label htmlFor="ring">Ring a person for (seconds)</Label><Input id="ring" type="number" min={5} max={60} value={s.ringTimeoutSec} onChange={(e) => setS({ ...s, ringTimeoutSec: Number(e.target.value) })} className="w-28" /></div>
      <div className="grid gap-1"><Label htmlFor="greeting">Voicemail greeting</Label><Textarea id="greeting" rows={2} value={s.voicemailGreeting} onChange={(e) => setS({ ...s, voicemailGreeting: e.target.value })} /><p className="text-xs text-muted-foreground">Read aloud to callers before the tone.</p></div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={s.useBusinessHours} onChange={(e) => setS({ ...s, useBusinessHours: e.target.checked })} /> Use business hours</label>
      {s.useBusinessHours && (
        <div className="grid gap-1"><Label htmlFor="after">Outside business hours</Label>
          <NativeSelect id="after" value={s.afterHours} onChange={(e) => setS({ ...s, afterHours: e.target.value as PhoneSettings["afterHours"] })} className="w-64"><option value="voicemail">Send callers to voicemail</option><option value="ring">Ring as usual</option></NativeSelect>
        </div>
      )}
      <div><Button type="submit" disabled={pending}>Save calling rules</Button></div>
    </form>
  );
}
