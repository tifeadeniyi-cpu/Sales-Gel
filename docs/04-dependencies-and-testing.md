# Dependency Plan & Test Strategy

## Verified stack (installed versions, November 2026)

| Concern | Choice | Version | Why |
|---|---|---|---|
| Framework | Next.js (App Router) | 16.4.6 | Required; `proxy.ts` replaces middleware in v16 |
| UI runtime | React | 19.3 | Pinned by Next |
| Language | TypeScript | 5.9.3 | Pinned by create-next-app; TS 7 (native) not yet adopted until Next tooling confirms support |
| Styling | Tailwind CSS | 4.3 | |
| Components | shadcn/ui conventions on `radix-ui` | | Components are vendored in `src/components/ui` (the shadcn registry wasn't reachable from the build sandbox; `components.json` is present so `shadcn add` works locally) |
| Database | PostgreSQL | 16 | |
| ORM | Drizzle ORM / drizzle-kit | 0.45 / 0.31 | SQL-first: composite FKs, RLS policies and CHECK constraints in typed schema |
| Driver | postgres (postgres.js) | 3.4 | |
| Auth | Better Auth (self-hosted, Drizzle adapter) | 1.7 | Runs in our app and database, so it's real auth with no external dependency. Orgs and permissions are our own tables, so authorization stays under our control. Can move to Neon's Managed Better Auth later without a data-model change |
| Validation | Zod | 4.6 | |
| Unit/integration | Vitest | 5.1 | |
| E2E | Playwright | 1.65 | |
| Jobs | BullMQ on Redis | Phase 6 | |
| Storage | S3-compatible (AWS SDK v3) | Phase 2 | |
| SaaS billing | Stripe | Phase 11 | |
| Errors | Sentry | Phase 11 | env-flagged |

## Phase dependencies

```
1 Foundation ─► 2 Customers ─► 3 Sales+Tasks ─► 4 Commerce ─► 5 Support core
                                                    │               │
                                                    ▼               ▼
                                         6 Integrations ──► 7 Forms/Portal/SLA
                                                    │
                                                    ▼
                                           8 Inbox ─► 9 Marketing/Automation ─► 10 Analytics/KB ─► 11 Billing/Hardening
```

The job infrastructure (BullMQ worker, outbox relay) lands in Phase 6. Earlier phases write `outbox_events` rows so nothing needs retrofitting.

## Test strategy

| Layer | Tool | Runs against | Covers |
|---|---|---|---|
| Unit | Vitest | pure functions | money math, permission catalog, validation schemas, slug and number allocation |
| Integration | Vitest | **real Postgres** (`crm_test`, migrated fresh per run, connected as `crm_app` so RLS is live) | services: authorization, tenant isolation, audit writes, composite-FK rejection, RLS leak tests |
| E2E | Playwright | `next build && next start` + test DB | the eight critical scenarios from the spec, added as their phases land |
| Static | `tsc --noEmit`, ESLint | | every commit (CI) |

Rules:

- Every service function gets at least one permission-denied test and one cross-tenant test.
- The tenant-security suite (Scenario 6) grows with every table. A helper creates two orgs and asserts that every service and every API route refuses cross-org access.
- No mocks of Postgres. External providers are mocked **only** in tests, behind adapter interfaces. Production code never ships fake provider responses.
- CI: GitHub Actions with a Postgres 16 service container runs lint → typecheck → migrate → unit+integration → build → e2e.
