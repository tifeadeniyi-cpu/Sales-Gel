import { FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { TicketDetail } from "@/domains/support/service";
import { CHANNEL_LABELS } from "@/domains/support/validation";
import { describeAudit } from "@/lib/audit-labels";
import { cn, formatDateTime, formatRelative } from "@/lib/utils";
import type { OrgContext } from "@/server/authz/context";
import { SLA_LABEL, SLA_TONE, slaClock, type SlaState } from "@/domains/support/sla-state";
import { Composer } from "./composer";
import { CATEGORY_TONE, PRIORITY } from "./labels";
import { StatusControl, TicketProperties } from "./ticket-properties";
import type { loadTicketLookups } from "./load";

type Lookups = Awaited<ReturnType<typeof loadTicketLookups>>;

const KIND = {
  reply: { label: "Reply", cls: "border-primary/30 bg-primary/5" },
  note: { label: "Internal note", cls: "border-highlight/40 bg-highlight/10" },
  customer: { label: "Customer", cls: "bg-card" },
} as const;

function fmtSize(n: number) {
  return n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`;
}

export function TicketBadges({ t }: { t: Pick<TicketDetail, "statusCategory" | "statusName" | "priority"> }) {
  return (
    <span className="inline-flex flex-wrap gap-1.5">
      <Badge tone={CATEGORY_TONE[t.statusCategory]}>{t.statusName}</Badge>
      <Badge tone={PRIORITY[t.priority]?.tone}>{PRIORITY[t.priority]?.label} priority</Badge>
    </span>
  );
}

export function TicketConversation({ ctx, orgSlug, t }: { ctx: OrgContext; orgSlug: string; t: TicketDetail }) {
  const att = (a: { id: string; filename: string; mimeType: string; size: number }) => {
    const href = `/o/${orgSlug}/support/attachments/${a.id}`;
    return a.mimeType.startsWith("image/") ? (
      <a key={a.id} href={href} target="_blank" rel="noreferrer" className="block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={href} alt={a.filename} className="h-24 rounded-md border object-cover" />
      </a>
    ) : (
      <a key={a.id} href={href} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs hover:bg-muted">
        <FileText className="size-3.5" /> {a.filename} <span className="text-muted-foreground">{fmtSize(a.size)}</span>
      </a>
    );
  };
  return (
    <div className="space-y-3">
      {t.messages.length === 0 && <p className="text-sm text-muted-foreground">No messages yet. Log what the customer said or add a note.</p>}
      {t.messages.map((m) => (
        <article key={m.id} className={cn("rounded-lg border p-3", KIND[m.kind as keyof typeof KIND].cls, m.kind === "customer" ? "mr-8" : "ml-8")} aria-label={KIND[m.kind as keyof typeof KIND].label}>
          <header className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="font-medium text-ink">{m.kind === "customer" ? (t.customerName ?? "Customer") : (m.authorName ?? "Team member")}</span>
            <Badge tone={m.kind === "note" ? "highlight" : m.kind === "reply" ? "brand" : "neutral"}>{KIND[m.kind as keyof typeof KIND].label}</Badge>
            {m.kind === "customer" && m.channel && <span>via {CHANNEL_LABELS[m.channel as keyof typeof CHANNEL_LABELS] ?? m.channel}{m.authorName ? ` · logged by ${m.authorName}` : ""}</span>}
            {m.kind === "reply" && m.deliveryStatus === "not_sent" && (t.portalAccess
              ? <span title="The customer can read this on their portal page">Visible in customer portal</span>
              : <span title="Channel delivery arrives with the Inbox build">Not sent to customer</span>)}
            <time className="ml-auto" dateTime={m.createdAt.toISOString()} title={formatDateTime(m.createdAt, ctx.timezone)}>{formatRelative(m.createdAt)}</time>
          </header>
          <p className="whitespace-pre-wrap text-sm">{m.body}</p>
          {m.attachments.length > 0 && <div className="mt-2 flex flex-wrap gap-2">{m.attachments.map(att)}</div>}
        </article>
      ))}
      {t.attachments.length > 0 && <div className="flex flex-wrap gap-2">{t.attachments.map(att)}</div>}
    </div>
  );
}

function SlaRow({ label, state, due, tz, note }: { label: string; state: SlaState; due: Date | null; tz: string; note?: string }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <div>
        <div className="font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">
          {note ?? (due ? `${state === "met" || state === "breached" ? "Target was" : "Due"} ${formatDateTime(due, tz)}` : state === "met" ? "Target met" : "No target")}
        </div>
      </div>
      <Badge tone={SLA_TONE[state]}>{state === "on_track" || state === "at_risk" ? `${SLA_LABEL[state]} · ${formatRelative(due!)}` : SLA_LABEL[state]}</Badge>
    </div>
  );
}

function SlaCard({ ctx, t }: { ctx: OrgContext; t: TicketDetail }) {
  const s = t.sla!;
  const done = ["resolved", "closed"].includes(t.statusCategory);
  const fr = slaClock(s.firstResponseDueAt, !!t.firstRespondedAt, s.firstResponseBreachedAt, new Date(), { met: s.firstResponseMet });
  const res = slaClock(s.resolutionDueAt, done, s.resolutionBreachedAt, new Date(), { paused: s.paused && !done });
  return (
    <Card>
      <CardHeader><CardTitle>SLA</CardTitle><p className="text-xs text-muted-foreground">{s.policy}{s.escalatedAt ? ` · escalated ${formatRelative(s.escalatedAt)}` : ""}</p></CardHeader>
      <CardContent className="space-y-3 text-sm">
        <SlaRow label="First reply" state={fr} due={s.firstResponseDueAt} tz={ctx.timezone} note={!s.firstResponseDueAt && !s.firstResponseBreachedAt ? "No target" : undefined} />
        <SlaRow label="Resolution" state={res} due={s.resolutionDueAt} tz={ctx.timezone} note={res === "paused" ? "Paused while waiting on the customer" : undefined} />
      </CardContent>
    </Card>
  );
}

export function TicketWorkspace({ ctx, orgSlug, t, lookups, timeline }: { ctx: OrgContext; orgSlug: string; t: TicketDetail; lookups: Lookups; timeline?: { id: string; action: string; actorName: string | null; createdAt: Date }[] }) {
  const canWrite = ctx.permissions.has("tickets.write");
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
      <div className="space-y-4">
        <TicketConversation ctx={ctx} orgSlug={orgSlug} t={t} />
        {canWrite && <Composer orgSlug={orgSlug} ticketId={t.id} closed={t.statusCategory === "closed"} contact={t.contactEmail ?? t.contactPhone} portal={!!t.portalAccess} />}
      </div>
      <div className="space-y-4">
        <Card>
          <CardContent className="space-y-4 pt-5">
            <div>
              <div className="mb-1 text-xs text-muted-foreground">Status</div>
              <StatusControl orgSlug={orgSlug} t={t} statuses={lookups.statuses} canWrite={canWrite} />
            </div>
            <TicketProperties orgSlug={orgSlug} t={t} types={lookups.lookups.types} members={lookups.lookups.members} canWrite={canWrite} canAssign={lookups.lookups.canAssign} canLinkOrders={lookups.lookups.canLinkOrders} />
            <div className="border-t pt-3 text-xs text-muted-foreground">
              Opened {formatDateTime(t.createdAt, ctx.timezone)} via {CHANNEL_LABELS[t.channel as keyof typeof CHANNEL_LABELS] ?? t.channel}
              {t.firstRespondedAt && <> · first reply {formatRelative(t.firstRespondedAt)}</>}
              {t.reopenedCount > 0 && <> · reopened {t.reopenedCount}×</>}
            </div>
          </CardContent>
        </Card>
        {t.sla && <SlaCard ctx={ctx} t={t} />}
        {t.form && (
          <Card>
            <CardHeader><CardTitle>Form answers</CardTitle><p className="text-xs text-muted-foreground">{t.form.name} · version {t.form.version}</p></CardHeader>
            <CardContent>
              <dl className="space-y-2 text-sm">
                {t.form.answers.map((a) => (
                  <div key={a.key}>
                    <dt className="text-xs text-muted-foreground">{a.label}</dt>
                    <dd className="whitespace-pre-wrap break-words">{a.value === null || a.value === "" ? <span className="text-muted-foreground">—</span> : a.value === true ? "Yes" : Array.isArray(a.value) ? a.value.join(", ") : String(a.value)}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
        )}
        {timeline && (
          <Card>
            <CardHeader><CardTitle>Activity</CardTitle></CardHeader>
            <CardContent>
              <ol className="space-y-2 text-xs">
                {timeline.slice(0, 20).map((e) => (
                  <li key={e.id}><span className="font-medium">{e.actorName ?? "System"}</span> {describeAudit(e.action)} <span className="text-muted-foreground">· {formatRelative(e.createdAt)}</span></li>
                ))}
              </ol>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
