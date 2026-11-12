CREATE TABLE "files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"storage" text DEFAULT 'db' NOT NULL,
	"storage_key" text,
	"content" "bytea",
	"uploaded_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "files_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "files_size_chk" CHECK ("files"."size_bytes" between 1 and 10485760),
	CONSTRAINT "files_storage_chk" CHECK (("files"."storage" = 'db' and "files"."content" is not null) or ("files"."storage" <> 'db' and "files"."storage_key" is not null))
);
--> statement-breakpoint
CREATE TABLE "support_tickets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"subject" text NOT NULL,
	"description" text,
	"customer_id" uuid,
	"channel" text DEFAULT 'manual' NOT NULL,
	"ticket_type_id" uuid,
	"status_id" uuid NOT NULL,
	"status_category" text NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"assignee_membership_id" uuid,
	"team_id" uuid,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"contact_email" text,
	"contact_phone" text,
	"first_responded_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"reopened_count" integer DEFAULT 0 NOT NULL,
	"resolution_category" text,
	"resolution_note" text,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_customer_message_at" timestamp with time zone,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_tickets_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "support_tickets_number_uq" UNIQUE("organization_id","number"),
	CONSTRAINT "support_tickets_priority_chk" CHECK ("support_tickets"."priority" in ('low','normal','high','urgent')),
	CONSTRAINT "support_tickets_category_chk" CHECK ("support_tickets"."status_category" in ('new','open','pending_customer','pending_internal','escalated','resolved','closed')),
	CONSTRAINT "support_tickets_subject_chk" CHECK (length(btrim("support_tickets"."subject")) between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "ticket_attachments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"ticket_id" uuid NOT NULL,
	"message_id" uuid,
	"file_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_attachments_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "ticket_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"ticket_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"body" text NOT NULL,
	"author_user_id" text,
	"channel" text,
	"delivery_status" text DEFAULT 'not_sent' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_messages_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "ticket_messages_kind_chk" CHECK ("ticket_messages"."kind" in ('reply','note','customer')),
	CONSTRAINT "ticket_messages_delivery_chk" CHECK ("ticket_messages"."delivery_status" in ('not_sent','queued','sent','delivered','failed','received')),
	CONSTRAINT "ticket_messages_body_chk" CHECK (length("ticket_messages"."body") between 1 and 20000)
);
--> statement-breakpoint
CREATE TABLE "ticket_record_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"ticket_id" uuid NOT NULL,
	"order_id" uuid,
	"lead_id" uuid,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_record_links_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "ticket_record_links_one_chk" CHECK (num_nonnulls("ticket_record_links"."order_id", "ticket_record_links"."lead_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "ticket_statuses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"color" text DEFAULT '#64748b' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"is_default" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_statuses_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "ticket_statuses_category_chk" CHECK ("ticket_statuses"."category" in ('new','open','pending_customer','pending_internal','escalated','resolved','closed'))
);
--> statement-breakpoint
CREATE TABLE "ticket_types" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_types_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_uploaded_by_user_id_user_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_org_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_org_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_customer_fk" FOREIGN KEY ("organization_id","customer_id") REFERENCES "public"."customers"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_status_fk" FOREIGN KEY ("organization_id","status_id") REFERENCES "public"."ticket_statuses"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_type_fk" FOREIGN KEY ("organization_id","ticket_type_id") REFERENCES "public"."ticket_types"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_attachments" ADD CONSTRAINT "ticket_attachments_ticket_fk" FOREIGN KEY ("organization_id","ticket_id") REFERENCES "public"."support_tickets"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_attachments" ADD CONSTRAINT "ticket_attachments_message_fk" FOREIGN KEY ("organization_id","message_id") REFERENCES "public"."ticket_messages"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_attachments" ADD CONSTRAINT "ticket_attachments_file_fk" FOREIGN KEY ("organization_id","file_id") REFERENCES "public"."files"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_author_user_id_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_ticket_fk" FOREIGN KEY ("organization_id","ticket_id") REFERENCES "public"."support_tickets"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_record_links" ADD CONSTRAINT "ticket_record_links_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_record_links" ADD CONSTRAINT "ticket_record_links_ticket_fk" FOREIGN KEY ("organization_id","ticket_id") REFERENCES "public"."support_tickets"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_record_links" ADD CONSTRAINT "ticket_record_links_order_fk" FOREIGN KEY ("organization_id","order_id") REFERENCES "public"."orders"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_record_links" ADD CONSTRAINT "ticket_record_links_lead_fk" FOREIGN KEY ("organization_id","lead_id") REFERENCES "public"."leads"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_statuses" ADD CONSTRAINT "ticket_statuses_org_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_types" ADD CONSTRAINT "ticket_types_org_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "support_tickets_queue_idx" ON "support_tickets" USING btree ("organization_id","status_category","last_activity_at");--> statement-breakpoint
CREATE INDEX "support_tickets_assignee_idx" ON "support_tickets" USING btree ("organization_id","assignee_membership_id");--> statement-breakpoint
CREATE INDEX "support_tickets_customer_idx" ON "support_tickets" USING btree ("organization_id","customer_id");--> statement-breakpoint
CREATE INDEX "support_tickets_subject_trgm" ON "support_tickets" USING gin ("subject" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "ticket_attachments_ticket_idx" ON "ticket_attachments" USING btree ("organization_id","ticket_id");--> statement-breakpoint
CREATE INDEX "ticket_messages_ticket_idx" ON "ticket_messages" USING btree ("organization_id","ticket_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_record_links_order_uq" ON "ticket_record_links" USING btree ("ticket_id","order_id") WHERE "ticket_record_links"."order_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_record_links_lead_uq" ON "ticket_record_links" USING btree ("ticket_id","lead_id") WHERE "ticket_record_links"."lead_id" is not null;--> statement-breakpoint
CREATE INDEX "ticket_record_links_order_idx" ON "ticket_record_links" USING btree ("organization_id","order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_statuses_name_uq" ON "ticket_statuses" USING btree ("organization_id",lower("name")) WHERE "ticket_statuses"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_statuses_default_uq" ON "ticket_statuses" USING btree ("organization_id") WHERE "ticket_statuses"."is_default" = 1;--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_types_name_uq" ON "ticket_types" USING btree ("organization_id",lower("name")) WHERE "ticket_types"."archived_at" is null;