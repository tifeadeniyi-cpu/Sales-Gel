import Link from "next/link";
import { forbidden, notFound } from "next/navigation";
import { CallButton } from "@/components/app/softphone";
import { softphoneConfig } from "@/domains/phone/account";
import { getTicket, getTicketTimeline } from "@/domains/support/service";
import { canAny } from "@/server/authz/guards";
import { requireOrgContext } from "@/server/authz/request";
import { ticketNo } from "../_components/labels";
import { loadTicketLookups } from "../_components/load";
import { TicketBadges, TicketWorkspace } from "../_components/ticket-view";

export default async function TicketPage({ params }: { params: Promise<{ orgSlug: string; id: string }> }) {
  const { orgSlug, id } = await params;
  const ctx = await requireOrgContext(orgSlug);
  if (!canAny(ctx, "tickets.read", "tickets.read_assigned")) forbidden();
  const t = /^[0-9a-f-]{36}$/i.test(id) ? await getTicket(ctx, id) : null;
  if (!t) notFound();
  const [lookups, timeline, phone] = await Promise.all([loadTicketLookups(ctx), getTicketTimeline(ctx, t.id), softphoneConfig(ctx)]);
  return (
    <>
      <Link href={`/o/${orgSlug}/support/tickets`} className="text-sm text-primary hover:underline">← Tickets</Link>
      <div className="mb-6 mt-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm text-muted-foreground">{ticketNo(t.number)}</div>
          <h1 className="text-2xl font-semibold tracking-tight">{t.subject}</h1>
          <div className="mt-1"><TicketBadges t={t} /></div>
        </div>
        {phone && t.contactPhone && <CallButton dial={{ to: t.contactPhone, customerId: t.customerId ?? undefined, ticketId: t.id, label: `ticket ${ticketNo(t.number)}` }} />}
      </div>
      <TicketWorkspace ctx={ctx} orgSlug={orgSlug} t={t} lookups={lookups} timeline={timeline} />
    </>
  );
}
