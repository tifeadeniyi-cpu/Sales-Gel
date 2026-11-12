# Route Inventory & Common UI Components

## Routes

Every workspace route is under `/o/[orgSlug]`. Records open in a drawer through query state (`?open=cus_…`) so filters and scroll position survive. Each record also has a full-page route for the expand action and deep links.

| Path | Module | Phase |
|---|---|---|
| `/sign-in`, `/sign-up` | Auth | 1 |
| `/invite/[token]` | Accept invitation | 1 |
| `/onboarding` | Create first organization | 1 |
| `/o` | Org picker / redirect to last org | 1 |
| `/o/[org]` | Command Center | 1 (shell) → 10 (widgets) |
| `/o/[org]/notifications` | Notifications | 1 |
| `/o/[org]/tasks` | Tasks & Activities | 3 |
| `/o/[org]/customers`, `/customers/[id]` | Customers | 2 |
| `/o/[org]/leads`, `/leads/[id]`, `/leads/settings` | Leads & Pipelines | 3 |
| `/o/[org]/inbox` | Unified Inbox | 8 |
| `/o/[org]/orders`, `/orders/new`, `/orders/[id]` | Orders | 4 |
| `/o/[org]/products`, `/products/[id]` | Catalog | 4 |
| `/o/[org]/support`, `/support/tickets`, `/support/tickets/[id]` | Support | 5 |
| `/o/[org]/support/inbox`, `/support/forms`, `/support/workflows`, `/support/knowledge`, `/support/reports` | Support | 7–10 |
| `/o/[org]/segments`, `/campaigns`, `/automations`, `/analytics` | Growth | 9–10 |
| `/o/[org]/integrations` | Integrations | 6 |
| `/o/[org]/team` | Team & Permissions | 1 |
| `/o/[org]/settings/*` | Settings hub (general, security/audit, notifications…) | 1+ |
| `/o/[org]/billing` | Billing | 11 |
| `/portal/[portalSlug]/*` | Public support portal | 7 |
| `/f/[formId]` | Hosted ticket form | 7 |
| `/api/auth/[...all]` | Better Auth | 1 |
| `/api/v1/*` | External API (API keys, org-scoped) | 2+ |
| `/api/webhooks/[provider]` | Verified inbound webhooks | 6 |

Modules that aren't built yet appear in the sidebar with a "Coming in Phase N" state. They are never a fake working screen.

## Common components (`src/components`)

**Primitives (`ui/`, shadcn conventions on Radix):** Button, Input, Textarea, Label, Select, Checkbox, Switch, Badge, Avatar, Card, Dialog, Sheet (drawer), DropdownMenu, Popover, Tooltip, Tabs, Separator, Skeleton, Toast (sonner), Table, Command (search palette).

**Composites (`app/`):**

| Component | Purpose |
|---|---|
| `AppShell`, `Sidebar`, `Topbar`, `OrgSwitcher` | Global layout and navigation with permission- and entitlement-aware items |
| `PageHeader` | Title, description, primary actions |
| `DataTable` | Search, sort, filter, select, bulk actions, column config, pagination, export hook; URL-driven state |
| `InlineEdit` field family | Text, number, currency, date, select, multi-select, member, status, tags; saving/saved/error states and rollback |
| `RecordDrawer` | Sheet with expand, close, prev/next and copy-link controls |
| `FormField`, `useUnsavedChanges` | Labels, required markers, inline Zod errors, unsaved-change guard |
| `ConfirmDialog` | Destructive confirmation, with optional type-to-confirm |
| `EmptyState`, `ErrorState`, `ComingSoon` | Consistent empty and error UI |
| `StatusBadge` | Icon + label + color, so status never relies on color alone |
| `MoneyDisplay` | Currency-aware formatting from minor units |
| `FileDropzone` | Phase 2+, with presigned upload, progress and type/size validation |
| `NotificationBell` | Unread count and dropdown |
