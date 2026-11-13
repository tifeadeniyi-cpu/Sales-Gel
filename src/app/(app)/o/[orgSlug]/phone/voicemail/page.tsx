import { forbidden } from "next/navigation";
import { Voicemail } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { LinkTabs } from "@/components/ui/tabs";
import { canManagePhone, getPhoneSetup } from "@/domains/phone/account";
import { countNewVoicemails, listVoicemails } from "@/domains/phone/calls";
import { requireOrgContext } from "@/server/authz/request";
import { PhoneSubnav } from "../_components/parts";
import { VoicemailItem } from "./voicemail-client";

const STATUSES = ["new", "reviewed", "archived"] as const;

export default async function VoicemailPage({ params, searchParams }: { params: Promise<{ orgSlug: string }>; searchParams: Promise<{ status?: string }> }) {
  const { orgSlug } = await params;
  const sp = await searchParams;
  const ctx = await requireOrgContext(orgSlug);
  if (!ctx.permissions.has("calls.read") && !ctx.permissions.has("calls.read_assigned")) forbidden();
  const status = STATUSES.find((s) => s === sp.status) ?? "new";
  const [items, newVm, setup] = await Promise.all([listVoicemails(ctx, status), countNewVoicemails(ctx), getPhoneSetup(ctx)]);
  const base = `/o/${orgSlug}/phone/voicemail`;
  const canDelete = ctx.permissions.has("calls.read") || canManagePhone(ctx);
  return (
    <>
      <PageHeader title="Phone" description="Messages callers left when no one could answer." />
      <PhoneSubnav orgSlug={orgSlug} active="voicemail" canManage={canManagePhone(ctx)} newVoicemails={newVm} />
      <div className="mb-4"><LinkTabs active={status} tabs={[{ key: "new", label: "New", href: base }, { key: "reviewed", label: "Reviewed", href: `${base}?status=reviewed` }, { key: "archived", label: "Archived", href: `${base}?status=archived` }]} /></div>
      {items.length ? (
        <ul className="space-y-3">
          {items.map((v) => (
            <VoicemailItem key={v.id} orgSlug={orgSlug} timezone={ctx.timezone} canDelete={canDelete} members={setup.agents.map((a) => ({ id: a.membershipId, name: a.name }))}
              vm={{ ...v, createdAt: v.createdAt.toISOString() }} />
          ))}
        </ul>
      ) : <EmptyState icon={<Voicemail />} title={status === "new" ? "No new voicemail" : `No ${status} voicemail`} description={status === "new" ? "When callers leave a message, it shows up here." : undefined} />}
    </>
  );
}
