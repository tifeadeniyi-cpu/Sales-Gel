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
  /** Shown instead of the number when a module ships between phases (e.g. "8b"). */
  phaseLabel?: string;
  description: string;
}

export const CURRENT_PHASE = 8;

/** Primary navigation follows the SalesGel brief; secondary tools live under "More". */
export const NAV_GROUPS: { label: string; collapsible?: boolean; items: NavItem[] }[] = [
  {
    label: "",
    items: [
      { key: "command", label: "Dashboard", path: "", icon: "LayoutDashboard", phase: 1, description: "Your business at a glance." },
      { key: "inbox", label: "Inbox", path: "inbox", icon: "Inbox", anyOf: ["conversations.read", "conversations.read_assigned"], phase: 8, description: "Email, WhatsApp, Instagram, Messenger, SMS and website chat in one place." },
      { key: "customers", label: "Contacts", path: "customers", icon: "Users", anyOf: ["customers.read", "customers.read_assigned"], phase: 2, description: "One profile for every customer relationship." },
      { key: "leads", label: "Leads", path: "leads", icon: "Filter", anyOf: ["leads.read", "leads.read_assigned"], phase: 3, description: "Every opportunity in one list." },
      { key: "deals", label: "Deals", path: "deals", icon: "KanbanSquare", anyOf: ["leads.read", "leads.read_assigned"], phase: 3, description: "Your pipeline from first inquiry to won." },
      { key: "orders", label: "Orders", path: "orders", icon: "ShoppingBag", anyOf: ["orders.read"], phase: 4, description: "Online and manual orders, payments and fulfillment." },
      { key: "tickets", label: "Tickets", path: "support/tickets", icon: "Ticket", anyOf: ["tickets.read", "tickets.read_assigned"], phase: 5, description: "Every customer issue, tracked to resolution." },
      { key: "marketing", label: "Marketing", path: "marketing", icon: "Megaphone", anyOf: ["campaigns.read"], phase: 9, description: "Segments and consent-aware campaigns." },
      { key: "email", label: "Email", path: "inbox?channel=email", icon: "Mail", anyOf: ["conversations.read", "conversations.read_assigned"], phase: 8, description: "Customer email in the shared inbox." },
      { key: "phone", label: "Phone & Messaging", path: "phone", icon: "Phone", anyOf: ["conversations.read", "conversations.read_assigned"], phase: 8.5, phaseLabel: "8b", description: "Calls, voicemail and SMS through Twilio — built right after the Inbox." },
      { key: "knowledge", label: "Knowledge Base", path: "support/knowledge", icon: "BookOpen", anyOf: ["tickets.read", "tickets.read_assigned", "knowledge.manage"], phase: 10, description: "Help articles for customers and agents." },
      { key: "automations", label: "Automations", path: "automations", icon: "Zap", anyOf: ["automations.read"], phase: 9, description: "Trigger → conditions → actions workflows." },
      { key: "analytics", label: "Reports & Insights", path: "analytics", icon: "LineChart", anyOf: ["reports.read"], phase: 10, description: "Sales, customer, channel, support and marketing reports." },
      { key: "settings", label: "Settings", path: "settings", icon: "Settings", phase: 1, description: "Organization, notifications and security." },
    ],
  },
  {
    label: "More",
    collapsible: true,
    items: [
      { key: "tasks", label: "Tasks & Follow-ups", path: "tasks", icon: "CheckCircle2", anyOf: ["tasks.read"], phase: 3, description: "Follow-ups and to-dos across every record." },
      { key: "products", label: "Products & Catalog", path: "products", icon: "Package", anyOf: ["products.read"], phase: 4, description: "Products, variants and pricing." },
      { key: "support", label: "Support Dashboard", path: "support", icon: "LifeBuoy", anyOf: ["tickets.read", "tickets.read_assigned"], phase: 5, description: "Ticket workload and response times." },
      { key: "notifications", label: "Notifications", path: "notifications", icon: "Bell", phase: 1, description: "Assignments, mentions and alerts." },
      { key: "team", label: "Team & Permissions", path: "team", icon: "ShieldCheck", anyOf: ["members.read"], phase: 1, description: "Members, roles and teams." },
      { key: "integrations", label: "Apps & Integrations", path: "integrations", icon: "Plug", anyOf: ["integrations.read"], phase: 6, description: "Shopify, Stripe, email and messaging connections." },
      { key: "support-inbox", label: "Support Inbox", path: "inbox?view=unassigned", icon: "MessagesSquare", anyOf: ["tickets.read", "tickets.read_assigned"], phase: 8, description: "Support conversations across channels." },
      { key: "forms", label: "Ticket Forms & Portal", path: "settings/support/forms", icon: "FileInput", anyOf: ["support.configure"], phase: 7, description: "Intake forms and the customer support portal." },
      { key: "workflows", label: "SLAs & Routing", path: "settings/support/sla", icon: "Workflow", anyOf: ["support.configure"], phase: 7, description: "Routing, SLAs and escalation." },
      { key: "segments", label: "Customer Segments", path: "segments", icon: "Filter", anyOf: ["segments.manage", "campaigns.read"], phase: 9, description: "Dynamic audiences built from rules." },
      { key: "campaigns", label: "Campaigns", path: "campaigns", icon: "Megaphone", anyOf: ["campaigns.read"], phase: 9, description: "Consent-aware email and messaging campaigns." },
      { key: "support-reports", label: "Support Reports", path: "support/reports", icon: "BarChart3", anyOf: ["reports.read"], phase: 10, description: "Response times, SLA compliance and workload." },
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
