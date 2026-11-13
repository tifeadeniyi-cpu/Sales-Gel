"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { FormField } from "@/components/app/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { connectStripeAction, disconnectShopifyAction, disconnectStripeAction, startShopifyAction, syncShopifyAction } from "./actions";

export interface ConnectionView { id: string; displayName: string; status: string; statusLabel: string; lastError: string | null; lastSyncAt: string | null; connectedAt: string; externalAccountId: string; livemode: boolean }

const STRIPE_PERMISSIONS = ["Checkout Sessions — Write", "Webhook Endpoints — Write"];

function Details({ c, extra }: { c: ConnectionView; extra?: React.ReactNode }) {
  return (
    <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-sm">
      <dt className="text-muted-foreground">Account</dt><dd>{c.displayName}</dd>
      <dt className="text-muted-foreground">Connected</dt><dd>{c.connectedAt}</dd>
      {extra}
      {c.lastError && <><dt className="text-muted-foreground">Problem</dt><dd className="text-danger">{c.lastError}</dd></>}
    </dl>
  );
}

export function StripePanel({ orgSlug, connection, canManage }: { orgSlug: string; connection: ConnectionView | null; canManage: boolean }) {
  const router = useRouter();
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const form = canManage && (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); setError(null); start(async () => {
      const r = await connectStripeAction(orgSlug, key);
      if (!r.ok) return void setError(r.fieldErrors?.apiKey?.[0] ?? r.error);
      setKey("");
      toast.success(r.data.livemode ? "Stripe connected (live)" : "Stripe connected in test mode");
      if (r.data.warning) toast.warning(r.data.warning);
      router.refresh();
    }); }}>
      <FormField label={connection ? "Replace API key" : "Restricted API key"} htmlFor="stripe-key" required errors={error ? [error] : undefined}
        hint="Create a restricted key in your Stripe Dashboard (Developers → API keys) with only the permissions below.">
        <Input id="stripe-key" type="password" autoComplete="off" spellCheck={false} placeholder="rk_live_…" value={key} onChange={(e) => setKey(e.target.value)} />
      </FormField>
      <ul className="list-disc pl-5 text-xs text-muted-foreground">{STRIPE_PERMISSIONS.map((p) => <li key={p}>{p}</li>)}</ul>
      <Button type="submit" disabled={pending || key.trim().length < 20}>{pending ? "Connecting…" : connection ? "Update key" : "Connect Stripe"}</Button>
    </form>
  );
  if (!connection) return form || <p className="text-sm text-muted-foreground">Not connected. Ask a workspace admin to connect Stripe.</p>;
  return (
    <div className="space-y-4">
      <Details c={connection} extra={<><dt className="text-muted-foreground">Mode</dt><dd>{connection.livemode ? "Live payments" : "Test mode — no real money moves"}</dd></>} />
      {canManage && (
        <>
          <details className="rounded-md border p-3"><summary className="cursor-pointer text-sm font-medium">Change key</summary><div className="mt-3">{form}</div></details>
          <ConfirmDialog trigger={<Button variant="outline">Disconnect Stripe</Button>} title="Disconnect Stripe?" confirmLabel="Disconnect"
            description="Open payment links stop being tracked here and SalesGel removes the webhook it created. Payments already recorded stay on their orders."
            onConfirm={async () => { const r = await disconnectStripeAction(orgSlug); if (r.ok) router.refresh(); return r; }} successMessage="Stripe disconnected" />
        </>
      )}
    </div>
  );
}

export function ShopifyPanel({ orgSlug, connection, canManage, appConfigured }: { orgSlug: string; connection: ConnectionView | null; canManage: boolean; appConfigured: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!appConfigured) return <p className="text-sm text-muted-foreground">The SalesGel Shopify app isn&apos;t configured on this server yet, so stores can&apos;t be connected. This needs the app&apos;s client ID and secret.</p>;
  const form = canManage && (
    <form className="space-y-3" action={(fd) => { setError(null); start(async () => {
      const r = await startShopifyAction(orgSlug, fd);
      if (!r.ok) return void setError(r.fieldErrors?.shop?.[0] ?? r.error);
      window.location.assign(r.data.url);
    }); }}>
      <FormField label="Store domain" htmlFor="shop" required errors={error ? [error] : undefined} hint="You'll approve read-only access to orders, products and customers in Shopify.">
        <Input id="shop" name="shop" placeholder="your-store.myshopify.com" autoComplete="off" spellCheck={false} defaultValue={connection?.externalAccountId} />
      </FormField>
      <Button type="submit" disabled={pending}>{pending ? "Opening Shopify…" : connection ? "Reconnect" : "Connect Shopify"}</Button>
    </form>
  );
  if (!connection) return form || <p className="text-sm text-muted-foreground">Not connected. Ask a workspace admin to connect your store.</p>;
  return (
    <div className="space-y-4">
      <Details c={connection} extra={<><dt className="text-muted-foreground">Last import</dt><dd>{connection.lastSyncAt ?? (connection.status === "error" ? "Not finished" : "Running…")}</dd></>} />
      {canManage && (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={pending} onClick={() => start(async () => { const r = await syncShopifyAction(orgSlug); if (r.ok) { toast.success("Import queued"); router.refresh(); } else toast.error(r.error); })}>Sync now</Button>
          <ConfirmDialog trigger={<Button variant="outline">Disconnect</Button>} title="Disconnect Shopify?" confirmLabel="Disconnect"
            description="SalesGel stops importing from this store. Imported records stay. To revoke SalesGel's access completely, also uninstall the app in your Shopify admin."
            onConfirm={async () => { const r = await disconnectShopifyAction(orgSlug); if (r.ok) router.refresh(); return r; }} successMessage="Shopify disconnected" />
        </div>
      )}
      {canManage && connection.status === "error" && <details className="rounded-md border p-3"><summary className="cursor-pointer text-sm font-medium">Reconnect</summary><div className="mt-3">{form}</div></details>}
    </div>
  );
}
