@AGENTS.md

# Commerce CRM — working agreement

The product spec is the master prompt (Parts 1–30). Read `PROGRESS.md` first, then the relevant file in `docs/`.

## Non-negotiables

- Tenant data is only read or written inside `withTenant(ctx, tx => …)` (or `withScope`). RLS is forced; the runtime role can't bypass it.
- New org-owned table checklist: `organization_id`, `UNIQUE (organization_id, id)`, composite FKs to parents, and a migration line `SELECT app_enable_tenant_rls('<table>');`. Add a cross-tenant test.
- Every service mutation: `authorize()` → `parseInput()` → write → `audit()` in the same transaction → `emit()` if other domains care.
- Server-side authorization only. UI hiding is a convenience.
- No fake data, fake integrations or fake payment confirmations. Unbuilt modules show the phase placeholder.
- Money: bigint minor units plus currency; never add across currencies.
- Before calling a phase done: `pnpm lint && pnpm typecheck && pnpm db:reset:test && pnpm test && pnpm build && pnpm test:e2e`, then update `PROGRESS.md` with the four-bucket report.
