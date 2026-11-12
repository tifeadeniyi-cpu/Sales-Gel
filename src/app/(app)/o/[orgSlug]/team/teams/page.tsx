import { forbidden } from "next/navigation";
import { Users } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { listMembers, listTeams } from "@/domains/identity/service";
import { requireOrgContext } from "@/server/authz/request";
import { can } from "@/server/authz/guards";
import { TeamTabs } from "../team-tabs";
import { CreateTeamForm, TeamCard } from "./teams-client";

export default async function TeamsPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const ctx = await requireOrgContext(orgSlug);
  if (!can(ctx, "members.read")) forbidden();
  const manage = can(ctx, "teams.manage");
  const [teams, members] = await Promise.all([listTeams(ctx), listMembers(ctx)]);
  const active = members.filter((m) => m.status === "active").map((m) => ({ membershipId: m.membershipId, name: m.name, email: m.email }));

  return (
    <>
      <PageHeader title="Team & Permissions" description="Group members into teams for routing tickets and conversations (used from Phase 5)." />
      <TeamTabs orgSlug={orgSlug} active="teams" />
      {manage && (
        <Card className="mt-6">
          <CardHeader><CardTitle>New team</CardTitle></CardHeader>
          <CardContent><CreateTeamForm orgSlug={orgSlug} /></CardContent>
        </Card>
      )}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {teams.length === 0 ? (
          <div className="lg:col-span-2">
            <EmptyState icon={<Users className="size-8" />} title="No teams yet" description="Teams like Sales or Customer Care make assignment and routing easier." />
          </div>
        ) : (
          teams.map((t) => <TeamCard key={t.id} orgSlug={orgSlug} team={t} members={active} manage={manage} />)
        )}
      </div>
    </>
  );
}
