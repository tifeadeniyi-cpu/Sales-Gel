-- Phase 6: integrations, webhooks, payment links and the job queue.
SELECT app_enable_tenant_rls('integration_connections');
--> statement-breakpoint
SELECT app_enable_tenant_rls('webhook_events');
--> statement-breakpoint
SELECT app_enable_tenant_rls('external_record_mappings');
--> statement-breakpoint
SELECT app_enable_tenant_rls('payment_links');
--> statement-breakpoint
SELECT app_enable_tenant_rls('jobs');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON integration_connections, webhook_events, external_record_mappings, payment_links, jobs TO crm_app;
--> statement-breakpoint
-- Routing and work-index tables hold no tenant data; the app reads them before a tenant scope exists.
GRANT SELECT, INSERT, UPDATE, DELETE ON integration_routes, org_work_signals TO crm_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_signal_work() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE due timestamptz;
BEGIN
  due := CASE WHEN TG_TABLE_NAME = 'jobs' THEN NEW.run_at ELSE NEW.available_at END;
  INSERT INTO org_work_signals (organization_id, due_at) VALUES (NEW.organization_id, due)
  ON CONFLICT (organization_id) DO UPDATE SET due_at = LEAST(org_work_signals.due_at, EXCLUDED.due_at);
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER jobs_signal_work AFTER INSERT OR UPDATE OF run_at, status ON jobs
  FOR EACH ROW WHEN (NEW.status = 'pending') EXECUTE FUNCTION app_signal_work();
--> statement-breakpoint
CREATE TRIGGER outbox_signal_work AFTER INSERT ON outbox_events
  FOR EACH ROW EXECUTE FUNCTION app_signal_work();
