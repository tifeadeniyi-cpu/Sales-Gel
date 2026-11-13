"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { CallButton } from "@/components/app/softphone";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/input";
import { formatDateTime } from "@/lib/utils";
import { deleteVoicemailAction, updateVoicemailAction } from "../actions";

interface Vm { id: string; callId: string; callNumber: number; from: string; durationSec: number | null; status: string; createdAt: string; customerId: string | null; customerName: string | null; assignedMembershipId: string | null }

export function VoicemailItem({ orgSlug, vm, timezone, members, canDelete }: { orgSlug: string; vm: Vm; timezone: string; members: { id: string; name: string }[]; canDelete: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const update = (input: object, ok: string) => start(async () => { const r = await updateVoicemailAction(orgSlug, vm.id, input); if (r.ok) { toast.success(ok); router.refresh(); } else toast.error(r.error); });
  const who = vm.customerName ?? vm.from;
  const len = vm.durationSec === null ? "" : `${Math.floor(vm.durationSec / 60)}:${String(vm.durationSec % 60).padStart(2, "0")}`;
  return (
    <li className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium">{vm.customerId ? <Link href={`/o/${orgSlug}/customers/${vm.customerId}`} className="text-primary hover:underline">{who}</Link> : who}{vm.customerName && <span className="ml-2 text-xs text-muted-foreground">{vm.from}</span>}</p>
          <p className="text-xs text-muted-foreground">{formatDateTime(vm.createdAt, timezone)}{len && ` · ${len}`} · <Link href={`/o/${orgSlug}/phone/calls/${vm.callId}`} className="hover:underline">Call #{vm.callNumber}</Link></p>
        </div>
        <CallButton dial={{ to: vm.from, customerId: vm.customerId ?? undefined, label: vm.customerName ?? undefined }} />
      </div>
      <audio controls preload="none" src={`/o/${orgSlug}/phone/voicemail/${vm.id}/audio`} className="mt-3 w-full" aria-label={`Voicemail from ${who}`} />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <NativeSelect aria-label="Assign voicemail" className="h-8 w-48 text-xs" value={vm.assignedMembershipId ?? ""} disabled={pending} onChange={(e) => update({ assignedMembershipId: e.target.value || null }, "Assigned")}>
          <option value="">Unassigned</option>
          {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </NativeSelect>
        {vm.status === "new" && <Button size="sm" variant="outline" disabled={pending} onClick={() => update({ status: "reviewed" }, "Marked reviewed")}>Mark reviewed</Button>}
        {vm.status !== "archived" ? <Button size="sm" variant="ghost" disabled={pending} onClick={() => update({ status: "archived" }, "Archived")}>Archive</Button>
          : <Button size="sm" variant="ghost" disabled={pending} onClick={() => update({ status: "new" }, "Moved to new")}>Restore</Button>}
        {canDelete && (
          <ConfirmDialog trigger={<Button size="sm" variant="ghost" className="text-danger">Delete</Button>} title="Delete this voicemail?" description="The recording is deleted from Twilio and can't be recovered. The call stays in your history." confirmLabel="Delete recording"
            onConfirm={() => deleteVoicemailAction(orgSlug, vm.id)} successMessage="Voicemail deleted" />
        )}
      </div>
    </li>
  );
}
