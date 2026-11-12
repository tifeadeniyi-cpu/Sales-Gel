-- Tenant isolation: Row Level Security as defense in depth.
-- The runtime role `crm_app` (NOSUPERUSER, NOBYPASSRLS) is created by scripts/db-bootstrap.ts
-- (dev/CI) or by ops (production) before migrations run.

CREATE OR REPLACE FUNCTION app_current_org() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.org_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_current_user() RETURNS text
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.user_id', true), '') $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_enable_tenant_rls(t regclass) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', t);
  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %s', t);
  EXECUTE format(
    'CREATE POLICY tenant_isolation ON %s USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org())',
    t
  );
END $$;
--> statement-breakpoint

-- Standard org-scoped tables
SELECT app_enable_tenant_rls('roles');
--> statement-breakpoint
SELECT app_enable_tenant_rls('role_permissions');
--> statement-breakpoint
SELECT app_enable_tenant_rls('teams');
--> statement-breakpoint
SELECT app_enable_tenant_rls('team_members');
--> statement-breakpoint
SELECT app_enable_tenant_rls('org_sequences');
--> statement-breakpoint
SELECT app_enable_tenant_rls('audit_logs');
--> statement-breakpoint
SELECT app_enable_tenant_rls('notifications');
--> statement-breakpoint
SELECT app_enable_tenant_rls('notification_preferences');
--> statement-breakpoint
SELECT app_enable_tenant_rls('outbox_events');
--> statement-breakpoint

-- memberships: visible within the current org, or the caller's own memberships (org switcher).
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY memberships_read ON memberships FOR SELECT
  USING (organization_id = app_current_org() OR user_id = app_current_user());
--> statement-breakpoint
CREATE POLICY memberships_write ON memberships FOR ALL
  USING (organization_id = app_current_org())
  WITH CHECK (organization_id = app_current_org());
--> statement-breakpoint

-- organizations: the current org, or any org the caller is an active member of.
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY organizations_read ON organizations FOR SELECT
  USING (
    id = app_current_org()
    OR EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.organization_id = organizations.id
        AND m.user_id = app_current_user()
        AND m.status = 'active'
    )
  );
--> statement-breakpoint
CREATE POLICY organizations_write ON organizations FOR ALL
  USING (id = app_current_org())
  WITH CHECK (id = app_current_org());
--> statement-breakpoint

-- invitations: current org, or exactly the invitation whose token hash the caller presents.
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE invitations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY invitations_read ON invitations FOR SELECT
  USING (
    organization_id = app_current_org()
    OR token_hash = nullif(current_setting('app.invite_token_hash', true), '')
  );
--> statement-breakpoint
CREATE POLICY invitations_write ON invitations FOR ALL
  USING (organization_id = app_current_org())
  WITH CHECK (organization_id = app_current_org());
--> statement-breakpoint

-- Grants for the runtime role
GRANT USAGE ON SCHEMA public TO crm_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO crm_app;
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON permissions FROM crm_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON audit_logs FROM crm_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO crm_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_current_org(), app_current_user() TO crm_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_enable_tenant_rls(regclass) FROM PUBLIC;
