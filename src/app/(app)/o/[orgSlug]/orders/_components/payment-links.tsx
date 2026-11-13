"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/money";
import { createPaymentLinkAction } from "../actions";

export interface LinkRow { id: string; url: string; amount: number; currency: string; status: string; createdAt: string; expiresAt: string | null }

const TONE: Record<string, "neutral" | "success" | "inactive" | "warning"> = { open: "neutral", paid: "success", expired: "inactive", cancelled: "inactive" };

export function PaymentLinks({ orgSlug, orderId, links, ready, canCreate, due, currency }: { orgSlug: string; orderId: string; links: LinkRow[]; ready: boolean; canCreate: boolean; due: number; currency: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [latest, setLatest] = useState<string | null>(null);
  const copy = async (url: string) => {
    try { await navigator.clipboard.writeText(url); toast.success("Link copied"); } catch { toast.error("Couldn't copy — select the link instead."); }
  };
  return (
    <div className="space-y-3 text-sm">
      {!ready ? (
        <p className="text-muted-foreground">
          Connect Stripe in <Link className="text-primary hover:underline" href={`/o/${orgSlug}/integrations`}>Apps & Integrations</Link> to send customers a secure card payment page.
        </p>
      ) : due <= 0 ? (
        <p className="text-muted-foreground">Nothing is due on this order.</p>
      ) : canCreate ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={pending} onClick={() => start(async () => {
            const r = await createPaymentLinkAction(orgSlug, orderId);
            if (!r.ok) return void toast.error(r.error);
            setLatest(r.data.url);
            await copy(r.data.url);
            router.refresh();
          })}>{pending ? "Creating…" : `Send payment link for ${formatMoney(due, currency)}`}</Button>
          <span className="text-xs text-muted-foreground">The order is marked paid only when Stripe confirms the payment.</span>
        </div>
      ) : null}
      {latest && <input readOnly aria-label="Payment link" value={latest} onFocus={(e) => e.currentTarget.select()} className="h-9 w-full rounded-md border bg-muted/40 px-2 font-mono text-xs" />}
      {links.length > 0 && (
        <ul className="divide-y">
          {links.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-2 py-2">
              <span className="flex-1"><span className="font-medium">{formatMoney(l.amount, l.currency)}</span><span className="block text-xs text-muted-foreground">Created {new Date(l.createdAt).toLocaleString()}</span></span>
              <Badge tone={TONE[l.status] ?? "neutral"}>{l.status[0].toUpperCase() + l.status.slice(1)}</Badge>
              {l.status === "open" && <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => copy(l.url)}>Copy link</Button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
