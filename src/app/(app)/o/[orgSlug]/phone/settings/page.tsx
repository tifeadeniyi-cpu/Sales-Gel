import Link from "next/link";
import { forbidden, redirect } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { canManagePhone, getPhoneSetup } from "@/domains/phone/account";
import { countNewVoicemails } from "@/domains/phone/calls";
import { requireOrgContext } from "@/server/authz/request";
import { PhoneSubnav } from "../_components/parts";
import { CallingRules, NumbersManager, QueuesManager } from "./settings-client";

export default async function PhoneSettingsPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const ctx = await requireOrgContext(orgSlug);
  if (!canManagePhone(ctx)) forbidden();
  const [setup, newVm] = await Promise.all([getPhoneSetup(ctx), countNewVoicemails(ctx)]);
  if (!setup.account) redirect(`/o/${orgSlug}/phone`);
  const members = setup.agents.map((a) => ({ id: a.membershipId, name: a.name }));
  return (
    <>
      <PageHeader title="Phone" description={<>Twilio subaccount <code className="text-xs">{setup.account.subaccount}</code>. Numbers and calls are billed by Twilio.</>} />
      <PhoneSubnav orgSlug={orgSlug} active="settings" canManage newVoicemails={newVm} />
      <div className="space-y-6">
        <Card>
          <CardHeader><CardTitle>Phone numbers</CardTitle><CardDescription>Each number rings a person, a queue, or goes straight to voicemail.</CardDescription></CardHeader>
          <CardContent><NumbersManager orgSlug={orgSlug} numbers={setup.numbers} queues={setup.queues.map((q) => ({ id: q.id, name: q.name }))} members={members} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Queues</CardTitle><CardDescription>Groups of people who answer together. Only members set to Available ring.</CardDescription></CardHeader>
          <CardContent><QueuesManager orgSlug={orgSlug} queues={setup.queues.map((q) => ({ id: q.id, name: q.name, strategy: q.strategy as "simultaneous" | "round_robin", ringTimeoutSec: q.ringTimeoutSec, fallback: q.fallback as "voicemail" | "hangup", memberIds: q.memberIds }))} members={members} /></CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Calling rules</CardTitle>
            <CardDescription>Business hours come from <Link href={`/o/${orgSlug}/settings/support/hours`} className="text-primary hover:underline">support business hours</Link>.</CardDescription>
          </CardHeader>
          <CardContent><CallingRules orgSlug={orgSlug} settings={setup.account.settings} /></CardContent>
        </Card>
      </div>
    </>
  );
}
