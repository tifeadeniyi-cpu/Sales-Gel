CREATE TABLE "call_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"call_id" uuid NOT NULL,
	"event_key" text NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "call_legs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"call_id" uuid NOT NULL,
	"provider_call_sid" text NOT NULL,
	"kind" text NOT NULL,
	"target" text NOT NULL,
	"membership_id" uuid,
	"status" text DEFAULT 'queued' NOT NULL,
	"last_sequence" integer DEFAULT -1 NOT NULL,
	"answered_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"duration_sec" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "call_legs_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "call_legs_kind_chk" CHECK ("call_legs"."kind" in ('customer','agent','pstn'))
);
--> statement-breakpoint
CREATE TABLE "call_notes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"call_id" uuid NOT NULL,
	"body" text NOT NULL,
	"author_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "call_notes_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "call_notes_body_chk" CHECK (length("call_notes"."body") between 1 and 5000)
);
--> statement-breakpoint
CREATE TABLE "call_voicemails" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"call_id" uuid NOT NULL,
	"recording_sid" text NOT NULL,
	"duration_sec" integer,
	"status" text DEFAULT 'new' NOT NULL,
	"assigned_membership_id" uuid,
	"reviewed_by_user_id" text,
	"reviewed_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "call_voicemails_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "call_voicemails_status_chk" CHECK ("call_voicemails"."status" in ('new','reviewed','archived'))
);
--> statement-breakpoint
CREATE TABLE "calls" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"account_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"provider_call_sid" text NOT NULL,
	"from_e164" text NOT NULL,
	"to_e164" text NOT NULL,
	"business_number_id" uuid,
	"customer_id" uuid,
	"agent_membership_id" uuid,
	"queue_id" uuid,
	"status" text DEFAULT 'queued' NOT NULL,
	"outcome" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"answered_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"duration_sec" integer,
	"price_micros" integer,
	"price_currency" text,
	"lead_id" uuid,
	"order_id" uuid,
	"ticket_id" uuid,
	"had_voicemail" integer DEFAULT 0 NOT NULL,
	"last_event_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calls_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "calls_number_uq" UNIQUE("organization_id","number"),
	CONSTRAINT "calls_direction_chk" CHECK ("calls"."direction" in ('inbound','outbound')),
	CONSTRAINT "calls_status_chk" CHECK ("calls"."status" in ('queued','ringing','in_progress','completed','busy','no_answer','failed','canceled'))
);
--> statement-breakpoint
CREATE TABLE "phone_agents" (
	"organization_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"status" text DEFAULT 'offline' NOT NULL,
	"active_call_id" uuid,
	"last_seen_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "phone_agents_pk" PRIMARY KEY("organization_id","membership_id"),
	CONSTRAINT "phone_agents_status_chk" CHECK ("phone_agents"."status" in ('available','busy','away','offline','dnd'))
);
--> statement-breakpoint
CREATE TABLE "phone_numbers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"provider_sid" text NOT NULL,
	"e164" text NOT NULL,
	"label" text,
	"locality" text,
	"region" text,
	"capabilities" jsonb NOT NULL,
	"routing" jsonb DEFAULT '{"type":"voicemail"}'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"released_at" timestamp with time zone,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "phone_numbers_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "phone_numbers_status_chk" CHECK ("phone_numbers"."status" in ('active','released'))
);
--> statement-breakpoint
CREATE TABLE "phone_queue_members" (
	"organization_id" uuid NOT NULL,
	"queue_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"last_offered_at" timestamp with time zone,
	CONSTRAINT "phone_queue_members_pk" PRIMARY KEY("queue_id","membership_id")
);
--> statement-breakpoint
CREATE TABLE "phone_queues" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"strategy" text DEFAULT 'simultaneous' NOT NULL,
	"ring_timeout_sec" integer DEFAULT 20 NOT NULL,
	"fallback" text DEFAULT 'voicemail' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "phone_queues_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "phone_queues_strategy_chk" CHECK ("phone_queues"."strategy" in ('simultaneous','round_robin')),
	CONSTRAINT "phone_queues_fallback_chk" CHECK ("phone_queues"."fallback" in ('voicemail','hangup')),
	CONSTRAINT "phone_queues_timeout_chk" CHECK ("phone_queues"."ring_timeout_sec" between 5 and 120)
);
--> statement-breakpoint
CREATE TABLE "phone_usage_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"call_id" uuid,
	"provider_sid" text NOT NULL,
	"category" text NOT NULL,
	"price_micros" integer NOT NULL,
	"currency" text NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telecom_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider" text DEFAULT 'twilio' NOT NULL,
	"provider_account_sid" text NOT NULL,
	"credentials" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"settings" jsonb NOT NULL,
	"last_error" text,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "telecom_accounts_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "telecom_accounts_status_chk" CHECK ("telecom_accounts"."status" in ('active','suspended','error','closed'))
);
--> statement-breakpoint
ALTER TABLE "call_events" ADD CONSTRAINT "call_events_call_fk" FOREIGN KEY ("organization_id","call_id") REFERENCES "public"."calls"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_legs" ADD CONSTRAINT "call_legs_call_fk" FOREIGN KEY ("organization_id","call_id") REFERENCES "public"."calls"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_notes" ADD CONSTRAINT "call_notes_author_user_id_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_notes" ADD CONSTRAINT "call_notes_call_fk" FOREIGN KEY ("organization_id","call_id") REFERENCES "public"."calls"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_voicemails" ADD CONSTRAINT "call_voicemails_reviewed_by_user_id_user_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_voicemails" ADD CONSTRAINT "call_voicemails_call_fk" FOREIGN KEY ("organization_id","call_id") REFERENCES "public"."calls"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_voicemails" ADD CONSTRAINT "call_voicemails_assignee_fk" FOREIGN KEY ("organization_id","assigned_membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_account_fk" FOREIGN KEY ("organization_id","account_id") REFERENCES "public"."telecom_accounts"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_number_fk" FOREIGN KEY ("organization_id","business_number_id") REFERENCES "public"."phone_numbers"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_customer_fk" FOREIGN KEY ("organization_id","customer_id") REFERENCES "public"."customers"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_agent_fk" FOREIGN KEY ("organization_id","agent_membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_queue_fk" FOREIGN KEY ("organization_id","queue_id") REFERENCES "public"."phone_queues"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_lead_fk" FOREIGN KEY ("organization_id","lead_id") REFERENCES "public"."leads"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_order_fk" FOREIGN KEY ("organization_id","order_id") REFERENCES "public"."orders"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_ticket_fk" FOREIGN KEY ("organization_id","ticket_id") REFERENCES "public"."support_tickets"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phone_agents" ADD CONSTRAINT "phone_agents_member_fk" FOREIGN KEY ("organization_id","membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phone_numbers" ADD CONSTRAINT "phone_numbers_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phone_numbers" ADD CONSTRAINT "phone_numbers_account_fk" FOREIGN KEY ("organization_id","account_id") REFERENCES "public"."telecom_accounts"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phone_queue_members" ADD CONSTRAINT "phone_queue_members_queue_fk" FOREIGN KEY ("organization_id","queue_id") REFERENCES "public"."phone_queues"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phone_queue_members" ADD CONSTRAINT "phone_queue_members_member_fk" FOREIGN KEY ("organization_id","membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phone_queues" ADD CONSTRAINT "phone_queues_org_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phone_usage_records" ADD CONSTRAINT "phone_usage_records_org_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telecom_accounts" ADD CONSTRAINT "telecom_accounts_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telecom_accounts" ADD CONSTRAINT "telecom_accounts_org_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "call_events_key_uq" ON "call_events" USING btree ("organization_id","event_key");--> statement-breakpoint
CREATE INDEX "call_events_call_idx" ON "call_events" USING btree ("organization_id","call_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "call_legs_sid_uq" ON "call_legs" USING btree ("call_id","provider_call_sid");--> statement-breakpoint
CREATE INDEX "call_notes_call_idx" ON "call_notes" USING btree ("organization_id","call_id");--> statement-breakpoint
CREATE UNIQUE INDEX "call_voicemails_sid_uq" ON "call_voicemails" USING btree ("recording_sid");--> statement-breakpoint
CREATE INDEX "call_voicemails_status_idx" ON "call_voicemails" USING btree ("organization_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "calls_provider_uq" ON "calls" USING btree ("account_id","provider_call_sid");--> statement-breakpoint
CREATE INDEX "calls_recent_idx" ON "calls" USING btree ("organization_id","started_at");--> statement-breakpoint
CREATE INDEX "calls_customer_idx" ON "calls" USING btree ("organization_id","customer_id");--> statement-breakpoint
CREATE INDEX "calls_agent_idx" ON "calls" USING btree ("organization_id","agent_membership_id");--> statement-breakpoint
CREATE UNIQUE INDEX "phone_numbers_sid_uq" ON "phone_numbers" USING btree ("provider_sid");--> statement-breakpoint
CREATE UNIQUE INDEX "phone_numbers_active_e164_uq" ON "phone_numbers" USING btree ("e164") WHERE "phone_numbers"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "phone_queues_name_uq" ON "phone_queues" USING btree ("organization_id",lower("name")) WHERE "phone_queues"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "phone_usage_records_sid_uq" ON "phone_usage_records" USING btree ("organization_id","provider_sid");--> statement-breakpoint
CREATE INDEX "phone_usage_records_day_idx" ON "phone_usage_records" USING btree ("organization_id","recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "telecom_accounts_org_uq" ON "telecom_accounts" USING btree ("organization_id") WHERE "telecom_accounts"."status" <> 'closed';--> statement-breakpoint
CREATE UNIQUE INDEX "telecom_accounts_sid_uq" ON "telecom_accounts" USING btree ("provider","provider_account_sid");