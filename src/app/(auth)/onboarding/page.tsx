import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/server/auth/session";
import { OrgForm } from "./org-form";

export const metadata: Metadata = { title: "Create workspace · SalesGel" };

export default async function OnboardingPage() {
  const user = await requireUser();
  const timezones = ["UTC", ...Intl.supportedValuesOf("timeZone")];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Set up your business</CardTitle>
        <CardDescription>
          Hi {user.name.split(" ")[0]}, create a workspace for your business. You can invite your team next.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <OrgForm timezones={timezones} />
      </CardContent>
    </Card>
  );
}
