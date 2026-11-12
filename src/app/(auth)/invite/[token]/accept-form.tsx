"use client";
import { useActionState } from "react";
import { FormAlert, SubmitButton } from "@/components/app/form";
import { acceptInvitationAction } from "../../actions";

export function AcceptForm({ token }: { token: string }) {
  const [state, action] = useActionState(acceptInvitationAction, null);
  return (
    <form action={action} className="grid gap-3">
      <FormAlert state={state} />
      <input type="hidden" name="token" value={token} />
      <SubmitButton pendingText="Joining…" className="w-full">Accept invitation</SubmitButton>
    </form>
  );
}
