"use client";
import Link from "next/link";
import { useActionState } from "react";
import { FormAlert, FormField, SubmitButton, fieldErrors } from "@/components/app/form";
import { Input } from "@/components/ui/input";
import { signUpAction } from "../actions";

export function SignUpForm({ next, email }: { next?: string; email?: string }) {
  const [state, action] = useActionState(signUpAction, null);
  return (
    <form action={action} className="grid gap-4" noValidate>
      <FormAlert state={state} />
      <input type="hidden" name="next" value={next ?? ""} />
      <FormField label="Your name" htmlFor="name" required errors={fieldErrors(state, "name")}>
        <Input name="name" autoComplete="name" />
      </FormField>
      <FormField label="Work email" htmlFor="email" required errors={fieldErrors(state, "email")}>
        <Input name="email" type="email" autoComplete="email" defaultValue={email} />
      </FormField>
      <FormField label="Password" htmlFor="password" required hint="At least 10 characters." errors={fieldErrors(state, "password")}>
        <Input name="password" type="password" autoComplete="new-password" />
      </FormField>
      <SubmitButton pendingText="Creating account…" className="w-full">Create account</SubmitButton>
      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link className="font-medium text-primary hover:underline" href={next ? `/sign-in?next=${encodeURIComponent(next)}` : "/sign-in"}>
          Sign in
        </Link>
      </p>
    </form>
  );
}
