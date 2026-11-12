# Progress & Phase Status

_Last updated: 2026-11-12 (Phase 3)_

| Phase | Scope | Status |
|---|---|---|
| 0 | Planning docs (architecture, schema, authz, routes, components, deps, tests, external APIs) | ✅ Done (`docs/`) |
| **1** | **Foundation** | ✅ **Implemented and verified** |
| **2** | **Customers** | ✅ **Implemented and verified** |
| **3** | **Sales CRM + Tasks** | ✅ **Implemented and verified** |
| **4** | **Commerce** | ✅ **Implemented and verified** |
| 5 | Support core | ⏳ Next |
| 6 | Commerce integrations (Shopify, payments, job infrastructure) | Not started |
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
