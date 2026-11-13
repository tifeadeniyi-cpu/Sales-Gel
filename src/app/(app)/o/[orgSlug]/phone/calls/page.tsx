import Link from "next/link";
import { forbidden } from "next/navigation";
import { PhoneCall } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { canManagePhone } from "@/domains/phone/account";
import { CALL_OUTCOMES, countNewVoicemails, listCalls } from "@/domains/phone/calls";
import { requireOrgContext } from "@/server/authz/request";
import { formatDateTime } from "@/lib/utils";
import { CustomerOrNumber, DirectionIcon, formatDuration, OutcomeBadge, PhoneSubnav } from "../_components/parts";

const OUTCOME_LABEL: Record<(typeof CALL_OUTCOMES)[number], string> = { answered: "Answered", missed: "Missed", voicemail: "Voicemail", no_answer: "No answer", busy: "Busy", failed: "Failed", canceled: "Canceled" };

export default async function CallsPage({ params, searchParams }: { params: Promise<{ orgSlug: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { orgSlug } = await params;
  const sp = await searchParams;
  const ctx = await requireOrgContext(orgSlug);
  if (!ctx.permissions.has("calls.read") && !ctx.permissions.has("calls.read_assigned")) forbidden();
  const [{ rows, hasMore, page }, newVm] = await Promise.all([listCalls(ctx, { direction: sp.direction as never, outcome: sp.outcome as never, q: sp.q, customer: sp.customer, page: sp.page as never }), countNewVoicemails(ctx)]);
  const qs = (p: number) => { const u = new URLSearchParams(Object.entries(sp).filter((e): e is [string, string] => !!e[1])); u.set("page", String(p)); return `?${u}`; };
  const filtered = !!(sp.direction || sp.outcome || sp.q || sp.customer);
  return (
    <>
      <PageHeader title="Phone" description="Every call your team makes or receives." />
      <PhoneSubnav orgSlug={orgSlug} active="calls" canManage={canManagePhone(ctx)} newVoicemails={newVm} />
      <form className="mb-4 flex flex-wrap items-end gap-2" role="search">
        <Input name="q" defaultValue={sp.q} placeholder="Name or number" aria-label="Search calls" className="w-56" />
        <NativeSelect name="direction" defaultValue={sp.direction ?? ""} aria-label="Direction" className="w-36">
          <option value="">All directions</option><option value="inbound">Inbound</option><option value="outbound">Outbound</option>
        </NativeSelect>
        <NativeSelect name="outcome" defaultValue={sp.outcome ?? ""} aria-label="Outcome" className="w-36">
          <option value="">All outcomes</option>
          {CALL_OUTCOMES.map((o) => <option key={o} value={o}>{OUTCOME_LABEL[o]}</option>)}
        </NativeSelect>
        <Button type="submit" variant="outline">Filter</Button>
        {filtered && <Link href={`/o/${orgSlug}/phone/calls`} className="text-sm text-primary hover:underline">Clear</Link>}
      </form>
      {rows.length ? (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm">
            <caption className="sr-only">Calls</caption>
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr><th className="px-3 py-2 font-medium">Call</th><th className="px-3 py-2 font-medium">Who</th><th className="px-3 py-2 font-medium">Line</th><th className="px-3 py-2 font-medium">Handled by</th><th className="px-3 py-2 font-medium">Outcome</th><th className="px-3 py-2 text-right font-medium">Duration</th><th className="px-3 py-2 font-medium">When</th></tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="border-t hover:bg-muted/30">
                  <td className="px-3 py-2"><Link href={`/o/${orgSlug}/phone/calls/${c.id}`} className="inline-flex items-center gap-2 font-medium hover:underline"><DirectionIcon direction={c.direction} /> #{c.number}</Link></td>
                  <td className="px-3 py-2"><CustomerOrNumber orgSlug={orgSlug} customerId={c.customerId} name={c.customerName} number={c.direction === "inbound" ? c.fromE164 : c.toE164} /></td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{c.businessLabel ?? c.businessNumber ?? "—"}</td>
                  <td className="px-3 py-2">{c.agentName ?? <span className="text-muted-foreground">—</span>}</td>
                  <td className="px-3 py-2"><OutcomeBadge outcome={c.outcome} status={c.status} /></td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatDuration(c.durationSec)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs text-muted-foreground">{formatDateTime(c.startedAt, ctx.timezone)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState icon={<PhoneCall />} title={filtered ? "No calls match" : "No calls yet"} description={filtered ? "Try different filters." : "Calls appear here as soon as they happen."} />
      )}
      {(page > 1 || hasMore) && (
        <div className="mt-4 flex justify-between text-sm">
          {page > 1 ? <Link href={qs(page - 1)} className="text-primary hover:underline">← Newer</Link> : <span />}
          {hasMore && <Link href={qs(page + 1)} className="text-primary hover:underline">Older →</Link>}
        </div>
      )}
    </>
  );
}
