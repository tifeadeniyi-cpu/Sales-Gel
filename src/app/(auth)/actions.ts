"use server";
import { APIError } from "better-auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/server/auth/auth";
import { requireUser } from "@/server/auth/session";
import { runAction, str, type ActionResult } from "@/server/actions";
import { acceptInvitation, createOrganization } from "@/domains/identity/service";
import { ValidationError } from "@/server/errors";
import { parseInput } from "@/server/validate";
import { safeNext } from "@/lib/safe-next";

const credentials = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email")),
  password: z.string().min(1, "Enter your password"),
});

const signUpSchema = z.object({
  name: z.string().trim().min(2, "Enter your name").max(120),
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email")),
  password: z.string().min(10, "Use at least 10 characters").max(128),
});

function authErrorMessage(err: unknown, fallback: string): never {
  if (err instanceof APIError) {
    const code = (err.body as { code?: string } | undefined)?.code;
    if (code === "INVALID_EMAIL_OR_PASSWORD") throw new ValidationError("Incorrect email or password.");
    if (code === "USER_ALREADY_EXISTS" || code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL") {
      throw new ValidationError("An account with this email already exists.", { email: ["An account with this email already exists — sign in instead."] });
    }
    if (err.status === "TOO_MANY_REQUESTS") throw new ValidationError("Too many attempts. Please wait a minute and try again.");
    throw new ValidationError(err.message || fallback);
  }
  throw err;
}

export async function signInAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const next = safeNext(str(fd, "next"));
  const result = await runAction(async () => {
    const data = parseInput(credentials, { email: str(fd, "email"), password: fd.get("password") });
    try {
      await auth.api.signInEmail({ body: data, headers: await headers() });
    } catch (err) {
      authErrorMessage(err, "Sign in failed.");
    }
  });
  if (result.ok) redirect(next ?? "/o");
  return result;
}

export async function signUpAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const next = safeNext(str(fd, "next"));
  const result = await runAction(async () => {
    const data = parseInput(signUpSchema, { name: str(fd, "name"), email: str(fd, "email"), password: fd.get("password") });
    try {
      await auth.api.signUpEmail({ body: data, headers: await headers() });
    } catch (err) {
      authErrorMessage(err, "Sign up failed.");
    }
  });
  if (result.ok) redirect(next ?? "/onboarding");
  return result;
}

export async function signOutAction() {
  await auth.api.signOut({ headers: await headers() });
  redirect("/sign-in");
}

export async function createOrganizationAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() =>
    createOrganization(user, {
      name: str(fd, "name") ?? "",
      slug: str(fd, "slug") ?? "",
      businessType: (str(fd, "businessType") as never) ?? undefined,
      timezone: str(fd, "timezone") ?? "UTC",
      defaultCurrency: (str(fd, "defaultCurrency") as never) ?? "USD",
    }),
  );
  if (result.ok) redirect(`/o/${result.data.slug}`);
  return result as ActionResult;
}

export async function acceptInvitationAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() => acceptInvitation(user, str(fd, "token") ?? ""));
  if (result.ok) redirect(`/o/${result.data.orgSlug}`);
  return result as ActionResult;
}
