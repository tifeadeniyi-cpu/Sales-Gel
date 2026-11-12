const LABELS: Record<string, string> = {
  "organization.created": "created the workspace",
  "organization.updated": "updated organization settings",
  "member.role_changed": "changed a member's role",
  "member.deactivated": "deactivated a member",
  "member.reactivated": "reactivated a member",
  "member.removed": "removed a member",
  "invitation.created": "sent an invitation",
  "invitation.revoked": "revoked an invitation",
  "invitation.accepted": "accepted an invitation",
  "role.created": "created a role",
  "role.updated": "updated a role",
  "role.deleted": "deleted a role",
  "team.created": "created a team",
  "team.deleted": "deleted a team",
  "team.members_changed": "changed team members",
};

export function describeAudit(action: string): string {
  return LABELS[action] ?? action.replace(/[._]/g, " ");
}
