# Progress & Phase Status

_Last updated: 2026-11-11_

| Phase | Scope | Status |
|---|---|---|
| 0 | Planning docs (architecture, schema, authz, routes, components, deps, tests, external APIs) | ✅ Done (`docs/`) |
| **1** | **Foundation** | ✅ **Implemented and verified** |
| 2 | Customers | ⏳ Next |
| 3 | Sales CRM + Tasks | Not started |
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
