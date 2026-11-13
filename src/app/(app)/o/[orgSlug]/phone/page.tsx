import Link from "next/link";
import { forbidden } from "next/navigation";
import { Phone } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { canManagePhone, getPhoneSetup } from "@/domains/phone/account";
import { countNewVoicemails, getPhoneStats } from "@/domains/phone/calls";
import { requireOrgContext } from "@/server/authz/request";
import { formatRelative } from "@/lib/utils";
import { EnablePhoneButton } from "./_components/enable-phone";
import { DirectionIcon, formatDuration, PhoneSubnav } from "./_components/parts";

const STATUS_TONE = { available: "success", busy: "danger", away: "warning", dnd: "danger", offline: "inactive" } as const;
const STATUS_LABEL = { available: "Available", busy: "Busy", away: "Away", dnd: "Do not disturb", offline: "Offline" } as const;

export default async function PhonePage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const ctx = await requireOrgContext(orgSlug);
  const canRead = ctx.permissions.has("calls.read") || ctx.permissions.has("calls.read_assigned");
  const manage = canManagePhone(ctx);
  if (!canRead && !manage) forbidden();
  const setup = await getPhoneSetup(ctx);

  if (!setup.account) {
    return (
      <>
        <PageHeader title="Phone" description="Make and take calls in the browser, with every call logged against the customer." />
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle>Phone isn&apos;t set up yet</CardTitle>
            <CardDescription>
              SalesGel creates a Twilio subaccount just for this workspace. Numbers you buy and calls you make are billed by Twilio on that account.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {!setup.configured ? (
              <p role="status" className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2">
                Calling isn&apos;t available on this server yet: the Twilio platform credentials (and the credential encryption key) haven&apos;t been configured by the server operator.
              </p>
            ) : manage ? (
              <EnablePhoneButton orgSlug={orgSlug} />
            ) : (
              <p className="text-muted-foreground">Ask a workspace admin to enable phone.</p>
            )}
          </CardContent>
        </Card>
      </>
    );
  }

  const [stats, newVm] = canRead ? await Promise.all([getPhoneStats(ctx), countNewVoicemails(ctx)]) : [null, 0];
  return (
    <>
      <PageHeader title="Phone" description={canRead && ctx.permissions.has("calls.read") ? "Team calls over the last 7 days." : "Your calls over the last 7 days."} />
      <PhoneSubnav orgSlug={orgSlug} active="overview" canManage={manage} newVoicemails={newVm} />
      {setup.account.status !== "active" && <p role="alert" className="mb-4 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm">Calling is paused for this workspace{setup.account.lastError ? `: ${setup.account.lastError}` : "."}</p>}
      {!setup.numbers.length && (
        <p role="status" className="mb-4 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm">
          No phone number yet. {manage ? <Link href={`/o/${orgSlug}/phone/settings`} className="text-primary hover:underline">Buy a number</Link> : "Ask an admin to buy one"} to start calling.
        </p>
      )}
      {stats && (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
            <Stat label="Calls" value={stats.total} hint={`${stats.inbound} in · ${stats.outbound} out`} />
            <Stat label="Answer rate" value={stats.answerRate === null ? "—" : `${stats.answerRate}%`} hint="Inbound calls answered" />
            <Stat label="Missed" value={stats.missed} href={`/o/${orgSlug}/phone/calls?outcome=missed`} />
            <Stat label="New voicemail" value={newVm} href={`/o/${orgSlug}/phone/voicemail`} />
            <Stat label="Avg. wait" value={formatDuration(stats.avgWait)} hint="Inbound, until answered" />
            <Stat label="Avg. talk" value={formatDuration(stats.avgTalk)} />
          </div>
          {stats.spendToday && (
            <p className="mt-3 text-xs text-muted-foreground">
              Twilio charges recorded today: {new Intl.NumberFormat("en-US", { style: "currency", currency: stats.spendToday.currency, maximumFractionDigits: 4 }).format(stats.spendToday.micros / 1_000_000)}
              {setup.account.settings.dailySpendLimitCents !== null && <> of a {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(setup.account.settings.dailySpendLimitCents / 100)} daily limit</>}
              {" "}(as priced by Twilio after each call).
            </p>
          )}
          <div className="mt-6 grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader><CardTitle>Live calls</CardTitle></CardHeader>
              <CardContent>
                {stats.live.length ? (
                  <ul className="divide-y">
                    {stats.live.map((c) => (
                      <li key={c.id} className="flex items-center gap-3 py-2 text-sm">
                        <DirectionIcon direction={c.direction} />
                        <Link href={`/o/${orgSlug}/phone/calls/${c.id}`} className="font-medium hover:underline">{c.other}</Link>
                        <Badge tone={c.status === "in_progress" ? "success" : "info"}>{c.status === "in_progress" ? "On call" : "Ringing"}</Badge>
                        <span className="ml-auto text-xs text-muted-foreground">{c.agentName ?? "Waiting"} · {formatRelative(c.startedAt)}</span>
                      </li>
                    ))}
                  </ul>
                ) : <EmptyState icon={<Phone />} title="No calls right now" description="Calls in progress show up here." />}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Team availability</CardTitle><CardDescription>Only Available members ring for inbound calls.</CardDescription></CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  {setup.agents.map((a) => (
                    <li key={a.membershipId} className="flex items-center justify-between gap-2">
                      <span className="truncate">{a.name}</span>
                      <Badge tone={a.activeCallId ? "danger" : STATUS_TONE[a.status]}>{a.activeCallId ? "On a call" : STATUS_LABEL[a.status]}</Badge>
                    </li>
                  ))}
                  {!setup.agents.length && <li className="text-muted-foreground">No one can take calls yet.</li>}
                </ul>
              </CardContent>
            </Card>
          </div>
          {stats.byAgent.length > 0 && (
            <Card className="mt-6">
              <CardHeader><CardTitle>Answered calls by person</CardTitle></CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1 font-medium">Person</th><th className="py-1 text-right font-medium">Calls</th><th className="py-1 text-right font-medium">Talk time</th></tr></thead>
                  <tbody>{stats.byAgent.map((r) => <tr key={r.name} className="border-t"><td className="py-1.5">{r.name}</td><td className="py-1.5 text-right tabular-nums">{r.calls}</td><td className="py-1.5 text-right tabular-nums">{formatDuration(r.talk)}</td></tr>)}</tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </>
  );
}

function Stat({ label, value, hint, href }: { label: string; value: string | number; hint?: string; href?: string }) {
  const body = (
    <Card className="h-full"><CardContent className="p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </CardContent></Card>
  );
  return href ? <Link href={href} className="block rounded-lg focus-visible:outline-2">{body}</Link> : body;
}
