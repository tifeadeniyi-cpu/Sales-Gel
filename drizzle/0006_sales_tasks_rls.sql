-- Phase 3: tenant RLS for sales + tasks, and owner/assignee FKs that null only their own column.
SELECT app_enable_tenant_rls('pipelines');
--> statement-breakpoint
SELECT app_enable_tenant_rls('pipeline_stages');
--> statement-breakpoint
SELECT app_enable_tenant_rls('leads');
--> statement-breakpoint
SELECT app_enable_tenant_rls('lead_stage_history');
--> statement-breakpoint
SELECT app_enable_tenant_rls('lead_products');
--> statement-breakpoint
SELECT app_enable_tenant_rls('tasks');
--> statement-breakpoint
SELECT app_enable_tenant_rls('task_relations');
--> statement-breakpoint
SELECT app_enable_tenant_rls('task_comments');
--> statement-breakpoint
ALTER TABLE leads ADD CONSTRAINT leads_owner_membership_fk
  FOREIGN KEY (organization_id, owner_membership_id) REFERENCES memberships (organization_id, id)
  ON DELETE SET NULL (owner_membership_id);
--> statement-breakpoint
ALTER TABLE tasks ADD CONSTRAINT tasks_assignee_membership_fk
  FOREIGN KEY (organization_id, assignee_membership_id) REFERENCES memberships (organization_id, id)
  ON DELETE SET NULL (assignee_membership_id);
--> statement-breakpoint
ALTER TABLE tasks ADD CONSTRAINT tasks_recurred_from_fk
  FOREIGN KEY (organization_id, recurred_from_id) REFERENCES tasks (organization_id, id)
  ON DELETE SET NULL (recurred_from_id);
--> statement-breakpoint
-- Stage history is append-only for the app role.
REVOKE UPDATE, DELETE ON lead_stage_history FROM crm_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON pipelines, pipeline_stages, leads, lead_products, tasks, task_relations, task_comments TO crm_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON lead_stage_history TO crm_app;
