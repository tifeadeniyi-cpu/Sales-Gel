"use client";
import Link from "next/link";
import { useActionState } from "react";
import { FormAlert, FormField, SubmitButton, fieldErrors } from "@/components/app/form";
import { Input } from "@/components/ui/input";
import { signInAction } from "../actions";

export function SignInForm({ next }: { next?: string }) {
  const [state, action] = useActionState(signInAction, null);
  return (
    <form action={action} className="grid gap-4" noValidate>
      <FormAlert state={state} />
      <input type="hidden" name="next" value={next ?? ""} />
      <FormField label="Email" htmlFor="email" required errors={fieldErrors(state, "email")}>
        <Input name="email" type="email" autoComplete="email" />
      </FormField>
      <FormField label="Password" htmlFor="password" required errors={fieldErrors(state, "password")}>
        <Input name="password" type="password" autoComplete="current-password" />
      </FormField>
      <SubmitButton pendingText="Signing in…" className="w-full">Sign in</SubmitButton>
      <p className="text-center text-sm text-muted-foreground">
        New here?{" "}
        <Link className="font-medium text-primary hover:underline" href={next ? `/sign-up?next=${encodeURIComponent(next)}` : "/sign-up"}>
          Create an account
        </Link>
      </p>
    </form>
  );
}
