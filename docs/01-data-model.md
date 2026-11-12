# Data Model

This is the target schema for all domains. Each phase adds its own tables in an additive migration; the **Phase** column says when. Drizzle definitions live in `src/domains/<domain>/schema.ts`.

## Conventions (all tables)

- `id uuid` primary key, generated as UUIDv7 in the app, so ids are time-ordered and index-friendly.
- Org-owned tables: `organization_id uuid NOT NULL`, `UNIQUE (organization_id, id)`, RLS forced.
- Foreign keys between org-owned tables are composite: `(organization_id, x_id) → x(organization_id, id)`.
- `created_at timestamptz DEFAULT now()`, `updated_at timestamptz` (maintained by the app).
- Archival: `archived_at timestamptz NULL` for user-facing records. Hard deletion only through retention jobs.
- Money: `*_amount bigint` (minor units) plus `currency char(3)`.
- Human numbers (`ORD-1042`, `TCK-88`) come from `org_sequences(organization_id, key, next_value)`, allocated with `UPDATE … RETURNING` inside the transaction.
- Enum-like values are `text` with CHECK constraints, so migrations stay cheap. Stable *categories* drive reporting; display labels are configurable.

## Identity & organizations (Phase 1)

| Table | Key columns | Notes |
|---|---|---|
| `user` | id text, email unique, name, email_verified, image | Better Auth core; global, no RLS |
| `session`, `account`, `verification` | | Better Auth core |
| `organizations` | id, slug unique, name, business_type, timezone, default_currency, logo_key, status | RLS: visible if `id = app.org_id` or caller is a member |
| `memberships` | org, user_id, role_id, status (active/deactivated), joined_at | UNIQUE(org, user_id). RLS: org match or `user_id = app.user_id` |
| `roles` | org, key, name, description, is_system | System roles are seeded per org; custom roles allowed |
| `permissions` | key PK, domain, description | Global catalog, synced from code |
| `role_permissions` | org, role_id, permission_key | |
| `teams`, `team_members` | org, name / team_id, membership_id | |
| `invitations` | org, email, role_id, token_hash, expires_at, status, invited_by | Only a SHA-256 hash of the token is stored |
| `org_sequences` | org, key, next_value | |
| `audit_logs` | org, actor_user_id, action, entity_type, entity_id, changes jsonb, metadata jsonb, ip, user_agent, created_at | Append-only: app role has no UPDATE/DELETE |
| `notifications` | org, recipient_user_id, type, title, body, link, entity_type, entity_id, read_at | |
| `notification_preferences` | org, user_id, event_type, in_app, email | |
| `outbox_events` | org, type, payload jsonb, status, attempts, available_at, processed_at | |

## Customers (Phase 2)

| Table | Key columns |
|---|---|
| `customers` | org, number, type (person/business), first_name, last_name, display_name, company_name, source, owner_membership_id, preferred_channel, preferred_currency, custom_fields jsonb, status (provisional/active/archived), merged_into_id |
| `customer_emails` | org, customer_id, email, normalized_email, is_primary, label |
| `customer_phones` | org, customer_id, phone, e164, is_primary, label |
| `customer_identities` | org, customer_id, provider, provider_account_id, external_id, handle. UNIQUE(org, provider, provider_account_id, external_id) |
| `customer_addresses` | org, customer_id, kind (billing/shipping), line1…, country, is_default |
| `tags`, `customer_tags` | org, name, color / customer_id, tag_id |
| `customer_consents` | org, customer_id, channel, purpose, status, source, captured_at, evidence jsonb (history rows, never updated in place) |
| `customer_notes` | org, customer_id, author_membership_id, body |
| `customer_merges` | org, survivor_id, merged_id, snapshot jsonb, merged_by, reverted_at (reconciliation trail) |
| `custom_field_definitions` | org, entity, key, label, type, options jsonb, required |

Duplicate detection runs on `normalized_email`, `e164` and identity tuples. It produces suggestions and never auto-merges.

## Sales (Phase 3)

