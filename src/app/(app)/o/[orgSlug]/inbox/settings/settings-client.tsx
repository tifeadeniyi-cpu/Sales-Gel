"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import type { ChannelView } from "@/domains/inbox/connections";
import { CHANNEL_LABELS } from "@/domains/inbox/labels";
import type { Channel } from "@/domains/inbox/schema";
import { formatRelative } from "@/lib/utils";
import {
  archiveSavedReplyAction, connectEmailAction, connectInstagramAction, connectMessengerAction, connectWebchatAction, connectWhatsAppAction, createSavedReplyAction, disconnectChannelAction, updateWebchatAction,
} from "../actions";
import { ChannelIcon } from "../_components/channel-icon";

type Result = { ok: true; data: unknown } | { ok: false; error: string; fieldErrors?: Record<string, string[]> };
const firstError = (r: Extract<Result, { ok: false }>) => Object.values(r.fieldErrors ?? {})[0]?.[0] ?? r.error;

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return { pending, run: (fn: () => Promise<Result>, ok: string, onErr: (m: string) => void, after?: () => void) => start(async () => { const r = await fn(); if (r.ok) { toast.success(ok); after?.(); router.refresh(); } else onErr(firstError(r)); }) };
}

function CopyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1">
      <span className="text-xs font-medium">{label}</span>
      <div className="flex items-start gap-2">
        <code className="min-w-0 flex-1 break-all rounded-md bg-muted px-2 py-1.5 text-xs">{value}</code>
        <Button type="button" size="sm" variant="ghost" aria-label={`Copy ${label}`} onClick={async () => { try { await navigator.clipboard.writeText(value); toast.success("Copied"); } catch { toast.error("Select and copy it instead"); } }}><Copy /></Button>
      </div>
    </div>
  );
}

const GUIDE: Record<Exclude<Channel, "webchat">, { title: string; steps: string[]; fields: { key: string; label: string; type?: string; placeholder?: string; hint?: string }[] }> = {
  email: {
    title: "Email (Postmark)",
    steps: ["Create a Postmark server and turn on its inbound stream.", "Add your sending address or domain as a Sender Signature in Postmark.", "Paste the server API token below. SalesGel points the inbound stream at itself.", "Forward your support address (e.g. help@yourstore.com) to the inbound address shown after connecting."],
    fields: [
      { key: "name", label: "Inbox name", placeholder: "Support email" },
      { key: "fromEmail", label: "Send replies from", type: "email", placeholder: "help@yourstore.com" },
      { key: "fromName", label: "Sender name", placeholder: "Your Store Support" },
      { key: "serverToken", label: "Postmark server API token", type: "password", hint: "Postmark → your server → API Tokens" },
    ],
  },
  whatsapp: {
    title: "WhatsApp Business (Cloud API)",
    steps: ["In your Meta app, add the WhatsApp product and a business phone number.", "Create a permanent system-user access token with whatsapp_business_messaging.", "Paste the token, Phone number ID and app secret below.", "In Meta → WhatsApp → Configuration, set the callback URL and verify token shown after connecting, and subscribe to “messages”."],
    fields: [
      { key: "phoneNumberId", label: "Phone number ID", placeholder: "1234567890" },
      { key: "accessToken", label: "Access token", type: "password" },
      { key: "appSecret", label: "App secret", type: "password", hint: "Meta app → App settings → Basic" },
    ],
  },
  messenger: {
    title: "Facebook Messenger",
    steps: ["In your Meta app, add Messenger and connect your Facebook Page.", "Generate a Page access token with pages_messaging.", "Paste the Page token and app secret below.", "In Meta → Messenger → Webhooks, set the callback URL and verify token shown after connecting; subscribe the Page to messages, message_deliveries and message_reads."],
    fields: [
      { key: "accessToken", label: "Page access token", type: "password" },
      { key: "appSecret", label: "App secret", type: "password" },
    ],
  },
  instagram: {
    title: "Instagram (professional account)",
    steps: ["In your Meta app, add Instagram with “API setup with Instagram login”.", "Generate an Instagram user access token with instagram_business_manage_messages.", "Paste the token and app secret below.", "In Meta → Instagram → Webhooks, set the callback URL and verify token shown after connecting; subscribe to messages."],
    fields: [
      { key: "accessToken", label: "Instagram access token", type: "password" },
      { key: "appSecret", label: "App secret", type: "password" },
    ],
  },
};
const ACTION = { email: connectEmailAction, whatsapp: connectWhatsAppAction, messenger: connectMessengerAction, instagram: connectInstagramAction };

