# Progress & Phase Status

_Last updated: 2026-11-12_

| Phase | Scope | Status |
|---|---|---|
| 0 | Planning docs (architecture, schema, authz, routes, components, deps, tests, external APIs) | ✅ Done (`docs/`) |
| **1** | **Foundation** | ✅ **Implemented and verified** |
| **2** | **Customers** | ✅ **Implemented and verified** |
| 3 | Sales CRM + Tasks | ⏳ Next |
| 4 | Commerce | Not started |
| 5 | Support core | Not started |
| 6 | Commerce integrations (Shopify, payments, job infrastructure) | Not started |
| 7 | Support forms, portal, SLA, routing | Not started |
| 8 | Unified inbox | Not started |
| 9 | Marketing & automation | Not started |
| 10 | Analytics, knowledge base | Not started |
| 11 | Billing & production hardening | Not started |

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
