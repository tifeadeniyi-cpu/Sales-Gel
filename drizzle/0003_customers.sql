CREATE TABLE "custom_field_definitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"entity" text NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"type" text NOT NULL,
	"options" jsonb,
	"required" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custom_fields_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "custom_fields_key_uq" UNIQUE("organization_id","entity","key"),
	CONSTRAINT "custom_fields_entity_chk" CHECK ("custom_field_definitions"."entity" in ('customer','lead','order','ticket')),
	CONSTRAINT "custom_fields_type_chk" CHECK ("custom_field_definitions"."type" in ('text','number','date','select','boolean')),
	CONSTRAINT "custom_fields_key_chk" CHECK ("custom_field_definitions"."key" ~ '^[a-z][a-z0-9_]{0,39}$')
);
--> statement-breakpoint
CREATE TABLE "customer_addresses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"label" text,
	"line1" text NOT NULL,
	"line2" text,
	"city" text,
	"region" text,
	"postal_code" text,
	"country" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_addresses_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "customer_addresses_kind_chk" CHECK ("customer_addresses"."kind" in ('billing','shipping'))
);
--> statement-breakpoint
CREATE TABLE "customer_consents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"status" text NOT NULL,
	"source" text NOT NULL,
	"note" text,
	"recorded_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_consents_channel_chk" CHECK ("customer_consents"."channel" in ('email','sms','whatsapp')),
	CONSTRAINT "customer_consents_status_chk" CHECK ("customer_consents"."status" in ('granted','revoked'))
);
--> statement-breakpoint
CREATE TABLE "customer_duplicate_dismissals" (
	"organization_id" uuid NOT NULL,
	"customer_a_id" uuid NOT NULL,
	"customer_b_id" uuid NOT NULL,
	"dismissed_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_duplicate_dismissals_organization_id_customer_a_id_customer_b_id_pk" PRIMARY KEY("organization_id","customer_a_id","customer_b_id"),
	CONSTRAINT "customer_dup_order_chk" CHECK ("customer_duplicate_dismissals"."customer_a_id" < "customer_duplicate_dismissals"."customer_b_id")
);
--> statement-breakpoint
CREATE TABLE "customer_emails" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"email" text NOT NULL,
	"normalized_email" text NOT NULL,
	"label" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_emails_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "customer_emails_customer_email_uq" UNIQUE("customer_id","normalized_email")
);
--> statement-breakpoint
CREATE TABLE "customer_identities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"handle" text,
	"normalized_handle" text,
	"external_id" text,
	"provider_account_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_identities_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "customer_identities_provider_chk" CHECK ("customer_identities"."provider" in ('instagram','facebook','whatsapp','tiktok','x','shopify','other')),
	CONSTRAINT "customer_identities_value_chk" CHECK ("customer_identities"."handle" is not null or "customer_identities"."external_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "customer_merges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"survivor_id" uuid NOT NULL,
	"merged_id" uuid NOT NULL,
	"snapshot" jsonb NOT NULL,
	"merged_by_user_id" text,
	"reverted_at" timestamp with time zone,
	"reverted_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_merges_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "customer_notes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"author_user_id" text,
	"body" text NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_notes_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "customer_phones" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"phone" text NOT NULL,
	"e164" text NOT NULL,
	"label" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_phones_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "customer_phones_customer_phone_uq" UNIQUE("customer_id","e164")
);
--> statement-breakpoint
CREATE TABLE "customer_tags" (
	"organization_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_tags_customer_id_tag_id_pk" PRIMARY KEY("customer_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"number" bigint NOT NULL,
	"type" text DEFAULT 'person' NOT NULL,
	"first_name" text,
	"last_name" text,
	"display_name" text NOT NULL,
	"company_name" text,
	"source" text,
	"owner_membership_id" uuid,
	"preferred_channel" text,
	"preferred_currency" text,
	"email_marketing" text DEFAULT 'unknown' NOT NULL,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"merged_into_id" uuid,
	"archived_at" timestamp with time zone,
	"last_activity_at" timestamp with time zone,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "customers_org_number_uq" UNIQUE("organization_id","number"),
	CONSTRAINT "customers_type_chk" CHECK ("customers"."type" in ('person','business')),
	CONSTRAINT "customers_status_chk" CHECK ("customers"."status" in ('provisional','active','archived','merged')),
	CONSTRAINT "customers_email_marketing_chk" CHECK ("customers"."email_marketing" in ('unknown','subscribed','unsubscribed')),
	CONSTRAINT "customers_currency_chk" CHECK ("customers"."preferred_currency" is null or "customers"."preferred_currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "customers_merged_chk" CHECK (("customers"."status" = 'merged') = ("customers"."merged_into_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT 'teal' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tags_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
ALTER TABLE "custom_field_definitions" ADD CONSTRAINT "custom_fields_org_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_customer_fk" FOREIGN KEY ("organization_id","customer_id") REFERENCES "public"."customers"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_consents" ADD CONSTRAINT "customer_consents_recorded_by_user_id_user_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_consents" ADD CONSTRAINT "customer_consents_customer_fk" FOREIGN KEY ("organization_id","customer_id") REFERENCES "public"."customers"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_duplicate_dismissals" ADD CONSTRAINT "customer_duplicate_dismissals_dismissed_by_user_id_user_id_fk" FOREIGN KEY ("dismissed_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_duplicate_dismissals" ADD CONSTRAINT "customer_dup_a_fk" FOREIGN KEY ("organization_id","customer_a_id") REFERENCES "public"."customers"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_duplicate_dismissals" ADD CONSTRAINT "customer_dup_b_fk" FOREIGN KEY ("organization_id","customer_b_id") REFERENCES "public"."customers"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_emails" ADD CONSTRAINT "customer_emails_customer_fk" FOREIGN KEY ("organization_id","customer_id") REFERENCES "public"."customers"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_identities" ADD CONSTRAINT "customer_identities_customer_fk" FOREIGN KEY ("organization_id","customer_id") REFERENCES "public"."customers"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_merges" ADD CONSTRAINT "customer_merges_merged_by_user_id_user_id_fk" FOREIGN KEY ("merged_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_merges" ADD CONSTRAINT "customer_merges_reverted_by_user_id_user_id_fk" FOREIGN KEY ("reverted_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_merges" ADD CONSTRAINT "customer_merges_survivor_fk" FOREIGN KEY ("organization_id","survivor_id") REFERENCES "public"."customers"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_merges" ADD CONSTRAINT "customer_merges_merged_fk" FOREIGN KEY ("organization_id","merged_id") REFERENCES "public"."customers"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_author_user_id_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_customer_fk" FOREIGN KEY ("organization_id","customer_id") REFERENCES "public"."customers"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_phones" ADD CONSTRAINT "customer_phones_customer_fk" FOREIGN KEY ("organization_id","customer_id") REFERENCES "public"."customers"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_tags" ADD CONSTRAINT "customer_tags_customer_fk" FOREIGN KEY ("organization_id","customer_id") REFERENCES "public"."customers"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_tags" ADD CONSTRAINT "customer_tags_tag_fk" FOREIGN KEY ("organization_id","tag_id") REFERENCES "public"."tags"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_org_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_merged_into_fk" FOREIGN KEY ("organization_id","merged_into_id") REFERENCES "public"."customers"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_org_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_addresses_customer_idx" ON "customer_addresses" USING btree ("organization_id","customer_id");--> statement-breakpoint
CREATE INDEX "customer_consents_customer_idx" ON "customer_consents" USING btree ("organization_id","customer_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "customer_emails_lookup_idx" ON "customer_emails" USING btree ("organization_id","normalized_email");--> statement-breakpoint
CREATE INDEX "customer_emails_trgm" ON "customer_emails" USING gin ("normalized_email" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "customer_identities_lookup_idx" ON "customer_identities" USING btree ("organization_id","provider","normalized_handle");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_identities_external_uq" ON "customer_identities" USING btree ("organization_id","provider","provider_account_id","external_id") WHERE "customer_identities"."external_id" is not null;--> statement-breakpoint
CREATE INDEX "customer_merges_survivor_idx" ON "customer_merges" USING btree ("organization_id","survivor_id");--> statement-breakpoint
CREATE INDEX "customer_notes_customer_idx" ON "customer_notes" USING btree ("organization_id","customer_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "customer_phones_lookup_idx" ON "customer_phones" USING btree ("organization_id","e164");--> statement-breakpoint
CREATE INDEX "customer_tags_tag_idx" ON "customer_tags" USING btree ("organization_id","tag_id");--> statement-breakpoint
CREATE INDEX "customers_org_created_idx" ON "customers" USING btree ("organization_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "customers_org_owner_idx" ON "customers" USING btree ("organization_id","owner_membership_id");--> statement-breakpoint
CREATE INDEX "customers_org_status_idx" ON "customers" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "customers_display_name_trgm" ON "customers" USING gin ("display_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "customers_company_trgm" ON "customers" USING gin ("company_name" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "tags_org_name_uq" ON "tags" USING btree ("organization_id",lower("name"));