"use client";
import { useRouter } from "next/navigation";
import { Paperclip, X } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { NativeSelect, Textarea } from "@/components/ui/input";
import { CHANNEL_LABELS } from "@/domains/support/validation";
import { cn } from "@/lib/utils";
import { addTicketMessageAction } from "../actions";

const TABS = [
  { kind: "reply", label: "Reply to customer" },
  { kind: "note", label: "Internal note" },
  { kind: "customer", label: "Log customer message" },
] as const;

export function Composer({ orgSlug, ticketId, closed, contact, portal = false }: { orgSlug: string; ticketId: string; closed: boolean; contact: string | null; portal?: boolean }) {
  const router = useRouter();
  const [kind, setKind] = useState<(typeof TABS)[number]["kind"]>(closed ? "note" : "reply");
  const [body, setBody] = useState("");
  const [channel, setChannel] = useState("phone");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ref = useRef<HTMLInputElement>(null);

  const submit = () =>
    start(async () => {
      const fd = new FormData();
      fd.set("kind", kind);
      fd.set("body", body);
      if (kind === "customer") fd.set("channel", channel);
      files.forEach((f) => fd.append("files", f));
      const res = await addTicketMessageAction(orgSlug, ticketId, fd);
      if (res.ok) {
        setBody("");
        setFiles([]);
        setError(null);
        toast.success(kind === "note" ? "Note added" : kind === "reply" ? "Reply saved" : "Customer message logged");
        router.refresh();
      } else setError(res.fieldErrors?.files?.[0] ?? res.error);
    });

  return (
    <div className={cn("rounded-lg border bg-card", kind === "note" && "border-highlight/50 bg-highlight/5")}>
      <div className="flex gap-1 border-b px-2 pt-2" role="tablist" aria-label="Message type">
        {TABS.map((t) => (
          <button key={t.kind} type="button" role="tab" aria-selected={kind === t.kind} disabled={closed && t.kind !== "note"} onClick={() => setKind(t.kind)}
            className={cn("rounded-t-md px-3 py-1.5 text-sm disabled:opacity-40", kind === t.kind ? "border-b-2 border-primary font-medium text-primary" : "text-muted-foreground hover:text-ink")}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="space-y-2 p-3">
        {kind === "reply" && (
          <p className="rounded-md bg-info/10 px-3 py-2 text-xs text-info">
            {portal
              ? "The customer sees replies on their portal request page. Email and WhatsApp delivery arrive with channel connections (Inbox build)."
              : <>Saved on the ticket for your team and the customer record. Sending replies by email or WhatsApp arrives with channel connections (Inbox build){contact ? ` — reach the customer at ${contact} for now` : ""}.</>}
          </p>
        )}
        {kind === "customer" && (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">Received via
            <NativeSelect className="h-8 w-40" value={channel} onChange={(e) => setChannel(e.target.value)} aria-label="Received via">
              {Object.entries(CHANNEL_LABELS).filter(([k]) => !["manual", "portal", "web_form"].includes(k)).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </NativeSelect>
          </label>
        )}
        <Textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} aria-label={TABS.find((t) => t.kind === kind)!.label}
          placeholder={kind === "note" ? "Only your team sees internal notes" : kind === "reply" ? "Write your reply…" : "What did the customer say?"} />
        {files.length > 0 && (
          <ul className="flex flex-wrap gap-2 text-xs">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex items-center gap-1 rounded-full bg-muted px-2 py-1">
                {f.name}<button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}><X className="size-3" /></button>
              </li>
            ))}
          </ul>
        )}
        {error && <p className="text-sm text-danger" role="alert">{error}</p>}
        <div className="flex items-center justify-between">
          <div>
            <input ref={ref} type="file" multiple hidden aria-label="Attach files" onChange={(e) => { setFiles([...files, ...Array.from(e.target.files ?? [])].slice(0, 5)); e.target.value = ""; }} />
            <Button type="button" variant="ghost" size="sm" onClick={() => ref.current?.click()}><Paperclip /> Attach</Button>
          </div>
          <Button type="button" disabled={pending || !body.trim()} onClick={submit}>
            {pending ? "Saving…" : kind === "note" ? "Add note" : kind === "reply" ? "Save reply" : "Log message"}
          </Button>
        </div>
      </div>
    </div>
  );
}
