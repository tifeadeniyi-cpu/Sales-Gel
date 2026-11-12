import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getSessionUser } from "@/server/auth/session";
import { safeNext } from "@/lib/safe-next";
import { SignUpForm } from "./sign-up-form";

export const metadata: Metadata = { title: "Create account · Commerce CRM" };

export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ next?: string; email?: string }> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next) ?? undefined;
  if (await getSessionUser()) redirect(next ?? "/o");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Create your account</CardTitle>
        <CardDescription>Customers, sales, orders and support in one connected workspace.</CardDescription>
      </CardHeader>
      <CardContent>
        <SignUpForm next={next} email={sp.email} />
      </CardContent>
    </Card>
  );
}
