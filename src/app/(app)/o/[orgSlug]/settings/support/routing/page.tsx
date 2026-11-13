import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { can, loadSupportSettings, SupportSettingsHeader } from "../shell";
import { RoutingRules } from "./routing-client";

export default async function RoutingPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const { ctx, settings } = await loadSupportSettings(orgSlug);
  return (
    <>
      <SupportSettingsHeader orgSlug={orgSlug} active="routing" showAudit={can(ctx, "audit.read")} />
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Routing rules</CardTitle>
          <CardDescription>
            Send new tickets to the right person automatically. Rules are checked top to bottom and the first match wins. For tickets your team creates, rules only fill in what was left empty;
            portal tickets get every action. Round robin rotates through a team&apos;s members who can work tickets (<Link className="text-primary hover:underline" href={`/o/${orgSlug}/team/teams`}>manage teams</Link>).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RoutingRules orgSlug={orgSlug} rules={settings.rules} teams={settings.teams} people={settings.people} types={settings.types} forms={settings.forms.map((f) => ({ id: f.id, name: f.name }))} />
        </CardContent>
      </Card>
    </>
  );
}
