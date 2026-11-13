CREATE TABLE "business_hours" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"timezone" text NOT NULL,
	"schedule" jsonb NOT NULL,
	"is_default" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_hours_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "holidays" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"business_hours_id" uuid NOT NULL,
	"date" date NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "holidays_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "holidays_date_uq" UNIQUE("business_hours_id","date")
);
--> statement-breakpoint
CREATE TABLE "portal_access_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"ticket_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portal_access_tokens_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "portal_routes" (
	"slug" text PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	CONSTRAINT "portal_routes_organization_id_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
CREATE TABLE "portal_submissions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"ip_hash" text NOT NULL,
	"email" text NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sla_policies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"is_active" integer DEFAULT 1 NOT NULL,
	"conditions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"targets" jsonb NOT NULL,
	"calendar" text DEFAULT 'business' NOT NULL,
	"escalate_on_breach" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sla_policies_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "sla_policies_calendar_chk" CHECK ("sla_policies"."calendar" in ('business','24x7'))
);
--> statement-breakpoint
CREATE TABLE "support_portals" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"enabled" integer DEFAULT 0 NOT NULL,
	"title" text NOT NULL,
	"welcome" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_portals_slug_chk" CHECK ("support_portals"."slug" ~ '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$')
);
--> statement-breakpoint
CREATE TABLE "team_assignment_cursors" (
	"organization_id" uuid NOT NULL,
	"team_id" uuid PRIMARY KEY NOT NULL,
	"last_membership_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_assignment_cursors_org_uq" UNIQUE("organization_id","team_id")
);
--> statement-breakpoint
CREATE TABLE "ticket_form_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"form_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"name" text NOT NULL,
	"fields" jsonb NOT NULL,
	"published_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_form_versions_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "ticket_form_versions_num_uq" UNIQUE("form_id","version")
);
--> statement-breakpoint
CREATE TABLE "ticket_forms" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"draft_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"current_version_id" uuid,
	"ticket_type_id" uuid,
	"priority" text DEFAULT 'normal' NOT NULL,
	"portal_visible" integer DEFAULT 1 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_forms_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "ticket_forms_priority_chk" CHECK ("ticket_forms"."priority" in ('low','normal','high','urgent'))
);
--> statement-breakpoint
CREATE TABLE "ticket_routing_rules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"is_active" integer DEFAULT 1 NOT NULL,
	"conditions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actions" jsonb NOT NULL,
	"matched_count" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_routing_rules_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "ticket_sla_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"ticket_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_sla_events_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "ticket_sla_events_kind_chk" CHECK ("ticket_sla_events"."kind" in ('applied','removed','first_response_met','first_response_breached','resolution_met','resolution_breached','paused','resumed','escalated'))
);
--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "sla_policy_id" uuid;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "first_response_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "resolution_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "first_response_breached_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "resolution_breached_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "sla_paused_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "sla_paused_minutes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "escalated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "form_version_id" uuid;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "business_hours" ADD CONSTRAINT "business_hours_org_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_calendar_fk" FOREIGN KEY ("organization_id","business_hours_id") REFERENCES "public"."business_hours"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_access_tokens" ADD CONSTRAINT "portal_access_tokens_ticket_fk" FOREIGN KEY ("organization_id","ticket_id") REFERENCES "public"."support_tickets"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_routes" ADD CONSTRAINT "portal_routes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_submissions" ADD CONSTRAINT "portal_submissions_org_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sla_policies" ADD CONSTRAINT "sla_policies_org_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_portals" ADD CONSTRAINT "support_portals_org_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_assignment_cursors" ADD CONSTRAINT "team_assignment_cursors_team_fk" FOREIGN KEY ("organization_id","team_id") REFERENCES "public"."teams"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_form_versions" ADD CONSTRAINT "ticket_form_versions_published_by_user_id_user_id_fk" FOREIGN KEY ("published_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_form_versions" ADD CONSTRAINT "ticket_form_versions_form_fk" FOREIGN KEY ("organization_id","form_id") REFERENCES "public"."ticket_forms"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_forms" ADD CONSTRAINT "ticket_forms_org_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_forms" ADD CONSTRAINT "ticket_forms_type_fk" FOREIGN KEY ("organization_id","ticket_type_id") REFERENCES "public"."ticket_types"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_routing_rules" ADD CONSTRAINT "ticket_routing_rules_org_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_sla_events" ADD CONSTRAINT "ticket_sla_events_ticket_fk" FOREIGN KEY ("organization_id","ticket_id") REFERENCES "public"."support_tickets"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "business_hours_default_uq" ON "business_hours" USING btree ("organization_id") WHERE "business_hours"."is_default" = 1;--> statement-breakpoint
CREATE UNIQUE INDEX "portal_access_tokens_hash_uq" ON "portal_access_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "portal_access_tokens_ticket_idx" ON "portal_access_tokens" USING btree ("organization_id","ticket_id");--> statement-breakpoint
CREATE INDEX "portal_submissions_recent_idx" ON "portal_submissions" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_forms_name_uq" ON "ticket_forms" USING btree ("organization_id",lower("name")) WHERE "ticket_forms"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "ticket_sla_events_ticket_idx" ON "ticket_sla_events" USING btree ("organization_id","ticket_id","created_at");--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_sla_fk" FOREIGN KEY ("organization_id","sla_policy_id") REFERENCES "public"."sla_policies"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_form_version_fk" FOREIGN KEY ("organization_id","form_version_id") REFERENCES "public"."ticket_form_versions"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "support_tickets_sla_due_idx" ON "support_tickets" USING btree ("organization_id","resolution_due_at") WHERE "support_tickets"."resolution_breached_at" is null;