# Commerce CRM

Multi-tenant CRM, social-commerce and customer-support platform for small businesses: customers, leads, conversations, orders, support tickets, marketing and automation in one connected workspace.

**Status:** Phase 1 (Foundation) complete and verified. See [PROGRESS.md](PROGRESS.md).

## Docs

| | |
|---|---|
| [Architecture](docs/00-architecture.md) | Modular monolith, tenancy layers, request flow, async model |
| [Data model](docs/01-data-model.md) | All domains, conventions, indexing |
| [Authorization](docs/02-authorization.md) | Permission catalog and role matrix |
| [Routes & components](docs/03-routes-and-components.md) | Route inventory, shared UI |
| [Dependencies & testing](docs/04-dependencies-and-testing.md) | Verified stack, phase graph, test strategy |
| [External APIs](docs/05-external-apis.md) | What each integration needs from you |

## Local setup

Requirements: Node 22, pnpm 10, PostgreSQL 16.

```bash
pnpm install
cp .env.example .env        # then set BETTER_AUTH_SECRET (openssl rand -base64 32)

# Create the owner role + databases once (adjust to your Postgres setup)
psql -U postgres -c "CREATE ROLE crm WITH LOGIN SUPERUSER PASSWORD 'crm';"
psql -U postgres -c "CREATE DATABASE crm_dev OWNER crm;" -c "CREATE DATABASE crm_test OWNER crm;"

pnpm db:migrate             # creates the crm_app runtime role, runs migrations, syncs permissions
pnpm dev                    # http://localhost:3000
```

The app **must** connect as `crm_app` (a non-superuser without BYPASSRLS) so Row Level Security applies. The migrate script refuses to continue if that role could bypass RLS.

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Runtime connection as `crm_app` |
| `DATABASE_URL_MIGRATE` | yes | Owner connection for migrations only |
| `APP_DB_PASSWORD` | dev/CI | Password the migrate script gives `crm_app` if it creates the role |
| `BETTER_AUTH_SECRET` | yes | 32+ random bytes |
| `BETTER_AUTH_URL`, `NEXT_PUBLIC_APP_URL` | yes | Public base URL |
| `EMAIL_PROVIDER`, `EMAIL_API_KEY`, `EMAIL_FROM` | no | Transactional email; the UI shows "not connected" until set |
| `AUTH_RATE_LIMIT` | no | `1` enables auth rate limiting outside production |
| `LOG_LEVEL` | no | pino level |

## Scripts

```bash
pnpm lint && pnpm typecheck
pnpm db:reset:test          # fresh test DB (refuses non *_test databases)
pnpm test                   # unit + integration (real Postgres, RLS on)
pnpm build && pnpm test:e2e # Playwright against the production build
# PLAYWRIGHT_CHANNEL=chrome pnpm test:e2e  → use installed Chrome
pnpm db:generate --name <change>   # new migration from schema changes
```

## Conventions

- Mutations go through a domain **service**: `authorize → parseInput → withTenant(tx) → write → audit() → emit()`.
- Never query tenant tables outside `withTenant`/`withScope`.
- Every new org-owned table needs `UNIQUE (organization_id, id)`, composite FKs, and `SELECT app_enable_tenant_rls('<table>')` in its migration.
- Money is integer minor units plus a currency code. Never sum across currencies.
- Unbuilt modules show an honest "Scheduled for Phase N" page, never mock data.
