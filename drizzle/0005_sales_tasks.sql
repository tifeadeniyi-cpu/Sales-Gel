CREATE TABLE "lead_products" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"product_id" uuid,
	"name" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_products_qty_chk" CHECK ("lead_products"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "lead_stage_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"from_stage_id" uuid,
	"to_stage_id" uuid NOT NULL,
	"changed_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"number" bigint NOT NULL,
	"title" text NOT NULL,
	"customer_id" uuid,
	"pipeline_id" uuid NOT NULL,
	"stage_id" uuid NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"value_amount" bigint,
	"currency" text NOT NULL,
	"source" text,
	"probability" integer,
	"priority" text DEFAULT 'medium' NOT NULL,
	"owner_membership_id" uuid,
	"expected_close_date" date,
	"notes" text,
	"position" double precision DEFAULT 0 NOT NULL,
	"closed_at" timestamp with time zone,
	"lost_reason" text,
	"archived_at" timestamp with time zone,
	"last_activity_at" timestamp with time zone,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leads_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "leads_org_number_uq" UNIQUE("organization_id","number"),
	CONSTRAINT "leads_status_chk" CHECK ("leads"."status" in ('open','won','lost')),
	CONSTRAINT "leads_priority_chk" CHECK ("leads"."priority" in ('low','medium','high','urgent')),
	CONSTRAINT "leads_currency_chk" CHECK ("leads"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "leads_probability_chk" CHECK ("leads"."probability" is null or "leads"."probability" between 0 and 100),
	CONSTRAINT "leads_value_chk" CHECK ("leads"."value_amount" is null or "leads"."value_amount" >= 0),
	CONSTRAINT "leads_closed_chk" CHECK (("leads"."status" = 'open') = ("leads"."closed_at" is null))
);
--> statement-breakpoint
CREATE TABLE "pipeline_stages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"pipeline_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"color" text DEFAULT 'teal' NOT NULL,
	"probability" integer DEFAULT 0 NOT NULL,
	"category" text DEFAULT 'open' NOT NULL,
	"required_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pipeline_stages_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "pipeline_stages_pipeline_id_uq" UNIQUE("organization_id","pipeline_id","id"),
	CONSTRAINT "pipeline_stages_category_chk" CHECK ("pipeline_stages"."category" in ('open','won','lost')),
	CONSTRAINT "pipeline_stages_probability_chk" CHECK ("pipeline_stages"."probability" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "pipelines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pipelines_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "task_comments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"author_user_id" text,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_relations" (
	"organization_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	CONSTRAINT "task_relations_task_id_entity_type_entity_id_pk" PRIMARY KEY("task_id","entity_type","entity_id"),
	CONSTRAINT "task_relations_type_chk" CHECK ("task_relations"."entity_type" in ('customer','lead','order','ticket'))
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'todo' NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"assignee_membership_id" uuid,
	"created_by_user_id" text,
	"due_at" timestamp with time zone,
	"reminder_at" timestamp with time zone,
	"recurrence" text DEFAULT 'none' NOT NULL,
	"recurred_from_id" uuid,
	"completed_at" timestamp with time zone,
	"completed_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "tasks_status_chk" CHECK ("tasks"."status" in ('todo','in_progress','done')),
	CONSTRAINT "tasks_priority_chk" CHECK ("tasks"."priority" in ('low','medium','high','urgent')),
	CONSTRAINT "tasks_recurrence_chk" CHECK ("tasks"."recurrence" in ('none','daily','weekly','monthly')),
	CONSTRAINT "tasks_done_chk" CHECK (("tasks"."status" = 'done') = ("tasks"."completed_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "lead_products" ADD CONSTRAINT "lead_products_lead_fk" FOREIGN KEY ("organization_id","lead_id") REFERENCES "public"."leads"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_stage_history" ADD CONSTRAINT "lead_stage_history_changed_by_user_id_user_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_stage_history" ADD CONSTRAINT "lead_stage_history_lead_fk" FOREIGN KEY ("organization_id","lead_id") REFERENCES "public"."leads"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_stage_history" ADD CONSTRAINT "lead_stage_history_to_fk" FOREIGN KEY ("organization_id","to_stage_id") REFERENCES "public"."pipeline_stages"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_stage_history" ADD CONSTRAINT "lead_stage_history_from_fk" FOREIGN KEY ("organization_id","from_stage_id") REFERENCES "public"."pipeline_stages"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_customer_fk" FOREIGN KEY ("organization_id","customer_id") REFERENCES "public"."customers"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_stage_fk" FOREIGN KEY ("organization_id","pipeline_id","stage_id") REFERENCES "public"."pipeline_stages"("organization_id","pipeline_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_pipeline_fk" FOREIGN KEY ("organization_id","pipeline_id") REFERENCES "public"."pipelines"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_org_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_author_user_id_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_task_fk" FOREIGN KEY ("organization_id","task_id") REFERENCES "public"."tasks"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_relations" ADD CONSTRAINT "task_relations_task_fk" FOREIGN KEY ("organization_id","task_id") REFERENCES "public"."tasks"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_completed_by_user_id_user_id_fk" FOREIGN KEY ("completed_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_org_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lead_products_lead_idx" ON "lead_products" USING btree ("organization_id","lead_id");--> statement-breakpoint
CREATE INDEX "lead_stage_history_lead_idx" ON "lead_stage_history" USING btree ("organization_id","lead_id","created_at");--> statement-breakpoint
CREATE INDEX "leads_board_idx" ON "leads" USING btree ("organization_id","pipeline_id","stage_id","position");--> statement-breakpoint
CREATE INDEX "leads_owner_idx" ON "leads" USING btree ("organization_id","owner_membership_id");--> statement-breakpoint
CREATE INDEX "leads_customer_idx" ON "leads" USING btree ("organization_id","customer_id");--> statement-breakpoint
CREATE INDEX "leads_title_trgm" ON "leads" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "pipeline_stages_pipeline_idx" ON "pipeline_stages" USING btree ("organization_id","pipeline_id","position");--> statement-breakpoint
CREATE INDEX "task_comments_task_idx" ON "task_comments" USING btree ("organization_id","task_id","created_at");--> statement-breakpoint
CREATE INDEX "task_relations_entity_idx" ON "task_relations" USING btree ("organization_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "tasks_assignee_idx" ON "tasks" USING btree ("organization_id","assignee_membership_id","status","due_at");--> statement-breakpoint
CREATE INDEX "tasks_due_idx" ON "tasks" USING btree ("organization_id","status","due_at");