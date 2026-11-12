"use client";
import { Check, Copy, Info, UserPlus } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import { FormAlert, FormField, SubmitButton, fieldErrors } from "@/components/app/form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input, NativeSelect } from "@/components/ui/input";
import { inviteMemberAction } from "./actions";

export function InviteDialog({
  orgSlug,
  roles,
  defaultOpen,
  emailConnected,
}: {
  orgSlug: string;
  roles: { id: string; name: string; key: string }[];
  defaultOpen?: boolean;
  emailConnected: boolean;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  const [formKey, setFormKey] = useState(0);
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setFormKey((k) => k + 1); }}>
      <DialogTrigger asChild>
        <Button><UserPlus /> Invite member</Button>
      </DialogTrigger>
      <DialogContent>
        <InviteForm key={formKey} orgSlug={orgSlug} roles={roles} emailConnected={emailConnected} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

function InviteForm({ orgSlug, roles, emailConnected, onDone }: { orgSlug: string; roles: { id: string; name: string; key: string }[]; emailConnected: boolean; onDone: () => void }) {
  const [state, action] = useActionState(inviteMemberAction.bind(null, orgSlug), null);
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (copied) { const t = setTimeout(() => setCopied(false), 2000); return () => clearTimeout(t); } }, [copied]);
  const defaultRole = roles.find((r) => r.key === "sales_rep")?.id ?? roles[0]?.id;

  if (state?.ok) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Invitation created</DialogTitle>
          <DialogDescription>
            {state.data.email} is invited as {state.data.roleName}. The link expires in 7 days and works only for that email.
          </DialogDescription>
        </DialogHeader>
        {!emailConnected && (
          <p className="mb-3 flex gap-2 rounded-md border border-info/30 bg-info/10 p-3 text-sm text-info">
            <Info className="mt-0.5 size-4 shrink-0" />
            Email delivery isn&apos;t connected yet, so no email was sent. Copy this link and share it with them directly.
          </p>
        )}
        <div className="flex gap-2">
          <Input readOnly value={state.data.link} aria-label="Invitation link" onFocus={(e) => e.currentTarget.select()} />
          <Button type="button" variant="outline" onClick={() => { void navigator.clipboard.writeText(state.data.link); setCopied(true); }}>
            {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <DialogFooter><Button onClick={onDone}>Done</Button></DialogFooter>
      </>
    );
  }

  return (
    <form action={action} noValidate>
      <DialogHeader>
        <DialogTitle>Invite a team member</DialogTitle>
        <DialogDescription>They&apos;ll get access according to the role you choose. You can change it later.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-4">
        <FormAlert state={state} />
        <FormField label="Email" htmlFor="invite-email" required errors={fieldErrors(state, "email")}>
          <Input name="email" type="email" autoComplete="off" />
        </FormField>
        <FormField label="Role" htmlFor="invite-role" required errors={fieldErrors(state, "roleId")}>
          <NativeSelect name="roleId" defaultValue={defaultRole}>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </NativeSelect>
        </FormField>
      </div>
      <DialogFooter>
        <SubmitButton pendingText="Creating…">Create invitation</SubmitButton>
      </DialogFooter>
    </form>
  );
}
