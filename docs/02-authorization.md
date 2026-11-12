# Authorization

The source of truth is `src/server/authz/catalog.ts`. A unit test asserts that this document's matrix matches the code.

## Model

- **Permissions** are stable string keys (`domain.action`). The catalog in code is synced into the `permissions` table.
- **Roles** belong to an organization. On org creation, the nine system roles below are seeded with their default permissions. Owners and admins can create custom roles or edit non-Owner roles.
- **Memberships** link a user to an org with one role. Effective permissions = the role's permissions. Deactivated memberships have none.
- **Scopes:** some resources have `*.read` (all records) and `*.read_assigned` (only records where the member is owner or assignee). Assigning a record never grants broader access; the UI explains the restriction and links to role management.
- **Enforcement is server-side only.** The UI hides controls the member can't use, but every service call re-checks.
- The **Owner** role always holds every permission, can't be edited, and an org must always keep at least one active Owner.

## Guards

```ts
const ctx = await requireOrgContext(orgSlug)          // session + active membership, or 404
authorize(ctx, "customers.write")                      // throws ForbiddenError (403)
can(ctx, "orders.financials")                          // boolean, for shaping responses
canAccessRecord(ctx, "tickets", { assigneeId })        // read vs read_assigned
```

Non-members get **404, not 403**, so org slugs can't be enumerated.

## Permission catalog

| Key | Meaning |
|---|---|
| `org.settings.manage` | Edit organization profile and settings |
| `members.read` | View team members |
| `members.manage` | Invite, remove, deactivate, change roles |
| `roles.manage` | Create and edit roles and permissions |
| `teams.manage` | Create teams and assign members |
| `audit.read` | View audit logs |
| `billing.manage` | Subscription and invoices |
| `customers.read` / `customers.read_assigned` | View customers |
| `customers.write` | Create and edit customers |
| `customers.archive` | Archive and restore |
| `customers.merge` | Merge and unmerge |
| `customers.import` / `customers.export` | Bulk data movement |
| `leads.read` / `leads.read_assigned` | View leads |
| `leads.write` | Create, edit and move leads |
| `pipelines.manage` | Configure pipelines and stages |
| `conversations.read` / `conversations.read_assigned` | View inbox |
| `conversations.reply` | Send messages |
| `conversations.assign` | Assign conversations |
| `orders.read` | View orders |
| `orders.write` | Create and edit orders, manage fulfillment |
| `orders.financials` | See payment and refund details and totals |
| `payments.record` | Record manual payments |
| `refunds.issue` | Issue refunds |
| `products.read` / `products.write` | Catalog |
| `tickets.read` / `tickets.read_assigned` | View tickets |
| `tickets.write` | Create, reply, change status |
| `tickets.assign` | Assign and reassign |
| `support.configure` | Forms, statuses, SLA, routing, portal |
| `knowledge.manage` | Write and publish articles |
| `tasks.read` / `tasks.write` | Tasks |
| `segments.manage` | Build segments |
| `campaigns.read` / `campaigns.manage` / `campaigns.send` | Marketing |
| `automations.read` / `automations.manage` | Workflows |
| `reports.read` / `reports.export` | Analytics |
| `integrations.read` / `integrations.manage` | Connections |

## Default role matrix

R = read, RA = read assigned only, W = write, ✓ = granted

| Area | Owner | Admin | Sales Mgr | Sales Rep | Support Mgr | Support Agent | Marketing | Analyst | Read-only |
|---|---|---|---|---|---|---|---|---|---|
| Org settings | ✓ | ✓ | | | | | | | |
| Members read | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Members/roles/teams manage | ✓ | ✓ | | | | | | | |
| Audit read | ✓ | ✓ | | | | | | | |
| Billing | ✓ | | | | | | | | |
| Customers | R W archive merge import export | same | R W export | R W | R W | R | R | R | R |
| Leads | R W | R W | R W | RA W | | | R | R | R |
| Pipelines manage | ✓ | ✓ | ✓ | | | | | | |
| Conversations | R reply assign | same | R reply assign | RA reply | R reply assign | RA reply | | | R |
| Orders | R W fin pay refund | same | R W fin pay | R W | R fin | R | | R fin | R |
| Products | R W | R W | R W | R | R | R | R | R | R |
| Tickets | R W assign | same | | | R W assign | RA W | | R | R |
| Support configure / KB | ✓ | ✓ | | | ✓ | | | | |
| Tasks | R W | R W | R W | R W | R W | R W | R W | R | R |
| Segments / campaigns | ✓ | ✓ | | | | | manage send | R | |
| Automations | R manage | same | R | | R | | R manage | R | |
| Reports | R export | same | R export | R | R export | R | R | R export | R |
| Integrations | R manage | same | | | | | | | |

Support agents cannot issue refunds (`refunds.issue` is Owner, Admin only by default).
