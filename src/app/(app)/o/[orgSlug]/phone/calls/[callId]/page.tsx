import Link from "next/link";
import { forbidden, notFound } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { CallButton } from "@/components/app/softphone";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCall } from "@/domains/phone/calls";
import { requireOrgContext } from "@/server/authz/request";
import { NotFoundError } from "@/server/errors";
import { formatDateTime } from "@/lib/utils";
import { DirectionIcon, formatDuration, OutcomeBadge } from "../../_components/parts";
import { CallActions, CallNotes } from "./call-client";

const EVENT_LABEL: Record<string, string> = { initiated: "Started", ringing: "Ringing", "in-progress": "Connected", answered: "Connected", completed: "Ended", busy: "Busy", "no-answer": "No answer", failed: "Failed", canceled: "Canceled" };
const LEG_LABEL: Record<string, string> = { customer: "Caller", agent: "Team member", pstn: "Phone network" };

export default async function CallPage({ params }: { params: Promise<{ orgSlug: string; callId: string }> }) {
  const { orgSlug, callId } = await params;
  const ctx = await requireOrgContext(orgSlug);
  if (!ctx.permissions.has("calls.read") && !ctx.permissions.has("calls.read_assigned")) forbidden();
  const d = await getCall(ctx, callId).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  const c = d.call;
  const other = c.direction === "inbound" ? c.fromE164 : c.toE164;
  const tz = ctx.timezone;
  return (
    <>
      <PageHeader
        title={`Call #${c.number}`}
        description={<span className="inline-flex items-center gap-2"><DirectionIcon direction={c.direction} /> {c.direction === "inbound" ? "Inbound" : "Outbound"} · {formatDateTime(c.startedAt, tz)}</span>}
        actions={<>
          {ctx.permissions.has("calls.make") && <CallButton dial={{ to: other, customerId: c.customerId ?? undefined, label: d.customer?.name ?? undefined }} />}
          <Link href={`/o/${orgSlug}/phone/calls`} className="self-center text-sm text-primary hover:underline">All calls</Link>
        </>}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader><CardTitle>Summary</CardTitle></CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
                <Item label="Outcome"><OutcomeBadge outcome={c.outcome} status={c.status} /></Item>
                <Item label={c.direction === "inbound" ? "From" : "To"}><span className="tabular-nums">{other}</span></Item>
                <Item label="Line">{d.businessNumber ? `${d.businessNumber.label ? `${d.businessNumber.label} · ` : ""}${d.businessNumber.e164}` : "—"}</Item>
                <Item label="Handled by">{d.agent?.name ?? "—"}</Item>
                {d.queue && <Item label="Queue">{d.queue.name}</Item>}
                <Item label="Talk time">{formatDuration(c.answeredAt ? c.durationSec : null)}</Item>
                {c.direction === "inbound" && c.answeredAt && <Item label="Waited">{formatDuration(Math.round((c.answeredAt.getTime() - c.startedAt.getTime()) / 1000))}</Item>}
                {c.priceMicros !== null && <Item label="Twilio cost">{new Intl.NumberFormat("en-US", { style: "currency", currency: c.priceCurrency ?? "USD", maximumFractionDigits: 4 }).format(c.priceMicros / 1_000_000)}</Item>}
              </dl>
            </CardContent>
          </Card>
          {d.voicemails.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Voicemail</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {d.voicemails.map((v) => (
                  <div key={v.id} className="space-y-1">
                    <audio controls preload="none" src={`/o/${orgSlug}/phone/voicemail/${v.id}/audio`} className="w-full" aria-label={`Voicemail, ${formatDuration(v.durationSec)}`} />
                    <p className="text-xs text-muted-foreground">{formatDuration(v.durationSec)} · {v.status === "new" ? "Not reviewed" : v.status}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader><CardTitle>Notes</CardTitle></CardHeader>
            <CardContent><CallNotes orgSlug={orgSlug} callId={c.id} notes={d.notes.map((n) => ({ ...n, createdAt: n.createdAt.toISOString() }))} timezone={tz} /></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Timeline</CardTitle></CardHeader>
            <CardContent>
              {d.events.length ? (
                <ol className="space-y-1.5 text-sm">
                  {d.events.map((e, i) => (
                    <li key={i} className="flex gap-3"><span className="w-40 shrink-0 text-xs tabular-nums text-muted-foreground">{formatDateTime(e.occurredAt, tz)}</span><span>{EVENT_LABEL[e.kind] ?? e.kind}{e.payload.CallSid && e.payload.CallSid !== c.providerCallSid ? " · leg" : ""}</span></li>
                  ))}
                </ol>
              ) : <p className="text-sm text-muted-foreground">No status updates from Twilio yet.</p>}
              {d.legs.length > 0 && (
                <ul className="mt-4 space-y-1 border-t pt-3 text-xs text-muted-foreground">
                  {d.legs.map((l) => <li key={l.id}>{LEG_LABEL[l.kind] ?? l.kind}: {l.agentName ?? l.target} · {l.status.replace("_", " ")}{l.durationSec !== null ? ` · ${formatDuration(l.durationSec)}` : ""}</li>)}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
        <CallActions
          orgSlug={orgSlug}
          callId={c.id}
          links={{ customer: d.customer, lead: d.lead ? { id: d.lead.id, name: d.lead.name } : null, order: d.order ? { id: d.order.id, name: `Order #${d.order.number}` } : null, ticket: d.ticket ? { id: d.ticket.id, name: `#${d.ticket.number} ${d.ticket.subject}` } : null }}
          can={{ customers: ctx.permissions.has("customers.read") || ctx.permissions.has("customers.read_assigned"), leads: ctx.permissions.has("leads.read") || ctx.permissions.has("leads.read_assigned"), tasks: ctx.permissions.has("tasks.write"), tickets: ctx.permissions.has("tickets.write") }}
          defaultSubject={`Call from ${d.customer?.name ?? other}`}
        />
      </div>
    </>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-0.5">{children}</dd></div>;
}
