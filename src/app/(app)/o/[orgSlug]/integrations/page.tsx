import { forbidden } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { canManageIntegrations, listConnections } from "@/domains/integrations/connections";
import { shopifyConfig } from "@/domains/integrations/shopify/client";
import { can } from "@/server/authz/guards";
import { requireOrgContext } from "@/server/authz/request";
import { encryptionConfigured } from "@/server/crypto";
import { formatDateTime } from "@/lib/utils";
import { ShopifyPanel, StripePanel } from "./integration-panels";

const STATUS: Record<string, { label: string; tone: "success" | "danger" | "warning" | "neutral" }> = {
  active: { label: "Connected", tone: "success" }, error: { label: "Needs attention", tone: "danger" }, pending: { label: "Setting up", tone: "warning" },
};
const EVENT_TONE: Record<string, "success" | "danger" | "warning" | "neutral" | "inactive"> = { processed: "success", failed: "danger", pending: "warning", ignored: "inactive" };
const JOB_LABEL: Record<string, string> = { "integration.webhook": "Process webhook", "shopify.sync": "Shopify import", "shopify.setup": "Shopify setup" };

export default async function IntegrationsPage({ params, searchParams }: { params: Promise<{ orgSlug: string }>; searchParams: Promise<{ shopify?: string; shopify_error?: string }> }) {
  const { orgSlug } = await params;
  const sp = await searchParams;
  const ctx = await requireOrgContext(orgSlug);
  if (!can(ctx, "integrations.read") && !canManageIntegrations(ctx)) forbidden();
  const { connections, recentEvents, recentJobs } = await listConnections(ctx);
  const manage = canManageIntegrations(ctx);
  const ready = encryptionConfigured();
  const stripe = connections.find((c) => c.provider === "stripe") ?? null;
  const shopify = connections.find((c) => c.provider === "shopify") ?? null;
  const view = (c: typeof stripe) => c && { id: c.id, displayName: c.displayName ?? c.externalAccountId, status: c.status, statusLabel: STATUS[c.status]?.label ?? c.status, lastError: c.lastError, lastSyncAt: c.lastSyncAt ? formatDateTime(c.lastSyncAt, ctx.timezone) : null, connectedAt: formatDateTime(c.createdAt, ctx.timezone), externalAccountId: c.externalAccountId, livemode: Boolean((c.settings as Record<string, unknown>)?.livemode) };
  return (
    <>
      <PageHeader title="Apps & Integrations" description="Connect your store and payments. SalesGel only shows data these services actually send." />
      {sp.shopify === "connected" && <p role="status" className="mb-4 rounded-md border border-success/30 bg-success/10 px-3 py-2 text-sm">Shopify connected. Your products, customers and the last 90 days of orders are importing in the background.</p>}
      {sp.shopify_error && <p role="alert" className="mb-4 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm">{sp.shopify_error}</p>}
      {!ready && <p role="alert" className="mb-4 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm">Integrations can&apos;t be connected on this server yet: the credential encryption key isn&apos;t configured.</p>}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2"><CardTitle>Stripe</CardTitle>{stripe && <Badge tone={STATUS[stripe.status]?.tone ?? "neutral"}>{STATUS[stripe.status]?.label ?? stripe.status}</Badge>}</div>
            <CardDescription>Send customers secure payment links from any order. Orders are marked paid only when Stripe confirms the payment.</CardDescription>
          </CardHeader>
          <CardContent><StripePanel orgSlug={orgSlug} connection={view(stripe)} canManage={manage && ready} /></CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2"><CardTitle>Shopify</CardTitle>{shopify && <Badge tone={STATUS[shopify.status]?.tone ?? "neutral"}>{STATUS[shopify.status]?.label ?? shopify.status}</Badge>}</div>
            <CardDescription>Import products, customers and orders, and keep them updated as your store changes.</CardDescription>
          </CardHeader>
          <CardContent><ShopifyPanel orgSlug={orgSlug} connection={view(shopify)} canManage={manage && ready} appConfigured={!!shopifyConfig()} /></CardContent>
        </Card>
      </div>
      <Card className="mt-6">
        <CardHeader><CardTitle>Activity</CardTitle><CardDescription>Recent deliveries from connected services and background work.</CardDescription></CardHeader>
        <CardContent className="grid gap-6 text-sm md:grid-cols-2">
          <section aria-labelledby="ev-h">
            <h3 id="ev-h" className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Webhook events</h3>
            {recentEvents.length === 0 ? <p className="text-muted-foreground">No events received yet.</p> : (
              <ul className="divide-y">
                {recentEvents.map((e) => (
                  <li key={e.id} className="flex items-center gap-2 py-2">
                    <span className="min-w-0 flex-1"><span className="font-medium capitalize">{e.provider}</span> · <code className="text-xs">{e.topic}</code><span className="block text-xs text-muted-foreground">{formatDateTime(e.receivedAt, ctx.timezone)}{e.error && ` · ${e.error}`}</span></span>
                    <Badge tone={EVENT_TONE[e.status] ?? "neutral"}>{e.status}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section aria-labelledby="job-h">
            <h3 id="job-h" className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Background jobs</h3>
            {recentJobs.length === 0 ? <p className="text-muted-foreground">Nothing has run yet.</p> : (
              <ul className="divide-y">
                {recentJobs.map((j) => (
                  <li key={j.id} className="flex items-center gap-2 py-2">
                    <span className="min-w-0 flex-1">{JOB_LABEL[j.type] ?? j.type}<span className="block text-xs text-muted-foreground">{j.finishedAt ? `Finished ${formatDateTime(j.finishedAt, ctx.timezone)}` : `Scheduled ${formatDateTime(j.runAt, ctx.timezone)}`}{j.attempts > 1 && ` · attempt ${j.attempts}`}{j.lastError && ` · ${j.lastError.slice(0, 120)}`}</span></span>
                    <Badge tone={j.status === "done" ? "success" : j.status === "failed" ? "danger" : "warning"}>{j.status}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </CardContent>
      </Card>
    </>
  );
}
