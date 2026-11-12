import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "Help · SalesGel" };

export default function HelpPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <Link href="/o" className="text-sm text-primary hover:underline">← Back to workspace</Link>
      <h1 className="mt-4 text-2xl font-semibold">Help</h1>
      <Card className="mt-6">
        <CardHeader><CardTitle>Getting started</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p><strong className="text-ink">Invite your team:</strong> Team &amp; Permissions → Invite member. Until email delivery is connected, copy the invitation link and send it directly.</p>
          <p><strong className="text-ink">Control access:</strong> every member has one role. Edit system roles or create custom roles under Roles &amp; permissions.</p>
          <p><strong className="text-ink">Audit trail:</strong> Owners and Admins can review every security-relevant change under Settings → Security &amp; audit log.</p>
          <p>Modules marked &ldquo;Soon&rdquo; in the sidebar are scheduled for upcoming releases.</p>
        </CardContent>
      </Card>
    </div>
  );
}
