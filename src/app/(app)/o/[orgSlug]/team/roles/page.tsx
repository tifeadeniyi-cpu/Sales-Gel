import { forbidden } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { listRoles } from "@/domains/identity/service";
import { ALL_PERMISSIONS, PERMISSIONS, permissionDomain } from "@/server/authz/catalog";
import { requireOrgContext } from "@/server/authz/request";
import { can } from "@/server/authz/guards";
import { TeamTabs } from "../team-tabs";
import { DeleteRoleButton, RoleEditorDialog } from "./role-editor";

export default async function RolesPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const ctx = await requireOrgContext(orgSlug);
  if (!can(ctx, "members.read")) forbidden();
  const manage = can(ctx, "roles.manage");
  const roles = await listRoles(ctx);
  const permissionOptions = ALL_PERMISSIONS.map((key) => ({ key, description: PERMISSIONS[key], domain: permissionDomain(key) }));

  return (
    <>
      <PageHeader
        title="Team & Permissions"
        description="Roles bundle permissions. Assigning a record to someone never grants access beyond their role."
        actions={manage && <RoleEditorDialog orgSlug={orgSlug} permissions={permissionOptions} />}
      />
      <TeamTabs orgSlug={orgSlug} active="roles" />
      <Card className="mt-6">
        <Table>
          <THead><TR><TH>Role</TH><TH>Permissions</TH><TH>Members</TH><TH className="text-right">Actions</TH></TR></THead>
          <TBody>
            {roles.map((r) => {
              const isOwner = r.key === "owner";
              return (
                <TR key={r.id}>
                  <TD>
                    <div className="flex items-center gap-2 font-medium">
                      {r.name}
                      {r.isSystem ? <Badge tone="neutral">System</Badge> : <Badge tone="brand">Custom</Badge>}
                    </div>
                    {r.description && <div className="text-xs text-muted-foreground">{r.description}</div>}
                  </TD>
                  <TD className="text-sm">{isOwner ? "All permissions" : `${r.permissions.length} of ${ALL_PERMISSIONS.length}`}</TD>
                  <TD className="text-sm">{r.memberCount}</TD>
                  <TD>
                    <div className="flex justify-end gap-1">
                      <RoleEditorDialog
                        orgSlug={orgSlug}
                        permissions={permissionOptions}
                        role={{ id: r.id, name: r.name, description: r.description, permissions: isOwner ? ALL_PERMISSIONS : r.permissions, isSystem: r.isSystem }}
                        readOnly={!manage || isOwner}
                      />
                      {manage && !r.isSystem && <DeleteRoleButton orgSlug={orgSlug} roleId={r.id} name={r.name} />}
                    </div>
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      </Card>
    </>
  );
}
