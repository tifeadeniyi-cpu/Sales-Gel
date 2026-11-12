"use client";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { useFormStatus } from "react-dom";
import * as React from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Label } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { ActionResult } from "@/server/actions";

export function FormField({
  label,
  htmlFor,
  required,
  hint,
  errors,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  hint?: React.ReactNode;
  errors?: string[];
  children: React.ReactNode;
  className?: string;
}) {
  const errorId = `${htmlFor}-error`;
  const hintId = `${htmlFor}-hint`;
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required && <span className="ml-0.5 text-danger" aria-hidden>*</span>}
        {required && <span className="sr-only"> (required)</span>}
      </Label>
      {React.isValidElement<Record<string, unknown>>(children)
        ? React.cloneElement(children, {
            id: htmlFor,
            "aria-invalid": errors?.length ? true : undefined,
            "aria-describedby": [errors?.length ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined,
            required,
          })
        : children}
      {hint && !errors?.length && (
        <p id={hintId} className="text-xs text-muted-foreground">{hint}</p>
      )}
      {errors?.length ? (
        <p id={errorId} className="flex items-center gap-1 text-xs text-danger" role="alert">
          <AlertCircle className="size-3.5" /> {errors[0]}
        </p>
      ) : null}
    </div>
  );
}

export function SubmitButton({ children, pendingText, ...props }: ButtonProps & { pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || props.disabled} aria-busy={pending} {...props}>
      {pending && <Loader2 className="animate-spin" />}
      {pending ? (pendingText ?? children) : children}
    </Button>
  );
}

export function FormAlert({ state }: { state: ActionResult<unknown> | null }) {
  if (!state) return null;
  if (state.ok) {
    if (!state.message) return null;
    return (
      <div className="flex items-center gap-2 rounded-md border border-success/30 bg-success/10 px-3 py-2 text-sm text-success" role="status">
        <CheckCircle2 className="size-4" /> {state.message}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">
      <AlertCircle className="size-4 shrink-0" /> {state.error}
    </div>
  );
}

export function fieldErrors(state: ActionResult<unknown> | null, key: string): string[] | undefined {
  return state && !state.ok ? state.fieldErrors?.[key] : undefined;
}
