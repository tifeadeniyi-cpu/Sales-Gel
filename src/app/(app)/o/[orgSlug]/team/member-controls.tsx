"use client";
import { Loader2, MoreHorizontal, UserCheck, UserMinus, UserX } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { NativeSelect } from "@/components/ui/input";
import { changeMemberRoleAction, removeMemberAction, revokeInvitationAction, setMemberStatusAction } from "./actions";

/** Inline role editor: saves on change, shows saving state, rolls back and explains on failure. */
export function RoleSelect({
  orgSlug,
  membershipId,
  roleId,
  roles,
  label,
}: {
  orgSlug: string;
  membershipId: string;
  roleId: string;
  roles: { id: string; name: string }[];
  label: string;
}) {
  const [value, setValue] = useState(roleId);
  const [pending, start] = useTransition();
  return (
    <div className="flex items-center gap-2">
      <NativeSelect
        aria-label={label}
        value={value}
        disabled={pending}
        className="h-8 w-48"
        onChange={(e) => {
          const prev = value;
          const next = e.target.value;
          setValue(next);
          start(async () => {
            const res = await changeMemberRoleAction(orgSlug, membershipId, next);
            if (res.ok) toast.success("Role updated");
            else {
              setValue(prev);
              toast.error(res.error);
            }
          });
        }}
      >
        {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
      </NativeSelect>
      {pending && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Saving" />}
    </div>
  );
}

export function MemberMenu({ orgSlug, membershipId, name, status, isSelf }: { orgSlug: string; membershipId: string; name: string; status: string; isSelf: boolean }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex justify-end gap-1">
      {status === "deactivated" ? (
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => start(async () => {
            const res = await setMemberStatusAction(orgSlug, membershipId, "active");
            if (res.ok) toast.success(`${name} reactivated`); else toast.error(res.error);
          })}
        >
          <UserCheck /> Reactivate
        </Button>
      ) : (
        !isSelf && (
          <ConfirmDialog
            trigger={<Button size="sm" variant="ghost"><UserMinus /> Deactivate</Button>}
            title={`Deactivate ${name}?`}
            description="They'll immediately lose access to this organization. Their history is kept and you can reactivate them later."
            confirmLabel="Deactivate"
            onConfirm={() => setMemberStatusAction(orgSlug, membershipId, "deactivated")}
            successMessage={`${name} deactivated`}
          />
        )
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon" variant="ghost" aria-label={`More actions for ${name}`}><MoreHorizontal /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <ConfirmDialog
            trigger={<DropdownMenuItem onSelect={(e) => e.preventDefault()} className="text-danger"><UserX /> {isSelf ? "Leave organization" : "Remove from organization"}</DropdownMenuItem>}
            title={isSelf ? "Leave this organization?" : `Remove ${name}?`}
            description="This removes their membership. Audit history is preserved. To return, they'll need a new invitation."
            confirmLabel={isSelf ? "Leave" : "Remove"}
            typeToConfirm={isSelf ? undefined : "REMOVE"}
            onConfirm={() => removeMemberAction(orgSlug, membershipId)}
            successMessage={isSelf ? "You left the organization" : `${name} removed`}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function RevokeInvitationButton({ orgSlug, invitationId, email }: { orgSlug: string; invitationId: string; email: string }) {
  return (
    <ConfirmDialog
      trigger={<Button size="sm" variant="ghost">Revoke</Button>}
      title="Revoke invitation?"
      description={`The link sent to ${email} will stop working.`}
      confirmLabel="Revoke"
      onConfirm={() => revokeInvitationAction(orgSlug, invitationId)}
      successMessage="Invitation revoked"
    />
  );
}
