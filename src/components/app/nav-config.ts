import type { Permission } from "@/server/authz/catalog";

export interface NavItem {
  key: string;
  label: string;
  /** Path below /o/[orgSlug]; "" is the Command Center. */
  path: string;
  icon: string;
  /** Visible only if the member holds at least one of these. */
  anyOf?: Permission[];
  /** Development phase in which the module ships. Items above CURRENT_PHASE render a "Coming soon" page. */
  phase: number;
  description: string;
}

export const CURRENT_PHASE = 1;

export const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Workspace",
    items: [
      { key: "command", label: "Command Center", path: "", icon: "LayoutDashboard", phase: 1, description: "Your business at a glance." },
      { key: "notifications", label: "Notifications", path: "notifications", icon: "Bell", phase: 1, description: "Assignments, mentions and alerts." },
      { key: "tasks", label: "Tasks & Activities", path: "tasks", icon: "CheckCircle2", anyOf: ["tasks.read"], phase: 3, description: "Follow-ups and to-dos across every record." },
    ],
  },
  {
    label: "Sales & Customers",
    items: [
      { key: "customers", label: "Customers & Contacts", path: "customers", icon: "Users", anyOf: ["customers.read", "customers.read_assigned"], phase: 2, description: "One profile for every customer relationship." },
      { key: "leads", label: "Leads & Pipelines", path: "leads", icon: "KanbanSquare", anyOf: ["leads.read", "leads.read_assigned"], phase: 3, description: "Track opportunities from inquiry to won." },
      { key: "inbox", label: "Unified Inbox", path: "inbox", icon: "Inbox", anyOf: ["conversations.read", "conversations.read_assigned"], phase: 8, description: "Email, WhatsApp, Instagram, Messenger and chat in one place." },
      { key: "orders", label: "Orders & Sales", path: "orders", icon: "ShoppingBag", anyOf: ["orders.read"], phase: 4, description: "Online and manual orders, payments and fulfillment." },
      { key: "products", label: "Products & Catalog", path: "products", icon: "Package", anyOf: ["products.read"], phase: 4, description: "Products, variants and pricing." },
    ],
  },
  {
    label: "Customer Support",
    items: [
      { key: "support", label: "Support Dashboard", path: "support", icon: "LifeBuoy", anyOf: ["tickets.read", "tickets.read_assigned"], phase: 5, description: "Ticket volume, SLAs and satisfaction." },
      { key: "tickets", label: "All Tickets", path: "support/tickets", icon: "Ticket", anyOf: ["tickets.read", "tickets.read_assigned"], phase: 5, description: "Every customer issue, routed and tracked." },
      { key: "support-inbox", label: "Support Inbox", path: "support/inbox", icon: "MessagesSquare", anyOf: ["tickets.read", "tickets.read_assigned"], phase: 8, description: "Support conversations across channels." },
      { key: "forms", label: "Ticket Forms & Fields", path: "support/forms", icon: "FileInput", anyOf: ["support.configure"], phase: 7, description: "Custom intake forms with conditional fields." },
      { key: "workflows", label: "Support Workflows", path: "support/workflows", icon: "Workflow", anyOf: ["support.configure"], phase: 7, description: "Routing, SLAs and escalation." },
      { key: "knowledge", label: "Knowledge Base", path: "support/knowledge", icon: "BookOpen", anyOf: ["tickets.read", "tickets.read_assigned", "knowledge.manage"], phase: 10, description: "Help articles for customers and agents." },
      { key: "support-reports", label: "Support Reports", path: "support/reports", icon: "BarChart3", anyOf: ["reports.read"], phase: 10, description: "Response times, SLA compliance and workload." },
    ],
  },
  {
    label: "Growth",
    items: [
      { key: "segments", label: "Customer Segments", path: "segments", icon: "Filter", anyOf: ["segments.manage", "campaigns.read"], phase: 9, description: "Dynamic audiences built from rules." },
      { key: "campaigns", label: "Campaigns", path: "campaigns", icon: "Megaphone", anyOf: ["campaigns.read"], phase: 9, description: "Consent-aware email and messaging campaigns." },
      { key: "automations", label: "Automations", path: "automations", icon: "Zap", anyOf: ["automations.read"], phase: 9, description: "Trigger → conditions → actions workflows." },
      { key: "analytics", label: "Analytics", path: "analytics", icon: "LineChart", anyOf: ["reports.read"], phase: 10, description: "Sales, customer, channel, support and marketing reports." },
    ],
  },
  {
    label: "Business",
    items: [
      { key: "integrations", label: "Integrations", path: "integrations", icon: "Plug", anyOf: ["integrations.read"], phase: 6, description: "Shopify, Stripe, email and messaging connections." },
      { key: "team", label: "Team & Permissions", path: "team", icon: "ShieldCheck", anyOf: ["members.read"], phase: 1, description: "Members, roles and teams." },
      { key: "settings", label: "Settings", path: "settings", icon: "Settings", phase: 1, description: "Organization, notifications and security." },
      { key: "billing", label: "Billing", path: "billing", icon: "CreditCard", anyOf: ["billing.manage"], phase: 11, description: "Plan, usage and invoices." },
    ],
  },
];

export function visibleNav(permissions: ReadonlySet<string>) {
  return NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => !i.anyOf || i.anyOf.some((p) => permissions.has(p))),
  })).filter((g) => g.items.length > 0);
}

export function findNavItemByPath(path: string): NavItem | undefined {
  return NAV_GROUPS.flatMap((g) => g.items).find((i) => i.path === path);
}