export function ChannelSetup({ orgSlug, baseUrl, channels, canManage }: { orgSlug: string; baseUrl: string; channels: ChannelView[]; canManage: boolean }) {
  const [adding, setAdding] = useState<Channel | null>(null);
  const live = channels.filter((c) => c.status !== "disconnected");
  return (
    <div className="space-y-4">
      {live.length === 0 && <p className="text-sm text-muted-foreground">No channels connected.</p>}
      <ul className="space-y-3">
        {live.map((c) => <ChannelCard key={c.id} orgSlug={orgSlug} baseUrl={baseUrl} c={c} canManage={canManage} />)}
      </ul>
      {canManage && (
        adding ? (
          <div className="rounded-lg border p-4">
            {adding === "webchat" ? <WebchatForm orgSlug={orgSlug} onDone={() => setAdding(null)} /> : <ConnectForm orgSlug={orgSlug} channel={adding} onDone={() => setAdding(null)} />}
          </div>
        ) : (
          <div>
            <p className="mb-2 text-sm font-medium">Add a channel</p>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(CHANNEL_LABELS) as Channel[]).map((ch) => (
                <Button key={ch} variant="outline" onClick={() => setAdding(ch)}><ChannelIcon channel={ch} className="size-5" /> {CHANNEL_LABELS[ch]}</Button>
              ))}
            </div>
          </div>
        )
      )}
    </div>
  );
}

function ChannelCard({ orgSlug, baseUrl, c, canManage }: { orgSlug: string; baseUrl: string; c: ChannelView; canManage: boolean }) {
  const [editing, setEditing] = useState(false);
  const meta = ["whatsapp", "messenger", "instagram"].includes(c.channel);
  const s = c.settings as Record<string, string | boolean | undefined>;
  const verified = !!s.webhookVerifiedAt;
  return (
    <li className="rounded-lg border p-4">
      <div className="flex flex-wrap items-start gap-3">
        <ChannelIcon channel={c.channel} />
        <div className="min-w-0 flex-1">
          <h3 className="font-medium">{c.name}</h3>
          <p className="text-sm text-muted-foreground">{CHANNEL_LABELS[c.channel]}{c.externalAccountId && c.channel !== "email" ? ` · ${c.channel === "whatsapp" && s.phone ? s.phone : c.externalAccountId}` : ""}{c.lastInboundAt ? ` · last message ${formatRelative(c.lastInboundAt)}` : " · no messages yet"}</p>
        </div>
        {c.status === "error" ? <Badge tone="danger">Needs attention</Badge> : meta && !verified ? <Badge tone="warning">Waiting for webhook</Badge> : <Badge tone="success">Connected</Badge>}
        {canManage && (
          <div className="flex gap-1">
            {c.channel === "webchat" && <Button size="sm" variant="outline" onClick={() => setEditing((v) => !v)}>{editing ? "Close" : "Customize"}</Button>}
            <ConfirmDialog trigger={<Button size="sm" variant="ghost">Disconnect</Button>} title={`Disconnect ${c.name}?`} confirmLabel="Disconnect"
              description="New messages stop arriving and you can't reply on this channel. Existing conversations stay in the inbox. SalesGel deletes the stored credentials."
              onConfirm={() => disconnectChannelAction(orgSlug, c.id)} successMessage="Channel disconnected" />
          </div>
        )}
      </div>
      {c.lastError && <p className="mt-2 text-sm text-danger">{c.lastError}</p>}
      {canManage && (
        <div className="mt-3 grid gap-3">
          {c.channel === "webchat" && c.publicKey && (
            <>
              <CopyField label="Paste this before </body> on your website" value={`<script src="${baseUrl}/widget.js" data-key="${c.publicKey}" data-color="${s.color ?? "#0053ee"}" async></script>`} />
              <a className="w-fit text-sm text-primary hover:underline" href={`/chat/${c.publicKey}`} target="_blank" rel="noreferrer">Open the chat window to test it</a>
              {editing && <div className="rounded-md border p-3"><WebchatForm orgSlug={orgSlug} existing={c} onDone={() => setEditing(false)} /></div>}
            </>
          )}
          {c.channel === "email" && (
            <>
              <CopyField label="Forward customer email to" value={String(s.inboundAddress ?? "")} />
              <p className="text-xs text-muted-foreground">Replies are sent from {String(s.fromName)} &lt;{String(s.fromEmail)}&gt; through Postmark.</p>
              {c.inboundHookUrl && <>
                <p className="text-xs text-warning-foreground">SalesGel couldn&apos;t set Postmark&apos;s inbound webhook automatically. In Postmark, open the inbound stream → Settings and paste this webhook URL (it includes a private password — don&apos;t share it):</p>
                <CopyField label="Inbound webhook URL" value={c.inboundHookUrl} />
              </>}
            </>
          )}
          {meta && c.webhookUrl && (
            <>
              <CopyField label="Callback URL" value={c.webhookUrl} />
              {c.verifyToken && <CopyField label="Verify token" value={c.verifyToken} />}
              {!verified && <p className="text-xs text-warning-foreground">Paste these into your Meta app&apos;s webhook settings. This changes to “Connected” once Meta verifies the callback.</p>}
            </>
          )}
        </div>
      )}
    </li>
  );
}

