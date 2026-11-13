CREATE TABLE "channel_connections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"external_account_id" text,
	"credentials" text,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"public_key" text,
	"last_error" text,
	"last_inbound_at" timestamp with time zone,
	"created_by_user_id" text,
	"disconnected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_connections_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "channel_connections_channel_chk" CHECK ("channel_connections"."channel" in ('webchat','email','whatsapp','messenger','instagram')),
	CONSTRAINT "channel_connections_status_chk" CHECK ("channel_connections"."status" in ('active','error','disconnected'))
);
--> statement-breakpoint
CREATE TABLE "conversation_attachments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_attachments_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "conversation_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"body" text NOT NULL,
	"author_user_id" text,
	"provider_message_id" text,
	"delivery_status" text NOT NULL,
	"error" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_messages_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "conversation_messages_direction_chk" CHECK ("conversation_messages"."direction" in ('inbound','outbound','note')),
	CONSTRAINT "conversation_messages_delivery_chk" CHECK ("conversation_messages"."delivery_status" in ('received','queued','sent','delivered','read','failed')),
	CONSTRAINT "conversation_messages_body_chk" CHECK (length("conversation_messages"."body") between 1 and 50000)
);
--> statement-breakpoint
CREATE TABLE "conversation_reads" (
	"organization_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"last_read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_reads_pk" PRIMARY KEY("conversation_id","membership_id")
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"channel" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"customer_id" uuid,
	"contact_handle" text NOT NULL,
	"contact_name" text,
	"contact_email" text,
	"subject" text,
	"status" text DEFAULT 'open' NOT NULL,
	"assignee_membership_id" uuid,
	"team_id" uuid,
	"ticket_id" uuid,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_inbound_at" timestamp with time zone,
	"last_outbound_at" timestamp with time zone,
	"last_preview" text,
	"window_expires_at" timestamp with time zone,
	"thread_key" text,
	"visitor_token_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "conversations_number_uq" UNIQUE("organization_id","number"),
	CONSTRAINT "conversations_status_chk" CHECK ("conversations"."status" in ('open','pending','closed'))
);
--> statement-breakpoint
CREATE TABLE "saved_replies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"created_by_user_id" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_replies_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "saved_replies_body_chk" CHECK (length("saved_replies"."body") between 1 and 5000)
);
--> statement-breakpoint
ALTER TABLE "channel_connections" ADD CONSTRAINT "channel_connections_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_connections" ADD CONSTRAINT "channel_connections_org_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_attachments" ADD CONSTRAINT "conversation_attachments_msg_fk" FOREIGN KEY ("organization_id","message_id") REFERENCES "public"."conversation_messages"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_attachments" ADD CONSTRAINT "conversation_attachments_file_fk" FOREIGN KEY ("organization_id","file_id") REFERENCES "public"."files"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_author_user_id_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_conv_fk" FOREIGN KEY ("organization_id","conversation_id") REFERENCES "public"."conversations"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_reads" ADD CONSTRAINT "conversation_reads_conv_fk" FOREIGN KEY ("organization_id","conversation_id") REFERENCES "public"."conversations"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_reads" ADD CONSTRAINT "conversation_reads_member_fk" FOREIGN KEY ("organization_id","membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_org_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_connection_fk" FOREIGN KEY ("organization_id","connection_id") REFERENCES "public"."channel_connections"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_customer_fk" FOREIGN KEY ("organization_id","customer_id") REFERENCES "public"."customers"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assignee_fk" FOREIGN KEY ("organization_id","assignee_membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_team_fk" FOREIGN KEY ("organization_id","team_id") REFERENCES "public"."teams"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_ticket_fk" FOREIGN KEY ("organization_id","ticket_id") REFERENCES "public"."support_tickets"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_replies" ADD CONSTRAINT "saved_replies_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_replies" ADD CONSTRAINT "saved_replies_org_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "channel_connections_public_key_uq" ON "channel_connections" USING btree ("public_key") WHERE "channel_connections"."public_key" is not null;--> statement-breakpoint
CREATE INDEX "conversation_attachments_msg_idx" ON "conversation_attachments" USING btree ("organization_id","message_id");--> statement-breakpoint
CREATE INDEX "conversation_messages_conv_idx" ON "conversation_messages" USING btree ("organization_id","conversation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_messages_provider_uq" ON "conversation_messages" USING btree ("connection_id","provider_message_id") WHERE "conversation_messages"."provider_message_id" is not null;--> statement-breakpoint
CREATE INDEX "conversations_queue_idx" ON "conversations" USING btree ("organization_id","status","last_message_at");--> statement-breakpoint
CREATE INDEX "conversations_assignee_idx" ON "conversations" USING btree ("organization_id","assignee_membership_id");--> statement-breakpoint
CREATE INDEX "conversations_contact_idx" ON "conversations" USING btree ("organization_id","connection_id","contact_handle");--> statement-breakpoint
CREATE INDEX "conversations_customer_idx" ON "conversations" USING btree ("organization_id","customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_visitor_uq" ON "conversations" USING btree ("visitor_token_hash") WHERE "conversations"."visitor_token_hash" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "saved_replies_title_uq" ON "saved_replies" USING btree ("organization_id",lower("title")) WHERE "saved_replies"."archived_at" is null;