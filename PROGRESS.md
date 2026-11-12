# Progress & Phase Status

_Last updated: 2026-11-12 (Phase 3)_

| Phase | Scope | Status |
|---|---|---|
| 0 | Planning docs (architecture, schema, authz, routes, components, deps, tests, external APIs) | ✅ Done (`docs/`) |
| **1** | **Foundation** | ✅ **Implemented and verified** |
| **2** | **Customers** | ✅ **Implemented and verified** |
| **3** | **Sales CRM + Tasks** | ✅ **Implemented and verified** |
| **4** | **Commerce** | ✅ **Implemented and verified** |
| **5** | **Support core** | ✅ **Implemented and verified** |
| — | **SalesGel rebrand + landing dashboard** (requested brief) | ✅ **Implemented and verified** |
| 6 | Commerce integrations (Shopify, payments, job infrastructure) | ⏳ Next |
| 7 | Support forms, portal, SLA, routing | Not started |
| 8 | Unified inbox | Not started |
| 9 | Marketing & automation | Not started |
| 10 | Analytics, knowledge base | Not started |
| 11 | Billing & production hardening | Not started |
| 8b | Phone & Calls (Twilio): see `docs/06-phone-system-plan.md` | Planned: confirmed to run right after Phase 8 |

---

## Phase 1 completion report

### Implemented and verified

