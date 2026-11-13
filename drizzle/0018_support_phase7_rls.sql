-- Phase 7: business hours, SLA, routing, forms, customer portal.
SELECT app_enable_tenant_rls('business_hours');
--> statement-breakpoint
SELECT app_enable_tenant_rls('holidays');
--> statement-breakpoint
SELECT app_enable_tenant_rls('sla_policies');
--> statement-breakpoint
SELECT app_enable_tenant_rls('ticket_forms');
--> statement-breakpoint
SELECT app_enable_tenant_rls('ticket_form_versions');
--> statement-breakpoint
SELECT app_enable_tenant_rls('ticket_sla_events');
--> statement-breakpoint
SELECT app_enable_tenant_rls('ticket_routing_rules');
--> statement-breakpoint
SELECT app_enable_tenant_rls('team_assignment_cursors');
--> statement-breakpoint
SELECT app_enable_tenant_rls('support_portals');
--> statement-breakpoint
SELECT app_enable_tenant_rls('portal_access_tokens');
--> statement-breakpoint
SELECT app_enable_tenant_rls('portal_submissions');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON business_hours, holidays, sla_policies, ticket_forms, ticket_form_versions, ticket_sla_events, ticket_routing_rules, team_assignment_cursors, support_portals, portal_access_tokens, portal_submissions TO crm_app;
--> statement-breakpoint
-- Published form versions and SLA history are append-only.
REVOKE UPDATE, DELETE ON ticket_form_versions, ticket_sla_events FROM crm_app;
--> statement-breakpoint
-- Slug lookup table holds no tenant data; the portal reads it before a tenant scope exists.
GRANT SELECT, INSERT, UPDATE, DELETE ON portal_routes TO crm_app;
