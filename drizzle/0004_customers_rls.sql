-- Phase 2: tenant RLS for customer tables + owner FK that nulls only the owner column.
SELECT app_enable_tenant_rls('customers');
--> statement-breakpoint
SELECT app_enable_tenant_rls('customer_emails');
--> statement-breakpoint
SELECT app_enable_tenant_rls('customer_phones');
--> statement-breakpoint
SELECT app_enable_tenant_rls('customer_identities');
--> statement-breakpoint
SELECT app_enable_tenant_rls('customer_addresses');
--> statement-breakpoint
SELECT app_enable_tenant_rls('tags');
--> statement-breakpoint
SELECT app_enable_tenant_rls('customer_tags');
--> statement-breakpoint
SELECT app_enable_tenant_rls('customer_consents');
--> statement-breakpoint
SELECT app_enable_tenant_rls('customer_notes');
--> statement-breakpoint
SELECT app_enable_tenant_rls('customer_merges');
--> statement-breakpoint
SELECT app_enable_tenant_rls('customer_duplicate_dismissals');
--> statement-breakpoint
SELECT app_enable_tenant_rls('custom_field_definitions');
--> statement-breakpoint
ALTER TABLE customers ADD CONSTRAINT customers_owner_membership_fk
  FOREIGN KEY (organization_id, owner_membership_id)
  REFERENCES memberships (organization_id, id)
  ON DELETE SET NULL (owner_membership_id);
--> statement-breakpoint
-- Consent history is append-only for the app role.
REVOKE UPDATE, DELETE ON customer_consents FROM crm_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON customers, customer_emails, customer_phones, customer_identities,
  customer_addresses, tags, customer_tags, customer_notes, customer_merges, customer_duplicate_dismissals,
  custom_field_definitions TO crm_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON customer_consents TO crm_app;
--> statement-breakpoint
-- Merges re-point consent history to the surviving customer (and back on unmerge); nothing else may change.
GRANT UPDATE (customer_id) ON customer_consents TO crm_app;
