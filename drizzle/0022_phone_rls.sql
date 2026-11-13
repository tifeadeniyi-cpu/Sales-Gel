-- Phase 8b: phone & calls.
SELECT app_enable_tenant_rls('telecom_accounts');
--> statement-breakpoint
SELECT app_enable_tenant_rls('phone_numbers');
--> statement-breakpoint
SELECT app_enable_tenant_rls('phone_agents');
--> statement-breakpoint
SELECT app_enable_tenant_rls('phone_queues');
--> statement-breakpoint
SELECT app_enable_tenant_rls('phone_queue_members');
--> statement-breakpoint
SELECT app_enable_tenant_rls('calls');
--> statement-breakpoint
SELECT app_enable_tenant_rls('call_legs');
--> statement-breakpoint
SELECT app_enable_tenant_rls('call_events');
--> statement-breakpoint
SELECT app_enable_tenant_rls('call_notes');
--> statement-breakpoint
SELECT app_enable_tenant_rls('call_voicemails');
--> statement-breakpoint
SELECT app_enable_tenant_rls('phone_usage_records');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON telecom_accounts, phone_numbers, phone_agents, phone_queues, phone_queue_members, calls, call_legs, call_events, call_notes, call_voicemails, phone_usage_records TO crm_app;
--> statement-breakpoint
-- Provider events and usage are an append-only ledger.
REVOKE UPDATE, DELETE ON call_events, phone_usage_records FROM crm_app;
