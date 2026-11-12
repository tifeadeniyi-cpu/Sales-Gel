import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getInvitationByToken } from "@/domains/identity/service";
import { getSessionUser } from "@/server/auth/session";
import { AcceptForm } from "./accept-form";

export const metadata: Metadata = { title: "Invitation · Commerce CRM", robots: { index: false } };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [inv, user] = await Promise.all([getInvitationByToken(token), getSessionUser()]);
  const self = `/invite/${encodeURIComponent(token)}`;

  if (!inv || !inv.usable) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Invitation unavailable</CardTitle>
          <CardDescription>
            {inv?.status === "accepted"
              ? "This invitation has already been accepted."
              : "This invitation link is invalid, revoked or has expired. Ask the person who invited you to send a new one."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline"><Link href="/o">Go to my workspaces</Link></Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Join {inv.orgName}</CardTitle>
        <CardDescription>
          You&apos;ve been invited as <strong>{inv.roleName}</strong>. This invitation is for <strong>{inv.email}</strong>.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {!user ? (
          <>
            <Button asChild><Link href={`/sign-up?next=${encodeURIComponent(self)}&email=${encodeURIComponent(inv.email)}`}>Create account to join</Link></Button>
            <Button asChild variant="outline"><Link href={`/sign-in?next=${encodeURIComponent(self)}`}>I already have an account</Link></Button>
          </>
        ) : user.email.toLowerCase() !== inv.email.toLowerCase() ? (
          <p className="rounded-md border border-warning/30 bg-warning/10 p-3 text-sm text-warning" role="alert">
            You&apos;re signed in as {user.email}. Sign out and sign in as {inv.email} to accept.
          </p>
        ) : (
          <AcceptForm token={token} />
        )}
      </CardContent>
    </Card>
  );
}
