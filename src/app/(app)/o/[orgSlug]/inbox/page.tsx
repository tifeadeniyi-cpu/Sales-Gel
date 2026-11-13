import Link from "next/link";
import { forbidden } from "next/navigation";
import { Inbox, Plug, Settings2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { NativeSelect, Input } from "@/components/ui/input";
import { listAssignableMembers } from "@/domains/customers/service";
import { canManageChannels, listChannels } from "@/domains/inbox/connections";
import { CHANNEL_LABELS, INBOX_VIEWS, STATUS_LABELS, VIEW_LABELS } from "@/domains/inbox/labels";
import { canUseInbox, getConversation, inboxCounts, listConversations, listSavedReplies, markConversationRead } from "@/domains/inbox/service";
import { cn, formatRelative } from "@/lib/utils";
import { requireOrgContext } from "@/server/authz/request";
import { AutoRefresh } from "./_components/auto-refresh";
import { ChannelIcon } from "./_components/channel-icon";
import { ConversationPane } from "./_components/conversation-pane";

type SP = { view?: string; channel?: string; q?: string; c?: string; page?: string };

export default async function InboxPage({ params, searchParams }: { params: Promise<{ orgSlug: string }>; searchParams: Promise<SP> }) {
  const { orgSlug } = await params;
  const sp = await searchParams;
  const ctx = await requireOrgContext(orgSlug);
  if (!canUseInbox(ctx)) forbidden();
  const readAll = ctx.permissions.has("conversations.read");
  const view = sp.view ?? (readAll ? "open" : "mine");
  const [channels, data, counts] = await Promise.all([listChannels(ctx), listConversations(ctx, { view, channel: sp.channel, q: sp.q, page: sp.page }), inboxCounts(ctx)]);
  const selectedId = sp.c ?? null;
  let selected = null;
  if (selectedId) {
    selected = await getConversation(ctx, selectedId).catch(() => null);
    if (selected) await markConversationRead(ctx, selectedId);
  }
  const [members, saved] = selected ? await Promise.all([listAssignableMembers(ctx), listSavedReplies(ctx)]) : [[], []];
  const base = `/o/${orgSlug}/inbox`;
  const qs = (patch: Partial<SP>) => {
    const p = new URLSearchParams(Object.entries({ view, channel: sp.channel, q: sp.q, c: sp.c, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `${base}?${p}`;
  };
  const active = channels.filter((c) => c.status !== "disconnected");
  const manage = canManageChannels(ctx);
  const viewCount: Partial<Record<string, number>> = { mine: counts?.mine, unassigned: counts?.unassigned, open: counts?.open };

  if (active.length === 0 && data.total === 0) {
    return (
      <>
        <h1 className="mb-4 text-2xl font-semibold tracking-tight">Inbox</h1>
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary"><Inbox className="size-6" aria-hidden /></span>
            <h2 className="text-lg font-semibold">No channels connected yet</h2>
            <p className="max-w-md text-sm text-muted-foreground">Connect website chat, email, WhatsApp, Messenger or Instagram and every customer message lands here, linked to their customer record. Nothing is received until a channel is connected.</p>
            {manage ? <Button asChild><Link href={`${base}/settings`}><Plug /> Connect a channel</Link></Button> : <p className="text-sm text-muted-foreground">Ask a workspace admin to connect a channel.</p>}
          </CardContent>
        </Card>
      </>
    );
  }

  return (
    <div className="-mx-4 -my-6 flex h-[calc(100dvh-4rem)] flex-col sm:-mx-6 lg:-mx-8">
      <AutoRefresh />
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3 sm:px-6">
        <h1 className="mr-2 text-xl font-semibold tracking-tight">Inbox</h1>
        <nav className="flex flex-wrap gap-1" aria-label="Views">
          {INBOX_VIEWS.filter((v) => readAll || v !== "unassigned").map((v) => (
            <Link key={v} href={qs({ view: v, c: undefined, page: undefined })} aria-current={v === view ? "page" : undefined}
              className={cn("rounded-full px-3 py-1 text-sm", v === view ? "bg-primary text-white" : "text-muted-foreground hover:bg-muted")}>
              {VIEW_LABELS[v]}{viewCount[v] ? <span className="ml-1 tabular-nums opacity-80">{viewCount[v]}</span> : null}
            </Link>
          ))}
        </nav>
        <form className="ml-auto flex flex-wrap gap-2" action={base}>
          <input type="hidden" name="view" value={view} />
          <NativeSelect name="channel" defaultValue={sp.channel ?? ""} aria-label="Channel" className="h-9 w-36">
            <option value="">All channels</option>
            {Object.entries(CHANNEL_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </NativeSelect>
          <Input name="q" defaultValue={sp.q} placeholder="Search conversations" aria-label="Search conversations" className="h-9 w-48" />
          <Button type="submit" variant="outline" size="sm" className="h-9">Filter</Button>
        </form>
        {manage && <Button asChild variant="ghost" size="sm"><Link href={`${base}/settings`}><Settings2 /> Channels</Link></Button>}
      </div>
      <div className="flex min-h-0 flex-1">
        <section aria-label="Conversations" className={cn("w-full shrink-0 overflow-y-auto border-r md:w-80 lg:w-96", selected && "hidden md:block")}>
          {data.rows.length === 0 ? <p className="p-6 text-center text-sm text-muted-foreground">No conversations here.</p> : (
            <ul className="divide-y">
              {data.rows.map((r) => (
                <li key={r.id}>
                  <Link href={qs({ c: r.id })} aria-current={r.id === selectedId ? "true" : undefined}
                    className={cn("flex gap-3 px-4 py-3 hover:bg-muted/50", r.id === selectedId && "bg-primary/5")}>
                    <ChannelIcon channel={r.channel} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={cn("truncate", r.unread ? "font-semibold" : "font-medium")}>{r.title}</span>
                        {r.unread && <span className="size-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
                        <time className="ml-auto shrink-0 text-xs text-muted-foreground" dateTime={r.lastMessageAt.toISOString()}>{formatRelative(r.lastMessageAt)}</time>
                      </div>
                      {r.subject && <div className="truncate text-xs font-medium">{r.subject}</div>}
                      <div className={cn("truncate text-sm", r.unread ? "text-ink" : "text-muted-foreground")}>{r.lastPreview}</div>
                      <div className="mt-1 flex flex-wrap gap-1 text-[11px] text-muted-foreground">
                        {r.status !== "open" && <Badge tone={r.status === "closed" ? "inactive" : "warning"}>{STATUS_LABELS[r.status as keyof typeof STATUS_LABELS]}</Badge>}
                        {r.assigneeName ? <span>· {r.assigneeName}</span> : <span className="text-warning">· Unassigned</span>}
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {data.pageCount > 1 && (
            <div className="flex justify-between p-3 text-sm">
              {data.page > 1 ? <Link href={qs({ page: String(data.page - 1), c: undefined })} className="text-primary hover:underline">Newer</Link> : <span />}
              {data.page < data.pageCount ? <Link href={qs({ page: String(data.page + 1), c: undefined })} className="text-primary hover:underline">Older</Link> : <span />}
            </div>
          )}
        </section>
        <section aria-label="Conversation" className={cn("min-w-0 flex-1", !selected && "hidden md:flex md:items-center md:justify-center")}>
          {selected ? (
            <ConversationPane ctx={{ orgSlug, membershipId: ctx.membershipId, canReply: ctx.permissions.has("conversations.reply"), canAssign: ctx.permissions.has("conversations.assign"), canCustomers: ctx.permissions.has("customers.read") || ctx.permissions.has("customers.read_assigned"), canCreateCustomer: ctx.permissions.has("customers.write"), canTicket: ctx.permissions.has("tickets.write"), timezone: ctx.timezone }}
              c={selected} members={members.map((m) => ({ membershipId: m.membershipId, name: m.name }))} saved={saved} backHref={qs({ c: undefined })} />
          ) : selectedId ? <p className="text-sm text-muted-foreground">This conversation isn&apos;t available.</p> : <p className="text-sm text-muted-foreground">Choose a conversation.</p>}
        </section>
      </div>
    </div>
  );
}
