import Link from "next/link";
import { forbidden } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { canManageChannels, listChannels } from "@/domains/inbox/connections";
import { canUseInbox, listSavedReplies } from "@/domains/inbox/service";
import { appUrl } from "@/server/app-url";
import { requireOrgContext } from "@/server/authz/request";
import { encryptionConfigured } from "@/server/crypto";
import { ChannelSetup, SavedRepliesManager } from "./settings-client";

export default async function InboxSettingsPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const ctx = await requireOrgContext(orgSlug);
  if (!canUseInbox(ctx) && !canManageChannels(ctx)) forbidden();
  const [channels, saved] = await Promise.all([listChannels(ctx), canUseInbox(ctx) ? listSavedReplies(ctx) : Promise.resolve([])]);
  return (
    <>
      <PageHeader title="Inbox settings" description="Connected channels and saved replies." actions={<Link href={`/o/${orgSlug}/inbox`} className="text-sm text-primary hover:underline">Back to inbox</Link>} />
      {!encryptionConfigured() && <p role="alert" className="mb-4 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm">Email and Meta channels can&apos;t be connected on this server yet: the credential encryption key isn&apos;t configured. Web chat works without it.</p>}
      <Card>
        <CardHeader>
          <CardTitle>Channels</CardTitle>
          <CardDescription>Each channel uses your own account with the provider. SalesGel only shows messages those providers actually deliver — nothing is simulated.</CardDescription>
        </CardHeader>
        <CardContent>
          <ChannelSetup orgSlug={orgSlug} baseUrl={appUrl()} channels={channels} canManage={canManageChannels(ctx)} />
        </CardContent>
      </Card>
      {canUseInbox(ctx) && (
        <Card className="mt-6">
          <CardHeader><CardTitle>Saved replies</CardTitle><CardDescription>Answers your team sends often. Insert them from the reply box.</CardDescription></CardHeader>
          <CardContent><SavedRepliesManager orgSlug={orgSlug} replies={saved} canEdit={ctx.permissions.has("conversations.reply")} /></CardContent>
        </Card>
      )}
    </>
  );
}
