CREATE TABLE "external_record_mappings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"external_type" text NOT NULL,
	"external_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"external_updated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_record_mappings_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "integration_connections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"external_account_id" text NOT NULL,
	"display_name" text,
	"credentials" text NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_error" text,
	"connected_by_user_id" text,
	"disconnected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_connections_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "integration_connections_provider_chk" CHECK ("integration_connections"."provider" in ('stripe','shopify')),
	CONSTRAINT "integration_connections_status_chk" CHECK ("integration_connections"."status" in ('active','error','disconnected'))
);
--> statement-breakpoint
CREATE TABLE "integration_routes" (
	"provider" text NOT NULL,
	"external_account_id" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	CONSTRAINT "integration_routes_pk" PRIMARY KEY("provider","external_account_id")
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_until" timestamp with time zone,
	"idempotency_key" text,
	"last_error" text,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "jobs_status_chk" CHECK ("jobs"."status" in ('pending','running','done','failed'))
);
--> statement-breakpoint
CREATE TABLE "org_work_signals" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"due_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_session_id" text NOT NULL,
	"url" text NOT NULL,
	"amount" bigint NOT NULL,
	"currency" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"expires_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_links_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "payment_links_status_chk" CHECK ("payment_links"."status" in ('open','paid','expired','failed','cancelled')),
	CONSTRAINT "payment_links_amount_chk" CHECK ("payment_links"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"topic" text NOT NULL,
	"signature_verified" boolean NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "webhook_events_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "webhook_events_status_chk" CHECK ("webhook_events"."status" in ('received','processed','ignored','failed'))
);
--> statement-breakpoint
ALTER TABLE "external_record_mappings" ADD CONSTRAINT "external_record_mappings_connection_fk" FOREIGN KEY ("organization_id","connection_id") REFERENCES "public"."integration_connections"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_connected_by_user_id_user_id_fk" FOREIGN KEY ("connected_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_org_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_routes" ADD CONSTRAINT "integration_routes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_org_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_work_signals" ADD CONSTRAINT "org_work_signals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_order_fk" FOREIGN KEY ("organization_id","order_id") REFERENCES "public"."orders"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_connection_fk" FOREIGN KEY ("organization_id","connection_id") REFERENCES "public"."integration_connections"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_org_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_connection_fk" FOREIGN KEY ("organization_id","connection_id") REFERENCES "public"."integration_connections"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "external_record_mappings_uq" ON "external_record_mappings" USING btree ("connection_id","external_type","external_id");--> statement-breakpoint
CREATE INDEX "external_record_mappings_entity_idx" ON "external_record_mappings" USING btree ("organization_id","entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_connections_active_uq" ON "integration_connections" USING btree ("organization_id","provider") WHERE "integration_connections"."status" <> 'disconnected';--> statement-breakpoint
CREATE UNIQUE INDEX "integration_routes_connection_uq" ON "integration_routes" USING btree ("connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_idempotency_uq" ON "jobs" USING btree ("organization_id","idempotency_key") WHERE "jobs"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "jobs_due_idx" ON "jobs" USING btree ("organization_id","status","run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_links_session_uq" ON "payment_links" USING btree ("provider","provider_session_id");--> statement-breakpoint
CREATE INDEX "payment_links_order_idx" ON "payment_links" USING btree ("organization_id","order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_events_dedupe_uq" ON "webhook_events" USING btree ("connection_id","provider_event_id");--> statement-breakpoint
CREATE INDEX "webhook_events_status_idx" ON "webhook_events" USING btree ("organization_id","status","created_at");