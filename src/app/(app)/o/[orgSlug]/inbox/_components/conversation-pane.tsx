"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { ArrowLeft, FileText, Ticket, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { RecordPicker, type PickerOption } from "@/components/app/record-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeSelect, Textarea } from "@/components/ui/input";
import type { ConversationDetail } from "@/domains/inbox/service";
import { CHANNEL_LABELS, DELIVERY_LABELS, STATUS_LABELS } from "@/domains/inbox/labels";
import { cn, formatDateTime, formatRelative } from "@/lib/utils";
import { searchCustomersAction } from "../../customers/actions";
import {
  addNoteAction, assignConversationAction, convertToTicketAction, createCustomerAction, linkCustomerAction, retryMessageAction, sendReplyAction, setConversationStatusAction,
} from "../actions";
import { ChannelIcon } from "./channel-icon";

interface Perms { orgSlug: string; membershipId: string; canReply: boolean; canAssign: boolean; canCustomers: boolean; canCreateCustomer: boolean; canTicket: boolean; timezone: string }
type Saved = { id: string; title: string; body: string };

function fmtSize(n: number) { return n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`; }

export function ConversationPane({ ctx, c, members, saved, backHref }: { ctx: Perms; c: ConversationDetail; members: { membershipId: string; name: string }[]; saved: Saved[]; backHref: string }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [c.id, c.messages.length]);
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok?: string) => start(async () => { const r = await fn(); if (r.ok) { if (ok) toast.success(ok); router.refresh(); } else toast.error(r.error ?? "Something went wrong"); });
  const s = ctx.orgSlug;

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
          <Link href={backHref} className="rounded p-1 hover:bg-muted md:hidden" aria-label="Back to conversations"><ArrowLeft className="size-4" /></Link>
          <ChannelIcon channel={c.channel} />
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-semibold">{c.title}</h2>
            <p className="truncate text-xs text-muted-foreground">{CHANNEL_LABELS[c.channel]}{c.connection ? ` · ${c.connection.name}` : ""}{c.subject ? ` · ${c.subject}` : ""} · #{c.number}</p>
          </div>
          {ctx.canReply && (
            c.status === "closed"
              ? <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => setConversationStatusAction(s, c.id, "open"), "Reopened")}>Reopen</Button>
              : <>
                  {c.status !== "pending" && <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => setConversationStatusAction(s, c.id, "pending"), "Marked pending")}>Pending</Button>}
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => setConversationStatusAction(s, c.id, "closed"), "Closed")}>Close</Button>
                </>
          )}
        </header>
        <ol className="flex-1 space-y-3 overflow-y-auto bg-muted/20 p-4" aria-label="Messages">
          {c.messages.map((m) => {
            const mine = m.direction !== "inbound";
            return (
              <li key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                <article className={cn("max-w-[80%] rounded-2xl border px-3.5 py-2.5 text-sm shadow-sm",
                  m.direction === "inbound" && "rounded-bl-sm bg-card", m.direction === "outbound" && "rounded-br-sm border-primary/20 bg-primary/10", m.direction === "note" && "border-highlight/40 bg-highlight/15")}
                  aria-label={m.direction === "note" ? "Internal note" : m.direction === "inbound" ? `Message from ${c.title}` : "Reply"}>
                  <header className="mb-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="font-medium text-ink">{m.direction === "inbound" ? c.title : (m.authorName ?? "Team")}</span>
                    {m.direction === "note" && <Badge tone="highlight">Internal note</Badge>}
                    <time dateTime={m.createdAt.toISOString()} title={formatDateTime(m.createdAt, ctx.timezone)}>{formatRelative(m.createdAt)}</time>
                  </header>
                  <p className="whitespace-pre-wrap break-words">{m.body}</p>
                  {m.attachments.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {m.attachments.map((a) => (
                        <a key={a.id} href={`/o/${s}/inbox/attachments/${a.id}`} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-xs hover:bg-muted">
                          <FileText className="size-3.5" aria-hidden /> {a.filename} <span className="text-muted-foreground">{fmtSize(a.size)}</span>
                        </a>
                      ))}
                    </div>
                  )}
                  {m.direction === "outbound" && (
                    <p className={cn("mt-1 text-right text-[11px]", m.deliveryStatus === "failed" ? "text-danger" : "text-muted-foreground")}>
                      {m.deliveryStatus === "failed" ? <>Failed{m.error ? `: ${m.error}` : ""} {ctx.canReply && <button type="button" className="ml-1 font-medium underline" disabled={busy} onClick={() => run(() => retryMessageAction(s, m.id), "Sent")}>Retry</button>}</> : DELIVERY_LABELS[m.deliveryStatus]}
                    </p>
                  )}
                </article>
              </li>
            );
          })}
          <div ref={endRef} />
        </ol>
        {ctx.canReply && <Composer orgSlug={s} c={c} saved={saved} />}
      </div>
      <aside className="hidden w-72 shrink-0 space-y-5 overflow-y-auto border-l p-4 text-sm xl:block" aria-label="Details">
        <Details ctx={ctx} c={c} members={members} busy={busy} run={run} />
      </aside>
    </div>
  );
}

function Composer({ orgSlug, c, saved }: { orgSlug: string; c: ConversationDetail; saved: Saved[] }) {
  const router = useRouter();
  const [mode, setMode] = useState<"reply" | "note">(c.reply.canReply ? "reply" : "note");
  const [body, setBody] = useState("");
  const [pending, start] = useTransition();
  const submit = () => {
    const text = body.trim();
    if (!text) return;
    start(async () => {
      const r = mode === "note" ? await addNoteAction(orgSlug, c.id, text) : await sendReplyAction(orgSlug, c.id, text);
      if (!r.ok) return void toast.error(r.error);
      const sent = r.data as { status?: string; error?: string | null };
      if (mode === "reply" && sent.status === "failed") toast.error(`Not delivered: ${sent.error ?? "the provider refused it"}`);
      setBody("");
      router.refresh();
    });
  };
  return (
    <div className="border-t bg-card p-3">
      <div className="mb-2 flex items-center gap-1" role="tablist" aria-label="Message type">
        {(["reply", "note"] as const).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={mode === k} disabled={k === "reply" && !c.reply.canReply} onClick={() => setMode(k)}
            className={cn("rounded-md px-2.5 py-1 text-xs font-medium disabled:opacity-40", mode === k ? (k === "note" ? "bg-highlight/20" : "bg-primary/10 text-primary") : "text-muted-foreground hover:bg-muted")}>
            {k === "reply" ? `Reply via ${CHANNEL_LABELS[c.channel]}` : "Internal note"}
          </button>
        ))}
        {saved.length > 0 && mode === "reply" && (
          <NativeSelect aria-label="Insert saved reply" className="ml-auto h-7 w-44 text-xs" value="" onChange={(e) => { const r = saved.find((x) => x.id === e.target.value); if (r) setBody((b) => (b ? `${b}\n${r.body}` : r.body)); }}>
            <option value="">Insert saved reply…</option>
            {saved.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
          </NativeSelect>
        )}
      </div>
      {!c.reply.canReply && <p className="mb-2 rounded-md bg-warning/10 px-2.5 py-1.5 text-xs text-warning-foreground">{c.reply.reason}</p>}
      <div className="flex gap-2">
        <label htmlFor="inbox-composer" className="sr-only">{mode === "note" ? "Internal note" : "Reply"}</label>
        <Textarea id="inbox-composer" rows={3} value={body} onChange={(e) => setBody(e.target.value)} disabled={mode === "reply" && !c.reply.canReply}
          placeholder={mode === "note" ? "Only your team sees notes" : `Reply to ${c.title}…`}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); } }}
          className={cn("min-h-16 flex-1", mode === "note" && "bg-highlight/5")} />
        <Button onClick={submit} disabled={pending || !body.trim() || (mode === "reply" && !c.reply.canReply)} className="self-end">
          {pending ? "Sending…" : mode === "note" ? "Add note" : "Send"}
        </Button>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">Ctrl/⌘ + Enter to send{c.channel === "webchat" ? " · the visitor sees replies in the chat window" : ""}</p>
    </div>
  );
}

function Details({ ctx, c, members, busy, run }: { ctx: Perms; c: ConversationDetail; members: { membershipId: string; name: string }[]; busy: boolean; run: (fn: () => Promise<{ ok: boolean; error?: string }>, ok?: string) => void }) {
  const s = ctx.orgSlug;
  const [linking, setLinking] = useState(false);
  const search = useCallback((q: string) => searchCustomersAction(s, q), [s]);
  const handle = c.channel === "whatsapp" ? `+${c.contactHandle}` : c.channel === "email" ? c.contactHandle : c.contactEmail;
  return (
    <>
      <section>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Contact</h3>
        <p className="font-medium">{c.contactName ?? c.title}</p>
        {handle && <p className="break-all text-muted-foreground">{handle}</p>}
        <div className="mt-3">
          {c.customer ? (
            <div className="flex items-center justify-between gap-2 rounded-md border px-2.5 py-2">
              <Link href={`/o/${s}/customers/${c.customer.id}`} className="min-w-0 truncate font-medium text-primary hover:underline">{c.customer.name}</Link>
              {ctx.canReply && <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={() => run(() => linkCustomerAction(s, c.id, null), "Unlinked")}>Unlink</button>}
            </div>
          ) : ctx.canCustomers && ctx.canReply ? (
            linking ? (
              <RecordPicker label="Find a customer" value={null} search={search} onChange={(o: PickerOption | null) => { setLinking(false); if (o) run(() => linkCustomerAction(s, c.id, o.id), "Customer linked"); }} />
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => setLinking(true)}>Link customer</Button>
                {ctx.canCreateCustomer && <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => createCustomerAction(s, c.id), "Customer created")}><UserPlus /> Create</Button>}
              </div>
            )
          ) : <p className="text-xs text-muted-foreground">Not linked to a customer.</p>}
        </div>
      </section>
      <section>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Assigned to</h3>
        {ctx.canAssign ? (
          <NativeSelect aria-label="Assignee" value={c.assigneeMembershipId ?? ""} disabled={busy} onChange={(e) => run(() => assignConversationAction(s, c.id, e.target.value || null), "Assignment updated")}>
            <option value="">Unassigned</option>
            {members.map((m) => <option key={m.membershipId} value={m.membershipId}>{m.name}{m.membershipId === ctx.membershipId ? " (you)" : ""}</option>)}
          </NativeSelect>
        ) : <p>{c.assigneeName ?? "Unassigned"}</p>}
      </section>
      <section>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Status</h3>
        <Badge tone={c.status === "closed" ? "inactive" : c.status === "pending" ? "warning" : "brand"}>{STATUS_LABELS[c.status as keyof typeof STATUS_LABELS]}</Badge>
        {c.windowExpiresAt && (
          <p className="mt-2 text-xs text-muted-foreground">{c.windowExpiresAt > new Date() ? `Reply window open until ${formatDateTime(c.windowExpiresAt, ctx.timezone)}` : "24-hour reply window closed"}</p>
        )}
      </section>
      <section>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Support ticket</h3>
        {c.ticket ? <Link href={`/o/${s}/support/tickets/${c.ticket.id}`} className="font-medium text-primary hover:underline">TCK-{c.ticket.number}</Link>
          : ctx.canTicket ? <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => convertToTicketAction(s, c.id), "Ticket created")}><Ticket /> Create ticket</Button>
          : <p className="text-xs text-muted-foreground">None</p>}
      </section>
      <p className="border-t pt-3 text-xs text-muted-foreground">Started {formatDateTime(c.createdAt, ctx.timezone)}</p>
    </>
  );
}
