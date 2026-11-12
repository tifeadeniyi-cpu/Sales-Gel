SELECT app_enable_tenant_rls('dashboard_layouts');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON dashboard_layouts TO crm_app;