`pipelines` (org, name, is_default) · `pipeline_stages` (org, pipeline_id, name, position, color, probability, category open/won/lost, required_fields jsonb, archived_at) · `leads` (org, number, title, customer_id, pipeline_id, stage_id, value_amount, currency, source, probability, priority, owner_membership_id, expected_close_date date, closed_at, lost_reason) · `lead_stage_history` · `lead_products` · `lead_conversations` · `lead_orders`.

## Tasks (Phase 3)

`tasks` (org, title, description, status, priority, assignee_membership_id, creator_membership_id, due_at, reminder_at, recurrence_rule, completed_at) · `task_relations` (task_id, entity_type, entity_id: one task, many contexts, no duplicates) · `task_comments` · `task_attachments` · `task_activity`.

## Commerce & payments (Phase 4, 6)

`stores` (org, provider, name, currency) · `products` · `product_variants` (sku, price_amount, currency) · `product_external_mappings` · `orders` (org, number, external_id, customer_id, store_id, source, currency, subtotal/discount/tax/shipping/total amounts, payment_status, order_status, fulfillment_status: **three independent status columns**) · `order_items` (an immutable snapshot of product name, sku and unit price at order time) · `order_adjustments` · `payments` (provider, provider_payment_id, amount, currency, status, verified_at, raw_event_id; UNIQUE(org, provider, provider_payment_id)) · `refunds` · `fulfillments` and `fulfillment_items`.

Payment status is *derived* from verified `payments` minus `refunds`; it is never set by a UI click.

## Support (Phase 5, 7, 10)

`support_tickets` (org, number, subject, description, customer_id, source_channel, ticket_type_id, category, status_id, priority, assignee_membership_id, team_id, sla_policy_id, first_response_due_at, resolution_due_at, first_responded_at, resolved_at, closed_at, reopened_count, custom_fields jsonb) · `ticket_statuses` (org, name, category new/open/pending_customer/pending_internal/escalated/resolved/closed, position) · `ticket_status_transitions` · `ticket_types` · `ticket_messages` (direction, visibility public/internal, author) · `ticket_attachments` · `ticket_assignments` · `ticket_events` · `ticket_record_links` · `ticket_resolutions` · `ticket_forms`, `ticket_form_versions` (published definitions are immutable), `ticket_form_fields` · `ticket_sla_policies`, `ticket_sla_events`, `business_hours`, `holidays` · `support_teams` · `ticket_routing_rules` (priority-ordered) · `knowledge_categories`, `knowledge_articles`, `knowledge_article_versions` · `ticket_surveys` · `portal_access_tokens` (hashed, expiring, single-ticket scoped).

## Conversations (Phase 8)

`channel_connections` · `conversations` (org, channel, channel_connection_id, customer_id, status, assignee, last_message_at, window_expires_at) · `messages` (direction, provider_message_id UNIQUE per connection, delivery_status, error) · `message_attachments` · `conversation_assignments` · `conversation_record_links` · `saved_replies`.

## Marketing & automation (Phase 9)

`segments`, `segment_rules` (a nested rule tree stored as jsonb plus a version) · `campaigns`, `campaign_recipients` (per-recipient status; UNIQUE(campaign_id, customer_id)), `campaign_events` · `automations`, `automation_versions` (an immutable published graph), `automation_executions` (idempotency_key UNIQUE), `automation_steps`, `automation_events`.

## Infrastructure (Phase 6, 11)

`integration_connections` (provider, external_account_id, status, scopes, encrypted credentials, last_sync_at, error) · `external_record_mappings` (provider, provider_account_id, external_type, external_id → entity_type, entity_id; UNIQUE on the external tuple) · `sync_jobs`, `sync_checkpoints` · `webhook_events` (provider, provider_event_id UNIQUE, signature_verified, status, payload) · `files` (org, storage_key, mime, size, scan_status, owner entity) · `subscriptions`, `plans`, `plan_entitlements`, `subscription_entitlements`, `usage_records`.

## Indexing plan (initial)

- `(organization_id, created_at DESC)` on every list table.
- `(organization_id, owner/assignee)`; `(organization_id, status)` for queues.
- Trigram indexes (`pg_trgm`) on names, emails and subjects for search (Phase 2).
- Partial indexes for open work: `WHERE status_category NOT IN ('resolved','closed')`.
