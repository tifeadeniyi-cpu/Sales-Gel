-- Phase 8: unified inbox.
SELECT app_enable_tenant_rls('channel_connections');
--> statement-breakpoint
SELECT app_enable_tenant_rls('conversations');
--> statement-breakpoint
SELECT app_enable_tenant_rls('conversation_messages');
--> statement-breakpoint
SELECT app_enable_tenant_rls('conversation_attachments');
--> statement-breakpoint
SELECT app_enable_tenant_rls('conversation_reads');
--> statement-breakpoint
SELECT app_enable_tenant_rls('saved_replies');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON channel_connections, conversations, conversation_messages, conversation_attachments, conversation_reads, saved_replies TO crm_app;
--> statement-breakpoint
-- Message history is append-only: only delivery tracking can change.
REVOKE UPDATE, DELETE ON conversation_messages FROM crm_app;
--> statement-breakpoint
GRANT UPDATE (delivery_status, error, sent_at, provider_message_id) ON conversation_messages TO crm_app;
