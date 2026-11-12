CREATE TABLE "fulfillment_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"fulfillment_id" uuid NOT NULL,
	"order_item_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	CONSTRAINT "fulfillment_items_qty_chk" CHECK ("fulfillment_items"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "fulfillments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"status" text DEFAULT 'shipped' NOT NULL,
	"carrier" text,
	"tracking_number" text,
	"tracking_url" text,
	"note" text,
	"shipped_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fulfillments_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "fulfillments_status_chk" CHECK ("fulfillments"."status" in ('shipped','delivered','picked_up','cancelled'))
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid,
	"variant_id" uuid,
	"name" text NOT NULL,
	"variant_name" text,
	"sku" text,
	"unit_price_amount" bigint NOT NULL,
	"quantity" integer NOT NULL,
	"discount_amount" bigint DEFAULT 0 NOT NULL,
	"line_total_amount" bigint NOT NULL,
	"fulfilled_quantity" integer DEFAULT 0 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_items_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "order_items_order_id_uq" UNIQUE("organization_id","order_id","id"),
	CONSTRAINT "order_items_qty_chk" CHECK ("order_items"."quantity" > 0 and "order_items"."fulfilled_quantity" between 0 and "order_items"."quantity"),
	CONSTRAINT "order_items_amount_chk" CHECK ("order_items"."unit_price_amount" >= 0 and "order_items"."discount_amount" >= 0 and "order_items"."line_total_amount" = "order_items"."unit_price_amount" * "order_items"."quantity" - "order_items"."discount_amount")
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"number" bigint NOT NULL,
	"external_id" text,
	"store_id" uuid NOT NULL,
	"customer_id" uuid,
	"lead_id" uuid,
	"source" text DEFAULT 'manual' NOT NULL,
	"currency" text NOT NULL,
	"subtotal_amount" bigint NOT NULL,
	"discount_amount" bigint DEFAULT 0 NOT NULL,
	"tax_rate_bps" integer DEFAULT 0 NOT NULL,
	"tax_amount" bigint DEFAULT 0 NOT NULL,
	"shipping_amount" bigint DEFAULT 0 NOT NULL,
	"total_amount" bigint NOT NULL,
	"paid_amount" bigint DEFAULT 0 NOT NULL,
	"refunded_amount" bigint DEFAULT 0 NOT NULL,
	"payment_status" text DEFAULT 'unpaid' NOT NULL,
	"order_status" text DEFAULT 'open' NOT NULL,
	"fulfillment_status" text DEFAULT 'unfulfilled' NOT NULL,
	"assigned_membership_id" uuid,
	"delivery_method" text,
	"shipping_address" jsonb,
	"billing_address" jsonb,
	"contact_email" text,
	"contact_phone" text,
	"notes" text,
	"placed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "orders_org_number_uq" UNIQUE("organization_id","number"),
	CONSTRAINT "orders_currency_chk" CHECK ("orders"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "orders_amounts_chk" CHECK ("orders"."subtotal_amount" >= 0 and "orders"."discount_amount" >= 0 and "orders"."tax_amount" >= 0 and "orders"."shipping_amount" >= 0 and "orders"."total_amount" >= 0 and "orders"."paid_amount" >= 0 and "orders"."refunded_amount" >= 0),
	CONSTRAINT "orders_total_chk" CHECK ("orders"."total_amount" = "orders"."subtotal_amount" - "orders"."discount_amount" + "orders"."tax_amount" + "orders"."shipping_amount"),
	CONSTRAINT "orders_refund_chk" CHECK ("orders"."refunded_amount" <= "orders"."paid_amount"),
	CONSTRAINT "orders_payment_status_chk" CHECK ("orders"."payment_status" in ('unpaid','partially_paid','paid','partially_refunded','refunded')),
	CONSTRAINT "orders_order_status_chk" CHECK ("orders"."order_status" in ('open','completed','cancelled')),
	CONSTRAINT "orders_fulfillment_status_chk" CHECK ("orders"."fulfillment_status" in ('unfulfilled','partially_fulfilled','fulfilled'))
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"provider" text DEFAULT 'manual' NOT NULL,
	"provider_payment_id" text,
	"method" text NOT NULL,
	"amount" bigint NOT NULL,
	"currency" text NOT NULL,
	"status" text DEFAULT 'succeeded' NOT NULL,
	"reference" text,
	"note" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recorded_by_user_id" text,
	"voided_at" timestamp with time zone,
	"voided_by_user_id" text,
	"void_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "payments_amount_chk" CHECK ("payments"."amount" > 0),
	CONSTRAINT "payments_status_chk" CHECK ("payments"."status" in ('succeeded','pending','failed')),
	CONSTRAINT "payments_method_chk" CHECK ("payments"."method" in ('cash','bank_transfer','card','mobile_money','payment_link','other'))
);
--> statement-breakpoint
CREATE TABLE "product_variants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"name" text DEFAULT 'Default' NOT NULL,
	"sku" text,
	"price_amount" bigint NOT NULL,
	"currency" text NOT NULL,
	"inventory_quantity" integer,
	"inventory_synced_at" timestamp with time zone,
	"external_id" text,
	"position" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_variants_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "product_variants_product_id_uq" UNIQUE("organization_id","product_id","id"),
	CONSTRAINT "product_variants_price_chk" CHECK ("product_variants"."price_amount" >= 0),
	CONSTRAINT "product_variants_currency_chk" CHECK ("product_variants"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "product_variants_status_chk" CHECK ("product_variants"."status" in ('active','archived'))
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"external_id" text,
	"name" text NOT NULL,
	"description" text,
	"category" text,
	"brand" text,
	"image_url" text,
	"status" text DEFAULT 'active' NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "products_status_chk" CHECK ("products"."status" in ('active','draft','archived'))
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"payment_id" uuid,
	"provider" text DEFAULT 'manual' NOT NULL,
	"provider_refund_id" text,
	"amount" bigint NOT NULL,
	"currency" text NOT NULL,
	"reason" text NOT NULL,
	"method" text NOT NULL,
	"refunded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refunds_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "refunds_amount_chk" CHECK ("refunds"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "stores" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"provider" text DEFAULT 'manual' NOT NULL,
	"currency" text NOT NULL,
	"external_account_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stores_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "stores_currency_chk" CHECK ("stores"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
ALTER TABLE "fulfillment_items" ADD CONSTRAINT "fulfillment_items_f_fk" FOREIGN KEY ("organization_id","fulfillment_id") REFERENCES "public"."fulfillments"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fulfillment_items" ADD CONSTRAINT "fulfillment_items_item_fk" FOREIGN KEY ("organization_id","order_item_id") REFERENCES "public"."order_items"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fulfillments" ADD CONSTRAINT "fulfillments_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fulfillments" ADD CONSTRAINT "fulfillments_order_fk" FOREIGN KEY ("organization_id","order_id") REFERENCES "public"."orders"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_fk" FOREIGN KEY ("organization_id","order_id") REFERENCES "public"."orders"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variant_fk" FOREIGN KEY ("organization_id","variant_id") REFERENCES "public"."product_variants"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_fk" FOREIGN KEY ("organization_id","product_id") REFERENCES "public"."products"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_store_fk" FOREIGN KEY ("organization_id","store_id") REFERENCES "public"."stores"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_fk" FOREIGN KEY ("organization_id","customer_id") REFERENCES "public"."customers"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_lead_fk" FOREIGN KEY ("organization_id","lead_id") REFERENCES "public"."leads"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_user_id_user_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_voided_by_user_id_user_id_fk" FOREIGN KEY ("voided_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_fk" FOREIGN KEY ("organization_id","order_id") REFERENCES "public"."orders"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_fk" FOREIGN KEY ("organization_id","product_id") REFERENCES "public"."products"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_store_fk" FOREIGN KEY ("organization_id","store_id") REFERENCES "public"."stores"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_fk" FOREIGN KEY ("organization_id","order_id") REFERENCES "public"."orders"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_fk" FOREIGN KEY ("organization_id","payment_id") REFERENCES "public"."payments"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_org_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fulfillment_items_f_idx" ON "fulfillment_items" USING btree ("organization_id","fulfillment_id");--> statement-breakpoint
CREATE INDEX "fulfillments_order_idx" ON "fulfillments" USING btree ("organization_id","order_id");--> statement-breakpoint
CREATE INDEX "order_items_order_idx" ON "order_items" USING btree ("organization_id","order_id");--> statement-breakpoint
CREATE INDEX "order_items_product_idx" ON "order_items" USING btree ("organization_id","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_external_uq" ON "orders" USING btree ("organization_id","store_id","external_id") WHERE "orders"."external_id" is not null;--> statement-breakpoint
CREATE INDEX "orders_org_placed_idx" ON "orders" USING btree ("organization_id","placed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "orders_customer_idx" ON "orders" USING btree ("organization_id","customer_id");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("organization_id","order_status","payment_status","fulfillment_status");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_uq" ON "payments" USING btree ("organization_id","provider","provider_payment_id") WHERE "payments"."provider_payment_id" is not null;--> statement-breakpoint
CREATE INDEX "payments_order_idx" ON "payments" USING btree ("organization_id","order_id");--> statement-breakpoint
CREATE INDEX "payments_received_idx" ON "payments" USING btree ("organization_id","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "product_variants_sku_uq" ON "product_variants" USING btree ("organization_id",lower("sku")) WHERE "product_variants"."sku" is not null and "product_variants"."status" <> 'archived';--> statement-breakpoint
CREATE INDEX "products_org_name_idx" ON "products" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "products_name_trgm" ON "products" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "products_external_uq" ON "products" USING btree ("organization_id","store_id","external_id") WHERE "products"."external_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "refunds_provider_uq" ON "refunds" USING btree ("organization_id","provider","provider_refund_id") WHERE "refunds"."provider_refund_id" is not null;--> statement-breakpoint
CREATE INDEX "refunds_order_idx" ON "refunds" USING btree ("organization_id","order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stores_manual_uq" ON "stores" USING btree ("organization_id") WHERE "stores"."provider" = 'manual';