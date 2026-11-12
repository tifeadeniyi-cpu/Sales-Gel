import Link from "next/link";
import { ArrowRight, CheckCircle2, Circle } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { listInvitations, listMembers } from "@/domains/identity/service";
import { getCustomerStats } from "@/domains/customers/service";
import { listAuditLogs } from "@/domains/platform/audit-queries";
import { requireOrgContext } from "@/server/authz/request";
import { can } from "@/server/authz/guards";
import { formatRelative } from "@/lib/utils";
import { describeAudit } from "@/lib/audit-labels";

const WIDGETS: { label: string; phase: number }[] = [
  { label: "Revenue", phase: 4 },
  { label: "Active leads", phase: 3 },
  { label: "Pipeline value", phase: 3 },
  { label: "Pending orders", phase: 4 },
  { label: "Unpaid orders", phase: 4 },
  { label: "Unread conversations", phase: 8 },
  { label: "Open tickets", phase: 5 },
  { label: "SLA breaches", phase: 7 },
  { label: "Tasks due today", phase: 3 },
  { label: "Overdue follow-ups", phase: 3 },
  { label: "Conversion rate", phase: 10 },
];

export default async function CommandCenter({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const ctx = await requireOrgContext(orgSlug);
  const base = `/o/${orgSlug}`;

  const canMembers = can(ctx, "members.read");
  const [members, invites, activity] = await Promise.all([
    canMembers ? listMembers(ctx) : Promise.resolve([]),
    canMembers ? listInvitations(ctx) : Promise.resolve([]),
    can(ctx, "audit.read") ? listAuditLogs(ctx, { limit: 8 }) : Promise.resolve(null),
  ]);
  const customerStats = can(ctx, "customers.read") || can(ctx, "customers.read_assigned") ? await getCustomerStats(ctx) : null;

  const checklist = [
    { label: "Create your workspace", done: true, href: `${base}/settings` },
    { label: "Invite a team member", done: members.length > 1 || invites.length > 0, href: `${base}/team?invite=1` },
    { label: "Review roles & permissions", done: null, href: `${base}/team/roles` },
    { label: "Set notification preferences", done: null, href: `${base}/settings/notifications` },
  ] satisfies { label: string; done: boolean | null; href: string }[];

  return (
    <>
      <PageHeader title="Command Center" description={`Welcome to ${ctx.orgName}. You're signed in as ${ctx.roleName}.`} />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Get set up</CardTitle>
            <CardDescription>Foundation steps for your workspace.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {checklist.map((c) => (
                <li key={c.label} className="flex items-center gap-3 py-2.5">
                  {c.done ? (
                    <CheckCircle2 className="size-5 text-success" aria-label="Done" />
                  ) : c.done === false ? (
                    <Circle className="size-5 text-muted-foreground" aria-label="Not done" />
                  ) : (
                    <ArrowRight className="size-5 text-muted-foreground" aria-hidden />
                  )}
                  <span className={c.done ? "flex-1 text-muted-foreground line-through" : "flex-1"}>{c.label}</span>
                  {!c.done && <Button asChild size="sm" variant="outline"><Link href={c.href}>Open</Link></Button>}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
            <CardDescription>From the audit log</CardDescription>
          </CardHeader>
          <CardContent>
            {!activity ? (
              <p className="text-sm text-muted-foreground">Activity is visible to Owners and Admins.</p>
            ) : activity.rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No activity yet.</p>
            ) : (
              <ul className="space-y-3">
                {activity.rows.map((a) => (
                  <li key={a.id} className="text-sm">
                    <span className="font-medium">{a.actorName ?? "System"}</span> {describeAudit(a.action)}
                    <div className="text-xs text-muted-foreground">{formatRelative(a.createdAt)}</div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Business metrics</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Widgets show real data from your records. Ones marked with a phase stay empty until that module ships, rather than showing sample numbers.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {customerStats && (
          <>
            <Link href={`${base}/customers?sort=created_desc`}>
              <Card className="h-full transition hover:border-primary/40">
                <CardContent className="p-4">
                  <div className="text-sm font-medium text-ink/70">New customers (30 days)</div>
                  <div className="text-2xl font-semibold">{customerStats.new30.toLocaleString()}</div>
                </CardContent>
              </Card>
            </Link>
            <Link href={`${base}/customers`}>
              <Card className="h-full transition hover:border-primary/40">
                <CardContent className="p-4">
                  <div className="text-sm font-medium text-ink/70">Active customers</div>
                  <div className="text-2xl font-semibold">{customerStats.active.toLocaleString()}</div>
                </CardContent>
              </Card>
            </Link>
          </>
        )}
        {WIDGETS.map((w) => (
          <Card key={w.label} className="bg-card/60">
            <CardContent className="flex items-center justify-between p-4">
              <span className="text-sm font-medium text-ink/70">{w.label}</span>
              <Badge tone="inactive">Phase {w.phase}</Badge>
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