function ConnectForm({ orgSlug, channel, onDone }: { orgSlug: string; channel: Exclude<Channel, "webchat">; onDone: () => void }) {
  const g = GUIDE[channel];
  const { pending, run } = useRun();
  const [error, setError] = useState<string | null>(null);
  return (
    <form className="grid gap-4" action={(fd) => { setError(null); run(() => ACTION[channel](orgSlug, Object.fromEntries(g.fields.map((f) => [f.key, String(fd.get(f.key) ?? "")]))) as Promise<Result>, `${CHANNEL_LABELS[channel]} connected`, setError, onDone); }}>
      <div>
        <h3 className="font-medium">Connect {g.title}</h3>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">{g.steps.map((x) => <li key={x}>{x}</li>)}</ol>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {g.fields.map((f) => (
          <label key={f.key} className="grid gap-1 text-sm font-medium">{f.label}
            <Input name={f.key} type={f.type ?? "text"} placeholder={f.placeholder} autoComplete="off" spellCheck={false} required />
            {f.hint && <span className="text-xs font-normal text-muted-foreground">{f.hint}</span>}
          </label>
        ))}
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>{pending ? "Checking with the provider…" : "Connect"}</Button>
        <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}

function WebchatForm({ orgSlug, existing, onDone }: { orgSlug: string; existing?: ChannelView; onDone: () => void }) {
  const s = (existing?.settings ?? {}) as { title?: string; greeting?: string; color?: string; askEmail?: boolean };
  const [v, setV] = useState({ name: existing?.name ?? "Website chat", title: s.title ?? "Chat with us", greeting: s.greeting ?? "Hi! How can we help?", color: s.color ?? "#0053ee", askEmail: s.askEmail ?? true });
  const { pending, run } = useRun();
  const [error, setError] = useState<string | null>(null);
  return (
    <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); setError(null); run(() => (existing ? updateWebchatAction(orgSlug, existing.id, v) : connectWebchatAction(orgSlug, v)) as Promise<Result>, existing ? "Chat updated" : "Web chat added", setError, onDone); }}>
      {!existing && <h3 className="font-medium">Add website chat</h3>}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm font-medium">Channel name<Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></label>
        <label className="grid gap-1 text-sm font-medium">Chat title<Input value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} /></label>
        <label className="grid gap-1 text-sm font-medium sm:col-span-2">Greeting<Textarea rows={2} value={v.greeting} onChange={(e) => setV({ ...v, greeting: e.target.value })} /></label>
        <label className="flex items-center gap-2 text-sm font-medium">Color<input type="color" value={v.color} onChange={(e) => setV({ ...v, color: e.target.value })} className="h-9 w-12 rounded border" aria-label="Chat color" /></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-[var(--brand-primary)]" checked={v.askEmail} onChange={(e) => setV({ ...v, askEmail: e.target.checked })} />Ask visitors for their email</label>
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : existing ? "Save" : "Add web chat"}</Button>
        <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}

export function SavedRepliesManager({ orgSlug, replies, canEdit }: { orgSlug: string; replies: { id: string; title: string; body: string }[]; canEdit: boolean }) {
  const { pending, run } = useRun();
  const [v, setV] = useState({ title: "", body: "" });
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      {replies.length === 0 ? <p className="text-sm text-muted-foreground">No saved replies yet.</p> : (
        <ul className="divide-y rounded-md border text-sm">
          {replies.map((r) => (
            <li key={r.id} className="flex items-start gap-3 px-3 py-2">
              <div className="min-w-0 flex-1"><p className="font-medium">{r.title}</p><p className="line-clamp-2 whitespace-pre-wrap text-muted-foreground">{r.body}</p></div>
              {canEdit && <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => archiveSavedReplyAction(orgSlug, r.id) as Promise<Result>, "Removed", setError)}>Remove</Button>}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <form className="grid max-w-xl gap-2" onSubmit={(e) => { e.preventDefault(); setError(null); run(() => createSavedReplyAction(orgSlug, v) as Promise<Result>, "Saved reply added", setError, () => setV({ title: "", body: "" })); }}>
          <label className="grid gap-1 text-sm font-medium">Name<Input value={v.title} placeholder="Delivery times" onChange={(e) => setV({ ...v, title: e.target.value })} /></label>
          <label className="grid gap-1 text-sm font-medium">Reply<Textarea rows={3} value={v.body} onChange={(e) => setV({ ...v, body: e.target.value })} /></label>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <Button type="submit" className="w-fit" disabled={pending || !v.title.trim() || !v.body.trim()}>Add saved reply</Button>
        </form>
      )}
    </div>
  );
}
