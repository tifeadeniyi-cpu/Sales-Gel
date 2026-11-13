import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { getPortalTicket } from "@/domains/support/portal";
import { CopyLink, PortalReply } from "./reply-form";

export const metadata: Metadata = { title: "Your request", robots: { index: false, follow: false }, referrer: "no-referrer" };

const TONE: Record<string, "brand" | "warning" | "success" | "inactive"> = { new: "brand", open: "brand", pending_internal: "brand", escalated: "brand", pending_customer: "warning", resolved: "success", closed: "inactive" };

export default async function PortalTicketPage({ params, searchParams }: { params: Promise<{ portalSlug: string; token: string }>; searchParams: Promise<{ new?: string }> }) {
  const { portalSlug, token } = await params;
  const { new: isNew } = await searchParams;
  const data = await getPortalTicket(portalSlug, token);
  if (!data) {
    return (
      <div className="rounded-xl border bg-card p-8 text-center shadow-sm">
        <h1 className="text-xl font-semibold">This link isn&apos;t valid</h1>
        <p className="mt-2 text-sm text-muted-foreground">It may have expired or been mistyped.</p>
        <Link href={`/portal/${portalSlug}`} className="mt-4 inline-block text-sm font-medium text-primary hover:underline">Send a new request</Link>
      </div>
    );
  }
  const { ticket, messages, portal } = data;
  return (
    <div className="space-y-5">
      <Link href={`/portal/${portalSlug}`} className="text-sm text-muted-foreground hover:text-ink">← {portal.title}</Link>
      {isNew && (
        <div role="status" className="rounded-xl border border-success/30 bg-success/10 p-4 text-sm">
          <p className="font-medium">Thanks — we received your request (#{ticket.number}).</p>
          <p className="mt-1">Save this page&apos;s link: it&apos;s how you follow your request and see our replies. Anyone with the link can read this conversation.</p>
          <CopyLink />
        </div>
      )}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">Request #{ticket.number} · {portal.orgName}</p>
          <h1 className="text-xl font-semibold tracking-tight">{ticket.subject}</h1>
        </div>
        <Badge tone={TONE[ticket.category] ?? "brand"}>{ticket.status}</Badge>
      </header>
      <ol className="space-y-3" aria-label="Conversation">
        {messages.map((m) => (
          <li key={m.id} className={`rounded-xl border p-4 text-sm shadow-sm ${m.from === "team" ? "bg-card" : "ml-6 bg-primary/5"}`}>
            <p className="mb-1 text-xs font-medium text-muted-foreground">{m.from === "team" ? portal.orgName : "You"} · {new Date(m.createdAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</p>
            <p className="whitespace-pre-wrap">{m.body}</p>
          </li>
        ))}
      </ol>
      {ticket.closed ? (
        <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">This request is closed. <Link href={`/portal/${portalSlug}`} className="text-primary hover:underline">Send a new request</Link> if you need more help.</p>
      ) : <PortalReply slug={portalSlug} token={token} />}
    </div>
  );
}
