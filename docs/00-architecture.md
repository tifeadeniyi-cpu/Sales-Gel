# Architecture Overview

Commerce CRM is a multi-tenant SaaS: CRM, social-commerce inbox, order tracking and helpdesk in one workspace for small merchants.

## Shape

**Modular monolith + background workers.** One Next.js application serves the UI, server actions and the versioned HTTP API. A separate worker process (same codebase, `src/worker/`) consumes durable jobs from Redis (BullMQ) for webhooks, syncs, automations, campaigns and SLA timers. No microservices.

```
Browser ──► Next.js (App Router)
              ├─ Server Components (reads via services)
              ├─ Server Actions   (mutations via services)
              ├─ /api/v1/*        (external API, same services)
              └─ /api/webhooks/*  (verify → persist webhook_events → enqueue)
                         │
                 PostgreSQL ◄──── Worker (BullMQ on Redis)
                         │            ├─ outbox relay
                 S3-compatible        ├─ integration syncs
                 private storage      ├─ automation executor
                                      └─ SLA / reminder timers
```

## Code layout

```
src/
  app/                    routes only: pages, layouts, route handlers, thin action wrappers
    (auth)/               sign-in, sign-up, invite acceptance
    (app)/o/[orgSlug]/    the tenant workspace (every route is org-scoped)
    api/v1/               versioned external API
  domains/<domain>/       domain logic — no React here
    schema.ts             Drizzle tables for the domain
    service.ts            use-cases (authorize → validate → persist → audit → emit)
    validation.ts         Zod schemas shared by UI forms, actions and API
    policy.ts             permission requirements
    events.ts             domain event definitions
  server/                 cross-cutting server infra
    db/                   clients, tenant transaction helper, migrations runner
    auth/                 Better Auth config and session helpers
    authz/                permission catalog, role templates, `can()` and guards
    audit/                audit log writer
    actions.ts            `defineAction()` — the only way to write a mutation
  components/
    ui/                   design-system primitives (shadcn conventions)
    app/                  shared composites: shell, data table, inline edit, record drawer
  lib/                    framework-free helpers (money, ids, dates)
  worker/                 job processors
```

Domains: identity (orgs, members, teams, roles), customers, leads/pipelines, conversations, commerce, payments, support, tasks, marketing, automation, reporting, integrations, billing. A domain may call another domain's **service**, never its tables directly.

## Request flow for a mutation

1. Server action or API route receives input.
2. `requireOrgContext(orgSlug)` resolves the session user and validates membership in that org server-side. A client-supplied org id is never trusted.
3. `authorize(ctx, permission)` checks the member's effective permissions.
4. Zod validates input.
5. The service runs inside `withTenant(ctx, tx => …)`: a transaction that sets `app.org_id` / `app.user_id` so Postgres RLS applies.
6. The service writes the record, an `audit_logs` row and any `outbox_events` row in the **same transaction**.
7. The UI revalidates affected paths. The outbox relay publishes events to workers after commit.

## Tenancy: three layers

| Layer | Mechanism |
|---|---|
| Application | Every query goes through a service that receives an `OrgContext`; repositories always filter by `organization_id`. |
| Relational | Every org-owned table has `UNIQUE (organization_id, id)`. Child foreign keys are **composite** `(organization_id, parent_id) → parent(organization_id, id)`, so a row can never point at another tenant's record. |
| Row Level Security | The runtime connects as `crm_app` (NOSUPERUSER, NOBYPASSRLS). Each org-owned table has `FORCE ROW LEVEL SECURITY` with policy `organization_id = current_setting('app.org_id')::uuid`. If a query forgets the filter, it returns nothing instead of leaking. |

Migrations run as the owner role (`DATABASE_URL_MIGRATE`). The app and worker use `DATABASE_URL` (crm_app).

URL shape: `/o/{orgSlug}/…`. Deep links carry the org explicitly, so multiple tabs on different orgs are safe.

## Rendering model

Next.js 16 with `cacheComponents` **disabled**. Almost every screen is per-user and per-tenant, so we render dynamically and keep caching explicit (rather than prerendering a shell). That keeps tenant data out of any shared cache. This can be revisited for marketing and portal pages.

## Async and reliability

- **Outbox pattern:** domain events are written to `outbox_events` in the business transaction; the relay enqueues them. No lost or phantom events.
- **Webhooks:** verify signature → insert into `webhook_events` with `UNIQUE (provider, provider_event_id)` → enqueue → 200. Duplicates are no-ops.
- **Jobs:** idempotency keys, bounded retries with backoff, dead-letter status visible in the UI.
- Every async operation has a status row the UI can show (sync_jobs, automation_executions, campaign_recipients).

## Money

Integer minor units (`bigint`) plus an ISO-4217 `currency` column on every monetary row. All arithmetic lives in `src/lib/money.ts` and is unit-tested. Amounts in different currencies are never summed without an explicit conversion step; reports group by currency.

## Observability

Structured JSON logs (pino) with `org_id`, `user_id` and `request_id`. Sentry is wired through an env flag (off until a DSN is provided). Audit logs are a product feature, separate from operational logs.