| Area | What exists | Verified by |
|---|---|---|
| Repository & tooling | Next.js 16.4, React 19.3, TS 5.9 strict, Tailwind 4, Drizzle, Vitest, Playwright, ESLint, GitHub Actions CI | lint, typecheck, build all clean |
| Database & migrations | 17 tables; migrations `0000_identity_platform`, `0001_tenant_rls`; migrate script bootstraps the non-superuser runtime role and syncs the permission catalog | `drizzle-kit check`; fresh migrate on every test run |
| Tenant isolation (3 layers) | Service filters + composite FKs `(organization_id, id)` + forced Postgres RLS under a `crm_app` role without BYPASSRLS | Integration: cross-tenant reads return nothing even without a filter; cross-tenant writes rejected; composite FK rejects cross-org references with RLS bypassed; E2E: a non-member gets 404 on another org's URL |
| Authentication | Better Auth (email + password, 10-char minimum, rate limits in production), secure cookies, sign-in/up/out, safe `next` redirects (no open redirect), optimistic `proxy.ts` gate | E2E sign-up, sign-in, sign-out, unauthenticated redirect |
| Organizations | Create (onboarding), update settings (name, type, timezone, currency, address), org switcher, last-org redirect, globally unique slug with friendly error | Integration + E2E (create, edit, persist after reload, validation failure leaves data unchanged) |
| Memberships & invitations | Invite by email + role → single-use token (only a SHA-256 hash stored, 7-day expiry, bound to the invited email), revoke, re-invite revokes old token, accept (locked against double-accept), deactivate/reactivate, remove, leave | Integration + E2E (full invite → sign-up → accept flow; reused link rejected; wrong email refused) |
| Authorization | 47-permission catalog, 9 seeded system roles, custom roles, `authorize()`/`can()`/`canReadRecord()` (read vs read_assigned), all enforced server-side. Owner protections: an org can never lose its last active Owner; only Owners can grant Owner or billing | Unit (catalog ↔ docs matrix, support agents can't refund/export) + integration (each guard) + E2E (rep sees read-only settings, forbidden audit page, hidden admin nav) |
| Teams | Create, delete, set members (cross-org member ids rejected) | Integration + E2E |
| Audit infrastructure | `audit()` writes in the same transaction as the change, with field diffs, IP and user agent. Append-only (app role has no UPDATE/DELETE). Audit log UI with pagination | Integration (UPDATE/DELETE denied) + E2E (settings change appears) |
| Notifications foundation | `notify()` respects per-user preferences; list, unread count, mark one/all read (only your own); preferences page; bell and sidebar counts | Integration + E2E (owner notified when rep joins) |
| Transactional outbox | `outbox_events` written alongside changes; relay arrives with the job infrastructure in Phase 6 | Rows written in integration tests |
| App shell & design system | Brand palette tokens, collapsible sidebar with grouped modules and active indicator, mobile nav sheet, top bar (quick create, notifications, help, account), shadcn-style primitives, form field with accessible errors, confirm dialog with type-to-confirm, inline role editor with saving state and rollback, unsaved-change warning | E2E (desktop + 390px mobile) |
| Honest placeholders | Modules from later phases show "Scheduled for Phase N" with no fake data. Global search is visibly disabled until Phase 2 | E2E |

**Test totals:** 47 unit/integration tests (real Postgres, RLS active) and 11 end-to-end tests (production build). All passing.

### Implemented but not fully tested
- Auth rate limiting is enabled only in production (`AUTH_RATE_LIMIT=1` turns it on elsewhere); there's no automated test for it yet.
- `beforeunload` unsaved-changes warning (browser-native dialog; not asserted in E2E).

### Blocked by credentials or external setup
- **Transactional email** (invites, email notifications, email verification): needs a provider (Resend, Postmark or SES) plus a verified domain. Until then the UI clearly says email isn't connected and shows a copyable invite link; email preference toggles are disabled.
- **GitHub repository:** the code is committed locally and will be pushed once the repo exists.

### Not yet implemented (by design, later phases)
- MFA (Better Auth two-factor plugin, Phase 11), session management UI, data export and retention controls (Phase 11).
- Sentry (env-flagged, Phase 11). Structured logging (pino) is in place.
- Outbox relay and workers (Phase 6).
- Org logo upload (needs object storage, Phase 2).

### Known limitations
- The `user` table is global (Better Auth). The app role can read it, but services only expose users through memberships of the caller's org.
- Workspace URL (slug) can't be changed after creation (so links stay stable).
- shadcn components were hand-vendored because the shadcn registry was unreachable from the build sandbox. `components.json` is present for future `shadcn add`.

---

## Phase 2 completion report: Customers & Contacts

### Implemented and verified

| Area | What exists | Verified by |
|---|---|---|
| Data model | 12 tables (customers, emails, phones, social identities, addresses, tags, customer_tags, consents, notes, merges, duplicate dismissals, custom field definitions), all with composite tenant FKs and forced RLS. Trigram indexes for search. Per-org customer numbers (CUS-1001…). Owner FK nulls only the owner column when a member is removed | Migrations 0002–0004; `drizzle-kit check`; cross-tenant integration tests |
| Create / edit | Multi-email/phone/handle/address form; provisional contacts from just a social handle; business vs person; required-field and type rules; display name derived automatically; live "possible duplicate" warning while typing | Integration + E2E (empty record refused with explanation) |
| Customer list | Search across name, company, email, phone digits, @handle and CUS-number; views (Active / Provisional / Archived / All); filters (owner, tag, source, type, marketing status); 6 sorts; pagination; list and card layouts; multi-select bulk assign / tag / untag / archive / restore; inline source and owner editing | Integration + E2E |
| Record drawer | Opens from the list via `?open=` and keeps search, filters and scroll position; prev/next (also `j`/`k`), copy link, expand to full page; deep links reopen it | E2E |
| Customer detail | Overview, Timeline, Notes tabs, plus clearly labelled tabs for modules arriving later. Inline editing with saving state, rollback and server error messages; tag editor; consent panel; merge history with undo | E2E (edits persist after reload) |
| Notes | Add, pin, author-only edit, author-or-manager delete; all on the timeline | Integration + E2E |
| Marketing consent | Append-only consent history (app role can't update or delete it); email marketing status mirrors the latest entry | Integration (UPDATE/DELETE denied) |
| Duplicates & merge (Scenario 5) | Suggestions from exact normalized email, E.164 phone or platform+handle; never auto-merged; "not a duplicate" dismissal. Merge moves identifiers (without duplicating shared values), addresses, notes, consents and tags; fills only empty fields; the most restrictive marketing consent wins; full snapshot kept for **undo merge**; chained merges must be undone in order; merged records are read-only and point to the survivor. Mover registry ready for leads, orders, tickets and tasks | Integration + E2E (merge then undo via UI) |
| Import | CSV up to 5,000 rows / 5 MB, drag-and-drop, automatic column mapping (including custom fields), duplicate handling (skip / fill missing details / create), per-row error report; every row commits independently | Integration + E2E |
| Export | Filter-aware CSV (up to 50,000 rows), spreadsheet formula-injection protection, audit-logged, permission-gated | Integration + E2E (download contents checked; another org gets 404) |
| Custom fields | Text, number, date, dropdown, yes/no; required flag; key and type immutable; archive keeps stored values; validated on every write | Integration + E2E |
| Tags | Created on the fly (case-insensitive, no duplicates) or in settings; colors; usage counts; delete | Integration |
| Permissions | `read` vs `read_assigned` enforced in every query (assigned-only users get 404 for others' customers and own what they create); write, archive, merge, import and export each gated | Integration |
| Global search | Top bar search → results page (customers today; other modules plug in later) | E2E |
| Command Center | Real "New customers (30 days)" and "Active customers" widgets | Build + render |
| Notifications | `customer.assigned` when someone is made owner (single or bulk) | Integration |

**Test totals:** 71 unit/integration tests and 19 end-to-end tests (11 Phase 1 + 8 Phase 2). All passing.

### Implemented but not fully tested
- Keyboard shortcuts in the drawer (`j`/`k`) and the browser "unsaved changes" warning.
- Imports run inside the web request. That's fine at 5,000 rows, but larger files should move to background jobs (Phase 6).

### Blocked by credentials or external setup
- Org logo and customer file attachments need S3-compatible storage credentials (Files tab is labelled as arriving later).
- Email sending (unchanged from Phase 1).

### Not yet implemented
- Lifetime spend, order count, AOV and last purchase on the overview: they need Orders (Phase 4) and are shown as Phase 4 placeholders, not fake numbers.
- Saved views and column configuration on the list (shared DataTable work planned with Leads in Phase 3).
- Customer portal identity and external-platform identity sync (Phases 6–8).

---

## Phase 3 completion report: Leads, Pipelines, Tasks & Activities

### Implemented and verified

| Area | What exists | Verified by |
|---|---|---|
| Data model | pipelines, pipeline_stages, leads, lead_stage_history (append-only), lead_products, tasks, task_relations (one task, many contexts), task_comments; composite FKs (a lead's stage must belong to its pipeline and org); forced RLS; owner/assignee FKs null only their own column | Migrations 0005–0006; integration tests |
| Pipelines | Default "Sales" pipeline with the spec's 7 stages, seeded per org (concurrency-safe); multiple pipelines; rename; set default; archive (blocked while open leads exist; never the last one) | Integration |
| Stages | Add (open stages slot before won/lost), rename, color, probability, open/won/lost type, required fields, reorder, archive with forced lead move (same type; history recorded); can't change type with leads in it; always ≥1 open stage | Integration + E2E |
| Leads | Create with customer picker, value (integer minor units; per-currency), source, priority, owner, expected close, interested products; reps who can only see their own leads own what they create; owner notified; LEAD-numbers | Integration + E2E |
| Kanban board | Drag-and-drop between and within stages (persisted order), optimistic with rollback on refusal, keyboard-accessible "Move to" control on every card, per-stage counts and per-currency totals, lost-reason prompt | E2E (drag persists after reload; refused move snaps back with explanation) |
| Stage rules | Required fields enforced on move, create and when clearing a field; lost requires a reason; won/lost set `closed_at`; reopen clears it; won deals never auto-create orders | Integration + E2E |
| Lead detail & drawer | Clickable stage progress bar, Won/Lost/Reopen, inline editing of every field, products, notes, tasks, stage history, activity timeline, archive/restore | E2E |
| Lead list view | Table with stage, value, priority, rep, close date; status filter | Build + render |
| Stats | Open leads, pipeline value and weighted forecast **per currency**, 90-day win rate; Command Center shows live Active leads, Pipeline value, My tasks due today, My overdue follow-ups | Integration + E2E |
| Tasks | Shared task entity linked to customers and/or leads without duplication; title, details, status, priority, assignee (defaults to creator), due date, repeat (daily/weekly/monthly, end-of-month safe, exactly one next occurrence), green completion check circles, comments, @mentions, assignment and comment notifications | Integration + E2E |
| Task views | My / All / Created by me; open / completed / all; overdue / today / next 7 days / no date (org timezone); list, board (drag between To do / In progress / Done) and month calendar; task drawer | E2E |
| Customer integration | Customer profile shows open leads and tasks; Leads and Tasks tabs; new lead pre-linked to the customer; lead and task events appear in the customer timeline; **customer merges move leads and task links, and undo moves them back** | Integration + E2E |
| Permissions | leads.read vs read_assigned in every query; customer names masked as "Restricted customer" when the user can't see that customer; tasks can't link to records the user can't see; pipelines.manage for configuration | Integration + E2E (rep can't open settings, can't see unassigned leads) |
| Tenant isolation | Leads, stages, customers and tasks from another org can't be read, moved, linked or assigned | Integration |

**Test totals:** 92 unit/integration tests and 25 end-to-end tests. All passing.

### Implemented but not fully tested
- Pipeline rename uses a browser prompt (works; not covered by E2E).
- Task board drag-and-drop (the select fallback is covered).

### Blocked or deferred
- **Overdue and reminder notifications** need the background job scheduler (Phase 6). Overdue tasks are highlighted everywhere and counted on the Command Center today.
- Linking won leads to orders: Phase 4.
- Saved views / column configuration: still pending (shared table work).

---

## Phase 4 completion report: Products, Orders, Payments & Fulfillment

### Implemented and verified

| Area | What exists | Verified by |
|---|---|---|
| Data model | stores (one "Manual" store per org, partial unique index), products, product_variants (SKU unique per org, case-insensitive, archived variants excluded), orders, order_items, payments, refunds, fulfillments, fulfillment_items. Composite tenant FKs, forced RLS on all. DB CHECKs: `total = subtotal − discount + tax + shipping`, `refunded ≤ paid`, line totals consistent. ORD-numbers per org | Migrations 0007–0008; integration (CHECK violation rejected; cross-tenant) |
| Money rules | Integer minor units + currency everywhere; totals computed once on the server (line discounts → order discount → tax in basis points on the discounted amount, rounded half away from zero → shipping); amounts in different currencies are never added together. Dashboards show one figure per currency | 39 unit tests on the math; integration totals test |
| Catalog | Products with variants, SKUs, prices, optional stock count, category, brand, image link, tags, active/draft/archived. Editing prices never changes existing orders (order lines are snapshots). Removing a variant archives it. Product page shows units sold, booked value and recent orders | Integration + E2E |
| Order creation | 3-step wizard (customer → items → review & details): catalog search, custom items, quantity, line and order discounts, tax %, shipping, delivery method and address, contact, notes, assignee, sales channel; live total preview using the same math as the server. Variants must be active and priced in the order's currency. Created **unpaid** | Integration + E2E (Scenario 1) |
| Leads → orders | "Create order" on a lead pre-links the lead and its customer; a won lead **never** creates an order automatically; order appears on the lead page and in both timelines | Integration + E2E |
| Payments | Staff-recorded payments only (cash, bank transfer, card/POS, mobile money, other), clearly labelled "Manual / Recorded by …"; amount can't exceed the balance due; no future dates; payment status is **derived** from recorded money (unpaid → partially paid → paid), never toggled. Voiding a mistaken manual payment keeps it visible, struck through with the reason, and is blocked if refunds depend on it | Integration + E2E (overpayment refused, prefilled balance) |
| Refunds | Separate `refunds.issue` permission (Owner/Admin by default; not sales managers, not support agents); reason required; capped at paid − refunded and at the chosen payment's remaining amount; status moves to partially refunded / refunded | Integration + E2E |
| Append-only ledger | The app's database role can't UPDATE or DELETE payments or refunds (only the three void columns on payments) | Integration (permission denied at DB level) |
| Fulfillment | Partial or full fulfillment per item with carrier, tracking number/link, shipped/delivered/picked up; can't fulfill more than ordered; "mark delivered"; fulfillment status derived from quantities | Integration + E2E |
| Order lifecycle | Items and prices editable only while unpaid and unfulfilled; complete (with a warning if a balance is still due — completing never marks anything paid), reopen; cancel requires everything refunded and nothing fulfilled, with a reason | Integration |
| Orders list | Views: All, Manual, Pending payment, Ready to fulfill, In fulfillment, Completed, Cancelled, Refunded; search by ORD-number or customer; pagination; drawer with actions; 30-day stats (net revenue = payments − refunds, orders, awaiting payment, awaiting fulfillment) | Integration + E2E |
| Customer profile | Real lifetime spending (paid − refunded, per currency), total orders, average order and last purchase replace the Phase 4 placeholders; Orders tab; recent orders on the overview; "New order" from the profile; **customer merge moves orders and undo moves them back** | Integration + E2E |
| Command Center | Live Revenue (30 days), Pending orders, Unpaid orders widgets; "Order" in quick create | E2E |
| Permissions & masking | Users without `orders.financials` (support agents, sales reps) see orders but every amount, payment and refund is hidden server-side; payment recording needs `payments.record` + financials; customer names masked when the customer isn't visible to the user | Integration + E2E (support agent sees no money, no refund/payment buttons, can't open New order) |
| Tenant isolation | Orders, variants and customers from another org can't be read, paid, refunded or ordered against; raw SQL under RLS returns nothing | Integration |

**Test totals:** 118 unit/integration tests and 30 end-to-end tests. All passing, along with lint, typecheck and the production build.

Also fixed in this phase: three timing-sensitive Phase 3 E2E steps (acting during a panel remount, a completed task leaving the "open" view, navigating before sign-out finished) now wait for stable state; repeated runs pass.

### Implemented but not fully tested
- Editing order items after creation (`updateOrderItems`) and order detail edits (`updateOrderDetails`) are covered by integration tests, but there's no edit UI yet — orders are edited by cancelling and re-creating while unpaid.
- Void payment and "mark delivered" buttons work in the UI; covered by integration tests, not E2E.

### Blocked by credentials or external setup (Phase 6)
- **Shopify / WooCommerce order and product sync**, and **Stripe / Paystack / Flutterwave payment links**: need store and provider credentials and the webhook + job infrastructure. Until then there is no "send payment link" button, and provider payments can only ever be created from verified webhooks — never from a click.
- Stock is a recorded number only; automatic decrement and store inventory sync arrive with store integrations.

### Not yet implemented (later phases)
- Order-related support tickets (Phase 5), order notifications to customers by email/WhatsApp (Phases 8–9), invoices/receipts PDF, returns workflow beyond refunds, multi-store management UI.
- Product image upload (needs file storage, Phase 5); image links work today.

### Known limitations
- Tax is a single rate per order (no per-line tax classes or tax-inclusive pricing).
- Revenue figures are per currency; there is no currency conversion by design.

---

## Phase 5 completion report: Support Tickets (core)

### Implemented and verified

| Area | What exists | Verified by |
|---|---|---|
| Data model | ticket_statuses, ticket_types, support_tickets, ticket_messages, files, ticket_attachments, ticket_record_links; composite tenant FKs, forced RLS; assignee/team FKs null only their own column; TCK-numbers | Migrations 0009–0010; integration (cross-tenant) |
| Statuses & types | Seeded per org (New, Open, Waiting on customer, Waiting on team, Escalated, Resolved, Closed; 7 types). Custom statuses map to a standard category that drives queues and reports; one default; can't archive a status in use, the default, or the last of a core category. Settings page under **Ticket statuses & types** (`support.configure`) | Integration + E2E |
| Tickets | Create from the Tickets page, top-bar Quick create, a customer profile or an order (prefilled). Subject, customer, related order, what the customer said, channel received, priority, type, assignee, attachments. Contact details default from the customer | Integration + E2E |
| Conversation | Three clearly separated message kinds: **Reply to customer**, **Internal note** (highlighted, team only), **Log customer message** (with the channel it came in on). Append-only at the database level. Status follows the conversation: replying to a new ticket → Waiting on customer; a customer message on a waiting or resolved ticket → Open (counted as a reopen). Closed tickets accept only internal notes | Integration + E2E |
| Honest delivery | Replies are saved on the ticket and marked **"Not sent to customer"**. Sending through email/WhatsApp needs channel connections (Inbox build), so nothing claims to have been sent | E2E |
| Resolution | Resolving requires a resolution reason (answered, replacement sent, refund issued, …) with an optional note; reopening clears it and increments the reopen count | Integration + E2E |
| Attachments | Images, PDF, Office docs, text, audio and video; up to 5 files / 4 MB per message (Vercel's request limit); file content checked against its declared type for images and PDFs; served through an authenticated route only to people who can see the ticket (`nosniff`, sandboxed CSP, private no-store); image previews in the thread; customer **Files** tab | Integration (type spoofing, executable, size, other org, unassigned agent all refused) + E2E |
| Links | Tickets link to orders and leads; order page shows its tickets and "Create ticket"; ticket list filter by order | Integration + E2E |
| Queues | Views: My open, Unassigned, All open, Waiting, Escalated, Resolved, Closed, All; search by subject, TCK-number or customer; filter by priority, assignee, type; sort by activity, priority, newest, oldest; pagination; wide drawer with the full workspace; open-ticket count badge in the sidebar | Integration + E2E |
| Support Dashboard | Open, unassigned, urgent/high, awaiting our reply (now), created and resolved (30 days), median first reply time, priority queue. **No SLA figures** until SLA policies exist (Phase 7) | Integration + E2E |
| Customer profile | Real **Open tickets** metric, Tickets tab, Files tab, ticket events on the timeline; **customer merge moves tickets, undo moves them back** | Integration + E2E |
| Permissions | `tickets.read` sees all; `tickets.read_assigned` (support agents) sees only tickets assigned to them, and tickets they create are assigned to them; `tickets.assign` to reassign; sales reps have no ticket access; customer names masked when not visible; notifications on assignment and when a customer replies | Integration + E2E |

**Test totals:** 133 unit/integration tests and 34 end-to-end tests, all passing, along with lint, typecheck and the production build.

### Implemented but not fully tested
- Teams on tickets (`team_id`) are stored and validated; no team picker in the UI yet (routing by team is Phase 7).
- Linking leads to tickets works in the service; the UI only offers linking orders.

### Blocked by external setup
- **Sending replies to customers** (email, WhatsApp, Instagram, Messenger, SMS) needs channel connections and credentials (Inbox, Phase 8).
- Larger attachments (over 4 MB) need object storage; files currently live in Postgres behind a storage interface that can switch to object storage without changing callers.

### Not yet implemented (later phases)
- Ticket forms, customer portal, SLA policies and business hours, routing rules, escalation (Phase 7); CSAT surveys and knowledge base (Phase 10).

---

## SalesGel rebrand and landing dashboard (requested brief)

### Implemented and verified

| Area | What exists | Verified by |
|---|---|---|
| Brand | SalesGel name and logo (cut from the supplied mockup until the original file is provided), deep navy sidebar, electric blue (#0053ee) primary actions, bright teal (#00c2a8) highlights, light background, white rounded cards | Screenshots desktop / tablet / mobile |
| Navigation | Persistent dark sidebar: Dashboard, Inbox, Contacts, Leads, Deals, Orders, Tickets, Marketing, Email, Phone & Messaging, Knowledge Base, Automations, Reports & Insights, Settings; secondary tools under a collapsible **More**. Workspace selector, open-ticket count, collapse control, profile + account menu at the bottom, clear active state. Tablet = icon rail, mobile = drawer. Unbuilt modules are marked **Soon** and open honest placeholders | E2E (desktop + 390px) |
| Leads vs Deals | Same records: **Leads** is the list, **Deals** is the pipeline board (toggle between them); Deals supports a single-stage filter | E2E |
| Top bar | Page title / breadcrumb, global search, Quick Create (Contact, Lead, Deal, Order, Ticket, Task — each opens its create form), notifications, help, avatar | E2E |
| Global search | Contacts, leads & deals, orders and tickets, grouped by type, each permission-filtered by its own module; conversations once the Inbox exists | Build + E2E (phase 2 search) |
| Header & filters | Greeting from the viewer's local clock with their first name; Today / Yesterday / Last 7 days / This month / Last month / Custom; comparison (previous period, same period last year, none); team-member filter for managers; Customize dashboard. Periods are computed in the workspace timezone | Unit (timezone maths incl. DST) + E2E |
| Performance cards | Sales Revenue (payments received minus refunds in the period, per currency with a currency selector — never summed across currencies), New Leads, Open Deals (now, count + value), Orders (placed in the period), Unresponded Conversations (honest "no channels connected"), Open Tickets (now). Comparison indicators where meaningful; workload cards are labelled "Now". Each card opens its records with matching filters, and the numbers reconcile with those lists | Integration (reconciliation) + E2E |
| Sales Performance | SVG line chart, Revenue/Orders toggle, hourly/daily/weekly/monthly grouping by range, currency-formatted axis, crosshair tooltip (hover + arrow keys), comparison line, legend, table view, View report. Series colors validated for colour-blind separation and contrast | Integration + E2E |
| Sales Pipeline | The workspace's configured stages (Lost kept in the full pipeline), count + per-currency value + stage colour; open deals now, Won within the period; stage → Deals filtered to it; Add deal, View pipeline | Integration + E2E |
| Inbox Preview | Honest empty state with **Connect channel**; nothing implies messages are being received | E2E |
| My Follow-ups | Overdue first, then today, then upcoming; linked customer/deal links; inline due date, priority and assignee (saving state, success toast, rollback on failure); green check completion; title opens the task popup; To do / Completed filter; Add task; View all tasks | E2E |
| Recent Orders | Order, customer + source, date, total + currency, separate payment and fulfillment badges; row opens a side panel with expand-to-full-page; Create order, View all orders | E2E (filters preserved after closing) |
| Support Overview | Open, unassigned, resolved in period; **Overdue** shows "needs SLA targets" (no fabricated SLA numbers until Phase 7); priority ticket list opening the ticket workspace in a side panel; Create ticket, View tickets | E2E |
| Recent Activity | Lead created, deal stage changed / won / lost, payment recorded, order created/completed/fulfilled, ticket opened/resolved, customer replied, task completed — actor, action, linked record, source, timestamp. Filtered to what the viewer may see (assigned-only users see only their records; no payment events without financial access) | Integration (permission boundaries) |
| Customization | Show/hide, reorder, half/full width, save personal layout, reset to workspace default; admins can save the workspace default; personal layouts never change anyone else's dashboard | Integration + E2E |
| Fixes found by testing | Payments dated "today" were stored at midnight UTC and could land on the previous local day (now: local day in the workspace timezone; regression test fails without the fix). Customize checkboxes had ids clashing with widget headings (labels attached to the wrong element) | Integration + E2E |

**Test totals:** 139 unit/integration tests and 41 end-to-end tests, all passing, with lint, typecheck and the production build.

### Not yet live (depends on later phases)
- Inbox Preview rows, read/unread/responded/ignored states, the conversation side panel and the Unresponded Conversations number need channel connections (Inbox build, Phase 8).
- Overdue tickets and response deadlines need SLA policies (Phase 7).
- Store sources other than manual (Shopify, WooCommerce) appear once integrations exist (Phase 6).
- Logo: replace `public/salesgel-mark.png` with the original artwork when available.
