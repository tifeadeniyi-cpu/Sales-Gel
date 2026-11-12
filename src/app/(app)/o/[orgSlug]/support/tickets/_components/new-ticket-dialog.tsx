"use client";
import { useRouter } from "next/navigation";
import { Paperclip, X } from "lucide-react";
import { useCallback, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { FormField } from "@/components/app/form";
import { RecordPicker, type PickerOption } from "@/components/app/record-picker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { CHANNEL_LABELS, PRIORITY_LABELS } from "@/domains/support/validation";
import { searchCustomersAction } from "../../../customers/actions";
import { createTicketAction, searchOrdersForTicketAction } from "../actions";

export interface NewTicketLookups {
  types: { id: string; name: string }[];
  members: { membershipId: string; name: string }[];
  canAssign: boolean;
  canLinkOrders: boolean;
}

export function NewTicketDialog({
  orgSlug, open, onOpenChange, lookups, presetCustomer, presetOrder,
}: {
  orgSlug: string; open: boolean; onOpenChange: (o: boolean) => void; lookups: NewTicketLookups; presetCustomer?: PickerOption | null; presetOrder?: PickerOption | null;
}) {
  const router = useRouter();
  const [customer, setCustomer] = useState<PickerOption | null>(presetCustomer ?? null);
  const [order, setOrder] = useState<PickerOption | null>(presetOrder ?? null);
  const [v, setV] = useState({ subject: "", description: "", channel: "phone", priority: "normal", ticketTypeId: "", assigneeMembershipId: "" });
  const [files, setFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const searchCustomers = useCallback((q: string) => searchCustomersAction(orgSlug, q), [orgSlug]);
  const searchOrders = useCallback((q: string) => searchOrdersForTicketAction(orgSlug, q), [orgSlug]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const fd = new FormData();
      fd.set("input", JSON.stringify({ ...v, customerId: customer?.id ?? null, orderId: order?.id ?? null }));
      files.forEach((f) => fd.append("files", f));
      const res = await createTicketAction(orgSlug, fd);
      if (res.ok) {
        toast.success(`Ticket TCK-${res.data.number} created`);
        onOpenChange(false);
        router.push(`/o/${orgSlug}/support/tickets/${res.data.id}`);
      } else {
        setErrors(res.fieldErrors ?? {});
        setFormError(res.error);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <form onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>New ticket</DialogTitle>
            <DialogDescription>Log a customer issue from a call, message or visit.</DialogDescription>
          </DialogHeader>
          <div className="grid max-h-[65vh] gap-4 overflow-y-auto pr-1">
            {formError && <p className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">{formError}</p>}
            <FormField label="Subject" htmlFor="t-subject" required errors={errors.subject}>
              <Input value={v.subject} onChange={(e) => setV({ ...v, subject: e.target.value })} placeholder="e.g. Parcel arrived damaged" autoFocus />
            </FormField>
            <div className="grid gap-1.5">
              <span className="text-sm font-medium">Customer</span>
              <RecordPicker label="Customer" value={customer} onChange={setCustomer} search={searchCustomers} placeholder="Search customers…" invalid={!!errors.customerId} />
              {errors.customerId && <p className="text-xs text-danger">{errors.customerId[0]}</p>}
            </div>
            {lookups.canLinkOrders && (
              <div className="grid gap-1.5">
                <span className="text-sm font-medium">Related order</span>
                <RecordPicker label="Related order" value={order} onChange={setOrder} search={searchOrders} placeholder="Search ORD-number or customer…" invalid={!!errors.orderId} />
                {errors.orderId && <p className="text-xs text-danger">{errors.orderId[0]}</p>}
              </div>
            )}
            <FormField label="What did the customer say?" htmlFor="t-desc" errors={errors.description}>
              <Textarea rows={4} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />
            </FormField>
            <div className="grid gap-4 sm:grid-cols-3">
              <FormField label="Received via" htmlFor="t-channel">
                <NativeSelect value={v.channel} onChange={(e) => setV({ ...v, channel: e.target.value })}>
                  {Object.entries(CHANNEL_LABELS).filter(([k]) => k !== "portal" && k !== "web_form").map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </NativeSelect>
              </FormField>
              <FormField label="Priority" htmlFor="t-priority">
                <NativeSelect value={v.priority} onChange={(e) => setV({ ...v, priority: e.target.value })}>
                  {Object.entries(PRIORITY_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </NativeSelect>
              </FormField>
              <FormField label="Type" htmlFor="t-type" errors={errors.ticketTypeId}>
                <NativeSelect value={v.ticketTypeId} onChange={(e) => setV({ ...v, ticketTypeId: e.target.value })}>
                  <option value="">Not set</option>
                  {lookups.types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </NativeSelect>
              </FormField>
            </div>
            {lookups.canAssign ? (
              <FormField label="Assign to" htmlFor="t-assignee" errors={errors.assigneeMembershipId}>
                <NativeSelect value={v.assigneeMembershipId} onChange={(e) => setV({ ...v, assigneeMembershipId: e.target.value })}>
                  <option value="">Unassigned</option>
                  {lookups.members.map((m) => <option key={m.membershipId} value={m.membershipId}>{m.name}</option>)}
                </NativeSelect>
              </FormField>
            ) : <p className="text-xs text-muted-foreground">This ticket will be assigned to you.</p>}
            <div>
              <input ref={fileRef} type="file" multiple hidden onChange={(e) => setFiles([...files, ...Array.from(e.target.files ?? [])].slice(0, 5))} aria-label="Attach files" />
              <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}><Paperclip /> Attach files</Button>
              <span className="ml-2 text-xs text-muted-foreground">Up to 5 files, 4 MB total</span>
              {files.length > 0 && (
                <ul className="mt-2 space-y-1 text-sm">
                  {files.map((f, i) => (
                    <li key={`${f.name}-${i}`} className="flex items-center gap-2">
                      <span className="truncate">{f.name}</span>
                      <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}><X className="size-3.5" /></button>
                    </li>
                  ))}
                </ul>
              )}
              {errors.files && <p className="mt-1 text-xs text-danger">{errors.files[0]}</p>}
            </div>
          </div>
          <DialogFooter><Button type="submit" disabled={pending}>{pending ? "Creating…" : "Create ticket"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function NewTicketButton(props: Omit<Parameters<typeof NewTicketDialog>[0], "open" | "onOpenChange"> & { label?: string; size?: "sm" | "default"; variant?: "default" | "outline"; defaultOpen?: boolean }) {
  const { label = "New ticket", size, variant, defaultOpen, ...rest } = props;
  const [open, setOpen] = useState(!!defaultOpen);
  const router = useRouter();
  const change = (o: boolean) => {
    setOpen(o);
    // Opened from Quick create (?new=1): drop the flag so it can be used again and doesn't reopen on refresh.
    if (!o && defaultOpen) router.replace(window.location.pathname);
  };
  return (
    <>
      <Button size={size} variant={variant} onClick={() => setOpen(true)}>{label}</Button>
      {open && <NewTicketDialog {...rest} open={open} onOpenChange={change} />}
    </>
  );
}
