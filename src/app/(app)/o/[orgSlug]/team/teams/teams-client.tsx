"use client";
import { Trash2, Users } from "lucide-react";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { FormAlert, FormField, SubmitButton, fieldErrors } from "@/components/app/form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { createTeamAction, deleteTeamAction, setTeamMembersAction } from "../actions";

export function CreateTeamForm({ orgSlug }: { orgSlug: string }) {
  const [state, action] = useActionState(createTeamAction.bind(null, orgSlug), null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok) ref.current?.reset(); }, [state]);
  return (
    <form ref={ref} action={action} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end" noValidate>
      <FormField label="Team name" htmlFor="team-name" required errors={fieldErrors(state, "name")}>
        <Input name="name" placeholder="e.g. Customer Care" />
      </FormField>
      <FormField label="Description" htmlFor="team-desc" errors={fieldErrors(state, "description")}>
        <Input name="description" />
      </FormField>
      <SubmitButton pendingText="Creating…">Create team</SubmitButton>
      <div className="sm:col-span-3"><FormAlert state={state} /></div>
    </form>
  );
}

export function TeamCard({
  orgSlug,
  team,
  members,
  manage,
}: {
  orgSlug: string;
  team: { id: string; name: string; description: string | null; membershipIds: string[] };
  members: { membershipId: string; name: string; email: string }[];
  manage: boolean;
}) {
  const [selected, setSelected] = useState(new Set(team.membershipIds));
  const [pending, start] = useTransition();
  const dirty = selected.size !== team.membershipIds.length || team.membershipIds.some((id) => !selected.has(id));

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between">
        <div>
          <CardTitle className="flex items-center gap-2"><Users className="size-4 text-primary" /> {team.name}</CardTitle>
          {team.description && <p className="text-sm text-muted-foreground">{team.description}</p>}
        </div>
        {manage && (
          <ConfirmDialog
            trigger={<Button size="icon" variant="ghost" aria-label={`Delete ${team.name}`}><Trash2 /></Button>}
            title={`Delete ${team.name}?`}
            description="Members stay in the organization; only the team grouping is removed."
            confirmLabel="Delete team"
            onConfirm={() => deleteTeamAction(orgSlug, team.id)}
            successMessage="Team deleted"
          />
        )}
      </CardHeader>
      <CardContent>
        <ul className="grid gap-1 sm:grid-cols-2">
          {members.map((m) => (
            <li key={m.membershipId}>
              <label className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted/40">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--brand-primary)]"
                  disabled={!manage || pending}
                  checked={selected.has(m.membershipId)}
                  onChange={() => setSelected((s) => { const n = new Set(s); if (n.has(m.membershipId)) n.delete(m.membershipId); else n.add(m.membershipId); return n; })}
                />
                <span className="truncate">{m.name}</span>
              </label>
            </li>
          ))}
        </ul>
        {manage && dirty && (
          <div className="mt-3 flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setSelected(new Set(team.membershipIds))} disabled={pending}>Cancel</Button>
            <Button
              size="sm"
              disabled={pending}
              onClick={() => start(async () => {
                const res = await setTeamMembersAction(orgSlug, team.id, [...selected]);
                if (res.ok) toast.success("Team members saved"); else { toast.error(res.error); setSelected(new Set(team.membershipIds)); }
              })}
            >
              {pending ? "Saving…" : "Save members"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
