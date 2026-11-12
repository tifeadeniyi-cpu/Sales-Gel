import { PageHeader } from "@/components/app/page-header";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { listInvitations, listMembers, listRoles } from "@/domains/identity/service";
import { requireOrgContext } from "@/server/authz/request";
import { can } from "@/server/authz/guards";
import { formatDateTime, formatRelative } from "@/lib/utils";
import { InviteDialog } from "./invite-dialog";
import { MemberMenu, RevokeInvitationButton, RoleSelect } from "./member-controls";
import { TeamTabs } from "./team-tabs";
import { forbidden } from "next/navigation";

export default async function TeamPage({ params, searchParams }: { params: Promise<{ orgSlug: string }>; searchParams: Promise<{ invite?: string }> }) {
  const { orgSlug } = await params;
  const ctx = await requireOrgContext(orgSlug);
  if (!can(ctx, "members.read")) forbidden();
  const manage = can(ctx, "members.manage");
  const [members, invites, roles] = await Promise.all([listMembers(ctx), listInvitations(ctx), listRoles(ctx)]);
  // Non-owners can't grant the Owner role; hide it from their pickers (server enforces too).
  const assignable = roles.filter((r) => ctx.roleKey === "owner" || r.key !== "owner").map((r) => ({ id: r.id, name: r.name, key: r.key }));
  const emailConnected = Boolean(process.env.EMAIL_PROVIDER && process.env.EMAIL_API_KEY);

  return (
    <>
      <PageHeader
        title="Team & Permissions"
        description="Invite people, choose what they can access, and organize them into teams."
        actions={manage && <InviteDialog orgSlug={orgSlug} roles={assignable} defaultOpen={(await searchParams).invite === "1"} emailConnected={emailConnected} />}
      />
      <TeamTabs orgSlug={orgSlug} active="members" />

      <Card className="mt-6">
        <Table>
          <THead>
            <TR>
              <TH>Member</TH>
              <TH>Role</TH>
              <TH>Teams</TH>
              <TH>Status</TH>
              <TH>Joined</TH>
              {manage && <TH className="text-right">Actions</TH>}
            </TR>
          </THead>
          <TBody>
            {members.map((m) => {
              const isSelf = m.userId === ctx.userId;
              const ownerLocked = m.roleKey === "owner" && ctx.roleKey !== "owner";
              return (
                <TR key={m.membershipId} className={m.status === "deactivated" ? "opacity-60" : undefined}>
                  <TD>
                    <div className="flex items-center gap-3">
                      <Avatar name={m.name} src={m.image} />
                      <div>
                        <div className="font-medium">{m.name}{isSelf && <span className="ml-1 text-xs text-muted-foreground">(you)</span>}</div>
                        <div className="text-xs text-muted-foreground">{m.email}</div>
                      </div>
                    </div>
                  </TD>
                  <TD>
                    {manage && !ownerLocked ? (
                      <RoleSelect orgSlug={orgSlug} membershipId={m.membershipId} roleId={m.roleId} roles={assignable} label={`Role for ${m.name}`} />
                    ) : (
                      <Badge tone={m.roleKey === "owner" ? "highlight" : "brand"}>{m.roleName}</Badge>
                    )}
                  </TD>
                  <TD className="text-sm text-muted-foreground">{m.teams.map((t) => t.name).join(", ") || "—"}</TD>
                  <TD>
                    <Badge tone={m.status === "active" ? "success" : "inactive"}>{m.status === "active" ? "Active" : "Deactivated"}</Badge>
                  </TD>
                  <TD className="text-sm text-muted-foreground" title={formatDateTime(m.joinedAt, ctx.timezone)}>{formatRelative(m.joinedAt)}</TD>
                  {manage && (
                    <TD>
                      {!ownerLocked && <MemberMenu orgSlug={orgSlug} membershipId={m.membershipId} name={m.name} status={m.status} isSelf={isSelf} />}
                    </TD>
                  )}
                </TR>
              );
            })}
          </TBody>
        </Table>
      </Card>

      {invites.length > 0 && (
        <Card className="mt-6">
          <CardHeader><CardTitle>Pending invitations</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <THead><TR><TH>Email</TH><TH>Role</TH><TH>Expires</TH>{manage && <TH className="text-right">Actions</TH>}</TR></THead>
              <TBody>
                {invites.map((i) => (
                  <TR key={i.id}>
                    <TD>{i.email}</TD>
                    <TD><Badge tone="brand">{i.roleName}</Badge></TD>
                    <TD className="text-sm text-muted-foreground">
                      {i.expired ? <Badge tone="warning">Expired</Badge> : formatRelative(i.expiresAt)}
                    </TD>
                    {manage && <TD className="text-right"><RevokeInvitationButton orgSlug={orgSlug} invitationId={i.id} email={i.email} /></TD>}
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </>
  );
}
