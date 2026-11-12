/**
 * Permission catalog and default role templates.
 * Source of truth for docs/02-authorization.md (kept in sync by tests/unit/authz-catalog.test.ts).
 */

export const PERMISSIONS = {
  "org.settings.manage": "Edit organization profile and settings",
  "members.read": "View team members",
  "members.manage": "Invite, remove, deactivate members and change roles",
  "roles.manage": "Create and edit roles and permissions",
  "teams.manage": "Create teams and assign members",
  "audit.read": "View audit logs",
  "billing.manage": "Manage subscription and invoices",
  "customers.read": "View all customers",
  "customers.read_assigned": "View customers assigned to you",
  "customers.write": "Create and edit customers",
  "customers.archive": "Archive and restore customers",
  "customers.merge": "Merge and unmerge customers",
  "customers.import": "Import customers",
  "customers.export": "Export customers",
  "leads.read": "View all leads",
  "leads.read_assigned": "View leads assigned to you",
  "leads.write": "Create, edit and move leads",
  "pipelines.manage": "Configure pipelines and stages",
  "conversations.read": "View all conversations",
  "conversations.read_assigned": "View conversations assigned to you",
  "conversations.reply": "Send messages to customers",
  "conversations.assign": "Assign conversations",
  "orders.read": "View orders",
  "orders.write": "Create and edit orders, manage fulfillment",
  "orders.financials": "View payment, refund and total details",
  "payments.record": "Record manual payments",
  "refunds.issue": "Issue refunds",
  "products.read": "View catalog",
  "products.write": "Edit catalog",
  "tickets.read": "View all tickets",
  "tickets.read_assigned": "View tickets assigned to you",
  "tickets.write": "Create tickets, reply and change status",
  "tickets.assign": "Assign and reassign tickets",
  "support.configure": "Configure forms, statuses, SLA, routing and portal",
  "knowledge.manage": "Write and publish knowledge articles",
  "tasks.read": "View tasks",
  "tasks.write": "Create and edit tasks",
  "segments.manage": "Build customer segments",
  "campaigns.read": "View campaigns",
  "campaigns.manage": "Create and edit campaigns",
  "campaigns.send": "Launch campaigns",
  "automations.read": "View automations",
  "automations.manage": "Create and edit automations",
  "reports.read": "View analytics",
  "reports.export": "Export analytics",
  "integrations.read": "View integrations",
  "integrations.manage": "Connect and configure integrations",
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export function permissionDomain(key: Permission): string {
  return key.split(".")[0];
}

export function isPermission(value: string): value is Permission {
  return value in PERMISSIONS;
}

const readAll: Permission[] = [
  "members.read",
  "customers.read",
  "leads.read",
  "conversations.read",
  "orders.read",
  "products.read",
  "tickets.read",
  "tasks.read",
  "reports.read",
];

export type SystemRoleKey =
  | "owner"
  | "admin"
  | "sales_manager"
  | "sales_rep"
  | "support_manager"
  | "support_agent"
  | "marketing"
  | "analyst"
  | "read_only";

export const SYSTEM_ROLES: Record<SystemRoleKey, { name: string; description: string; permissions: Permission[] }> = {
  owner: {
    name: "Owner",
    description: "Full access, including billing. Cannot be edited.",
    permissions: ALL_PERMISSIONS,
  },
  admin: {
    name: "Admin",
    description: "Full access except billing.",
    permissions: ALL_PERMISSIONS.filter((p) => p !== "billing.manage"),
  },
  sales_manager: {
    name: "Sales Manager",
    description: "Runs the sales team, pipelines and orders.",
    permissions: [
      "members.read",
      "customers.read", "customers.write", "customers.export",
      "leads.read", "leads.write", "pipelines.manage",
      "conversations.read", "conversations.reply", "conversations.assign",
      "orders.read", "orders.write", "orders.financials", "payments.record",
      "products.read", "products.write",
      "tasks.read", "tasks.write",
      "automations.read",
      "reports.read", "reports.export",
    ],
  },
  sales_rep: {
    name: "Sales Representative",
    description: "Works assigned leads and conversations.",
    permissions: [
      "members.read",
      "customers.read", "customers.write",
      "leads.read_assigned", "leads.write",
      "conversations.read_assigned", "conversations.reply",
      "orders.read", "orders.write",
      "products.read",
      "tasks.read", "tasks.write",
      "reports.read",
    ],
  },
  support_manager: {
    name: "Support Manager",
    description: "Runs the helpdesk and its configuration.",
    permissions: [
      "members.read",
      "customers.read", "customers.write",
      "conversations.read", "conversations.reply", "conversations.assign",
      "orders.read", "orders.financials",
      "products.read",
      "tickets.read", "tickets.write", "tickets.assign",
      "support.configure", "knowledge.manage",
      "tasks.read", "tasks.write",
      "automations.read",
      "reports.read", "reports.export",
    ],
  },
  support_agent: {
    name: "Support Agent",
    description: "Works assigned tickets and conversations. Cannot issue refunds.",
    permissions: [
      "members.read",
      "customers.read",
      "conversations.read_assigned", "conversations.reply",
      "orders.read",
      "products.read",
      "tickets.read_assigned", "tickets.write",
      "tasks.read", "tasks.write",
      "reports.read",
    ],
  },
  marketing: {
    name: "Marketing User",
    description: "Segments, campaigns and marketing automations.",
    permissions: [
      "members.read",
      "customers.read",
      "leads.read",
      "products.read",
      "tasks.read", "tasks.write",
      "segments.manage", "campaigns.read", "campaigns.manage", "campaigns.send",
      "automations.read", "automations.manage",
      "reports.read",
    ],
  },
  analyst: {
    name: "Analyst",
    description: "Read access to business data and reports.",
    permissions: [...readAll, "orders.financials", "campaigns.read", "automations.read", "reports.export"],
  },
  read_only: {
    name: "Read-Only User",
    description: "View-only access.",
    permissions: readAll,
  },
};
