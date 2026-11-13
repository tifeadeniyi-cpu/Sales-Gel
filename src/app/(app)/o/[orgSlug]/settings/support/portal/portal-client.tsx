"use client";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { savePortalAction } from "../actions";
import { firstError, useRun } from "../parts";

export function PortalSettings({ orgSlug, baseUrl, portal, defaultSlug, defaultTitle, publishedForms }: {
  orgSlug: string; baseUrl: string; portal: { slug: string; enabled: number; title: string; welcome: string | null } | null; defaultSlug: string; defaultTitle: string; publishedForms: number;
}) {
  const { pending, run } = useRun();
  const [v, setV] = useState({ enabled: portal ? !!portal.enabled : true, slug: portal?.slug ?? defaultSlug.slice(0, 40), title: portal?.title ?? defaultTitle, welcome: portal?.welcome ?? "" });
  const [error, setError] = useState<string | null>(null);
  const url = `${baseUrl}/portal/${portal?.slug ?? v.slug}`;
  return (
    <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); setError(null); run(() => savePortalAction(orgSlug, { ...v, welcome: v.welcome || null }), v.enabled ? "Portal saved" : "Portal turned off", undefined, (r) => setError(firstError(r))); }}>
      {portal?.enabled ? (
        <p className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-sm">
          Live at <Link className="font-medium text-primary underline-offset-2 hover:underline" href={`/portal/${portal.slug}`} target="_blank">{url}</Link>. Share this link on your website, emails and social profiles.
        </p>
      ) : <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">The portal is off. Customers can&apos;t reach it.</p>}
      <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" className="size-4 accent-[var(--brand-primary)]" checked={v.enabled} onChange={(e) => setV({ ...v, enabled: e.target.checked })} />Portal is on</label>
      <label className="grid gap-1 text-sm font-medium">Portal address
        <div className="flex items-center rounded-md border focus-within:ring-2 focus-within:ring-ring">
          <span className="whitespace-nowrap pl-3 text-sm text-muted-foreground">{baseUrl.replace(/^https?:\/\//, "")}/portal/</span>
          <input aria-label="Portal address" value={v.slug} onChange={(e) => setV({ ...v, slug: e.target.value.toLowerCase() })} className="h-9 min-w-0 flex-1 bg-transparent pr-3 text-sm outline-none" />
        </div>
      </label>
      <label className="grid gap-1 text-sm font-medium">Title<Input value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} /></label>
      <label className="grid gap-1 text-sm font-medium">Welcome message<Textarea rows={3} value={v.welcome} placeholder="We reply within one business day." onChange={(e) => setV({ ...v, welcome: e.target.value })} /></label>
      <div className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
        <p>{publishedForms ? `${publishedForms} published form${publishedForms === 1 ? "" : "s"} will be offered.` : <>No published forms yet, so customers see a simple contact form. <Link href={`/o/${orgSlug}/settings/support/forms`} className="text-primary hover:underline">Add a form</Link>.</>}</p>
        <p className="mt-1">Email isn&apos;t connected yet, so after submitting, customers get a private link on screen to follow their request. Your replies appear there; internal notes never do.</p>
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <Button type="submit" className="w-fit" disabled={pending}>{pending ? "Saving…" : "Save portal"}</Button>
    </form>
  );
}
