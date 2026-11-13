"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState, useTransition } from "react";
import { toast } from "sonner";
import { RecordPicker, type PickerOption } from "@/components/app/record-picker";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Textarea } from "@/components/ui/input";
import { formatDateTime } from "@/lib/utils";
import { searchCustomersAction, searchLeadsAction } from "../../../customers/actions";
import { addCallNoteAction, createTaskFromCallAction, createTicketFromCallAction, linkCallAction } from "../../actions";

type Result = { ok: true; data: unknown } | { ok: false; error: string; fieldErrors?: Record<string, string[]> };
const msg = (r: Extract<Result, { ok: false }>) => Object.values(r.fieldErrors ?? {})[0]?.[0] ?? r.error;

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<Result>, ok: string, after?: (r: Extract<Result, { ok: true }>) => void) => start(async () => {
    const r = await fn();
    if (r.ok) { toast.success(ok); after?.(r); router.refresh(); } else toast.error(msg(r));
  });
  return { pending, run };
}

export function CallNotes({ orgSlug, callId, notes, timezone }: { orgSlug: string; callId: string; notes: { id: string; body: string; author: string | null; createdAt: string }[]; timezone: string }) {
  const [body, setBody] = useState("");
  const { pending, run } = useRun();
  return (
    <div className="space-y-3">
      {notes.length ? (
        <ul className="space-y-2">
          {notes.map((n) => <li key={n.id} className="rounded-md bg-muted/50 px-3 py-2 text-sm"><p className="whitespace-pre-wrap">{n.body}</p><p className="mt-1 text-xs text-muted-foreground">{n.author ?? "Someone"} · {formatDateTime(n.createdAt, timezone)}</p></li>)}
        </ul>
      ) : <p className="text-sm text-muted-foreground">No notes yet.</p>}
      <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); run(() => addCallNoteAction(orgSlug, callId, body), "Note added", () => setBody("")); }}>
        <Label htmlFor="call-note">Add a note</Label>
        <Textarea id="call-note" value={body} onChange={(e) => setBody(e.target.value)} rows={3} placeholder="What was discussed, what was promised…" />
        <Button type="submit" size="sm" disabled={pending || !body.trim()}>Save note</Button>
      </form>
    </div>
  );
}

type LinkKind = "customer" | "lead" | "order" | "ticket";
const HREF: Record<LinkKind, (s: string, id: string) => string> = {
  customer: (s, id) => `/o/${s}/customers/${id}`,
  lead: (s, id) => `/o/${s}/leads/${id}`,
  order: (s, id) => `/o/${s}/orders/${id}`,
  ticket: (s, id) => `/o/${s}/support/tickets/${id}`,
};

export function CallActions({ orgSlug, callId, links, can, defaultSubject }: {
  orgSlug: string; callId: string;
  links: Record<LinkKind, { id: string; name: string } | null>;
  can: { customers: boolean; leads: boolean; tasks: boolean; tickets: boolean };
  defaultSubject: string;
}) {
  const { pending, run } = useRun();
  const [picking, setPicking] = useState<"customer" | "lead" | null>(null);
  const [taskTitle, setTaskTitle] = useState("Call back");
  const [subject, setSubject] = useState(defaultSubject);
  const searchCustomers = useCallback((q: string) => searchCustomersAction(orgSlug, q), [orgSlug]);
  const searchLeads = useCallback((q: string) => searchLeadsAction(orgSlug, q), [orgSlug]);
  const link = (kind: LinkKind, targetId: string | null) => run(() => linkCallAction(orgSlug, callId, { kind, targetId }), targetId ? "Linked" : "Unlinked");

  const row = (kind: LinkKind, label: string, pickable: boolean) => {
    const v = links[kind];
    return (
      <div className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        {v ? (
          <div className="flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-sm">
            <Link href={HREF[kind](orgSlug, v.id)} className="min-w-0 truncate text-primary hover:underline">{v.name}</Link>
            <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={() => link(kind, null)} disabled={pending}>Unlink</button>
          </div>
        ) : picking === kind ? (
          <RecordPicker label={`Find a ${kind}`} value={null} search={kind === "customer" ? searchCustomers : searchLeads} onChange={(o: PickerOption | null) => { setPicking(null); if (o) link(kind, o.id); }} />
        ) : pickable ? (
          <Button size="sm" variant="outline" onClick={() => setPicking(kind as "customer" | "lead")}>Link {kind}</Button>
        ) : <p className="text-sm text-muted-foreground">None</p>}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>Linked records</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {row("customer", "Customer", can.customers)}
          {row("lead", "Lead", can.leads)}
          {links.order && row("order", "Order", false)}
          {row("ticket", "Ticket", false)}
        </CardContent>
      </Card>
      {(can.tasks || (can.tickets && !links.ticket)) && (
        <Card>
          <CardHeader><CardTitle>Follow up</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {can.tasks && (
              <form className="space-y-1.5" onSubmit={(e) => { e.preventDefault(); run(() => createTaskFromCallAction(orgSlug, callId, { title: taskTitle }), "Task created"); }}>
                <Label htmlFor="call-task">Task</Label>
                <div className="flex gap-2"><Input id="call-task" value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} /><Button type="submit" size="sm" variant="outline" disabled={pending}>Create task</Button></div>
              </form>
            )}
            {can.tickets && !links.ticket && (
              <form className="space-y-1.5" onSubmit={(e) => { e.preventDefault(); run(() => createTicketFromCallAction(orgSlug, callId, { subject }), "Ticket created"); }}>
                <Label htmlFor="call-ticket">Support ticket</Label>
                <div className="flex gap-2"><Input id="call-ticket" value={subject} onChange={(e) => setSubject(e.target.value)} /><Button type="submit" size="sm" variant="outline" disabled={pending}>Create ticket</Button></div>
              </form>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
