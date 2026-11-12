"use client";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { useCallback, useState, useTransition } from "react";
import { toast } from "sonner";
import { FormField } from "@/components/app/form";
import { RecordPicker, type PickerOption } from "@/components/app/record-picker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input, NativeSelect } from "@/components/ui/input";
import { searchCustomersAction } from "../../customers/actions";
import { SOURCE_OPTIONS, CURRENCY_OPTIONS } from "../../customers/_components/labels";
import { createLeadAction } from "../actions";
import { PRIORITY_OPTIONS } from "./labels";

export function NewLeadDialog({
  orgSlug,
  pipelines,
  defaultPipelineId,
  defaultStageId,
  members,
  defaultCurrency,
  canAssign,
  presetCustomer,
  trigger,
  defaultOpen,
}: {
  orgSlug: string;
  pipelines: { id: string; name: string; stages: { id: string; name: string; category: string }[] }[];
  defaultPipelineId?: string;
  defaultStageId?: string;
  members: { membershipId: string; name: string }[];
  defaultCurrency: string;
  canAssign: boolean;
  presetCustomer?: PickerOption;
  trigger?: React.ReactNode;
  /** Open on mount (Quick create links use ?new=1). */
  defaultOpen?: boolean;
}) {
  const router = useRouter();
  const [open, setOpenState] = useState(!!defaultOpen);
  const setOpen = (o: boolean) => {
    setOpenState(o);
    if (!o && defaultOpen && typeof window !== "undefined" && window.location.search.includes("new=1")) router.replace(window.location.pathname);
  };
  const [pipelineId, setPipelineId] = useState(defaultPipelineId ?? pipelines[0]?.id);
  const pipeline = pipelines.find((p) => p.id === pipelineId) ?? pipelines[0];
  const openStages = pipeline?.stages.filter((s) => s.category === "open") ?? [];
  const [stageId, setStageId] = useState(defaultStageId ?? "");
  const [customer, setCustomer] = useState<PickerOption | null>(presetCustomer ?? null);
  const [form, setForm] = useState({ title: "", value: "", currency: defaultCurrency, source: "", priority: "medium", ownerMembershipId: "", expectedCloseDate: "" });
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const search = useCallback((q: string) => searchCustomersAction(orgSlug, q), [orgSlug]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const res = await createLeadAction(orgSlug, {
        title: form.title,
        customerId: customer?.id ?? null,
        pipelineId: pipeline?.id,
        stageId: stageId || undefined,
        value: form.value || null,
        currency: form.currency,
        source: (form.source || null) as never,
        priority: form.priority as never,
        ownerMembershipId: form.ownerMembershipId || null,
        expectedCloseDate: form.expectedCloseDate || null,
      });
      if (res.ok) {
        toast.success(`Lead LEAD-${res.data.number} created`);
        setOpen(false);
        setForm({ ...form, title: "", value: "", expectedCloseDate: "" });
        if (!presetCustomer) setCustomer(null);
        setErrors({});
        setFormError(null);
        router.refresh();
      } else {
        setErrors(res.fieldErrors ?? {});
        setFormError(res.error);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger ?? <Button><Plus /> New lead</Button>}</DialogTrigger>
      <DialogContent className="max-w-xl">
        <form onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>New lead</DialogTitle>
            <DialogDescription>Track an opportunity from first inquiry to won.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            {formError && <p className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">{formError}</p>}
            <FormField label="Title" htmlFor="lead-title" required errors={errors.title}>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Wedding catering for 200 guests" />
            </FormField>
            <div className="grid gap-1.5">
              <span className="text-sm font-medium">Customer</span>
              <RecordPicker label="Customer" value={customer} onChange={setCustomer} search={search} placeholder="Search customers by name, email, phone…" invalid={!!errors.customerId} />
              {errors.customerId && <p className="text-xs text-danger" role="alert">{errors.customerId[0]}</p>}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {pipelines.length > 1 && (
                <FormField label="Pipeline" htmlFor="lead-pipeline">
                  <NativeSelect value={pipeline?.id} onChange={(e) => { setPipelineId(e.target.value); setStageId(""); }}>
                    {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </NativeSelect>
                </FormField>
              )}
              <FormField label="Stage" htmlFor="lead-stage" errors={errors.stageId}>
                <NativeSelect value={stageId} onChange={(e) => setStageId(e.target.value)}>
                  <option value="">{openStages[0]?.name ?? "First stage"} (default)</option>
                  {openStages.slice(1).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </NativeSelect>
              </FormField>
            </div>
            <div className="grid gap-4 sm:grid-cols-[1fr_7rem]">
              <FormField label="Estimated value" htmlFor="lead-value" errors={errors.value}>
                <Input inputMode="decimal" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} placeholder="0.00" />
              </FormField>
              <FormField label="Currency" htmlFor="lead-currency">
                <NativeSelect value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
                  {CURRENCY_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </NativeSelect>
              </FormField>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <FormField label="Source" htmlFor="lead-source" errors={errors.source}>
                <NativeSelect value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}>
                  <option value="">Not set</option>
                  {SOURCE_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </NativeSelect>
              </FormField>
              <FormField label="Priority" htmlFor="lead-priority">
                <NativeSelect value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                  {PRIORITY_OPTIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </NativeSelect>
              </FormField>
              <FormField label="Expected close" htmlFor="lead-close" errors={errors.expectedCloseDate}>
                <Input type="date" value={form.expectedCloseDate} onChange={(e) => setForm({ ...form, expectedCloseDate: e.target.value })} />
              </FormField>
            </div>
            {canAssign && (
              <FormField label="Assigned representative" htmlFor="lead-owner" errors={errors.ownerMembershipId}>
                <NativeSelect value={form.ownerMembershipId} onChange={(e) => setForm({ ...form, ownerMembershipId: e.target.value })}>
                  <option value="">Unassigned</option>
                  {members.map((m) => <option key={m.membershipId} value={m.membershipId}>{m.name}</option>)}
                </NativeSelect>
              </FormField>
            )}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>{pending ? "Creating…" : "Create lead"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
