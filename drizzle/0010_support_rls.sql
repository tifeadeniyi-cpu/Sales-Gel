-- Phase 5: support tenant RLS, member/team FKs that null only their own column, append-only messages.
SELECT app_enable_tenant_rls('ticket_statuses');
--> statement-breakpoint
SELECT app_enable_tenant_rls('ticket_types');
--> statement-breakpoint
SELECT app_enable_tenant_rls('support_tickets');
--> statement-breakpoint
SELECT app_enable_tenant_rls('ticket_messages');
--> statement-breakpoint
SELECT app_enable_tenant_rls('files');
--> statement-breakpoint
SELECT app_enable_tenant_rls('ticket_attachments');
--> statement-breakpoint
SELECT app_enable_tenant_rls('ticket_record_links');
--> statement-breakpoint
ALTER TABLE support_tickets ADD CONSTRAINT support_tickets_assignee_fk
  FOREIGN KEY (organization_id, assignee_membership_id) REFERENCES memberships (organization_id, id)
  ON DELETE SET NULL (assignee_membership_id);
--> statement-breakpoint
ALTER TABLE support_tickets ADD CONSTRAINT support_tickets_team_fk
  FOREIGN KEY (organization_id, team_id) REFERENCES teams (organization_id, id)
  ON DELETE SET NULL (team_id);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ticket_statuses, ticket_types, support_tickets, ticket_record_links TO crm_app;
--> statement-breakpoint
-- Ticket conversation, attachments and files are history: insert-only for the app role.
GRANT SELECT, INSERT ON ticket_messages, ticket_attachments, files TO crm_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON ticket_messages, ticket_attachments, files FROM crm_app;
--> statement-breakpoint
-- Delivery status is updated by channel workers (Phase 8).
GRANT UPDATE (delivery_status) ON ticket_messages TO crm_app;
