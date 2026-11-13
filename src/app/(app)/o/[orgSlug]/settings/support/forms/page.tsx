import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { can, loadSupportSettings, SupportSettingsHeader } from "../shell";
import { FormsManager } from "./forms-client";

export default async function FormsPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const { ctx, settings } = await loadSupportSettings(orgSlug);
  return (
    <>
      <SupportSettingsHeader orgSlug={orgSlug} active="forms" showAudit={can(ctx, "audit.read")} />
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Ticket forms</CardTitle>
          <CardDescription>
            Forms customers fill in on your support portal. Name, email, subject and message are always asked; add the extra questions you need. Edits are saved as a draft —
            customers keep seeing the published version until you publish again, and every ticket remembers the exact version it was submitted with.
          </CardDescription>
        </CardHeader>
        <CardContent><FormsManager orgSlug={orgSlug} forms={settings.forms} types={settings.types} /></CardContent>
      </Card>
    </>
  );
}
