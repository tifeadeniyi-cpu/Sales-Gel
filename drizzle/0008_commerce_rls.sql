-- Phase 4: commerce tenant RLS, append-only money tables, and lead_products → products link.
SELECT app_enable_tenant_rls('stores');
--> statement-breakpoint
SELECT app_enable_tenant_rls('products');
--> statement-breakpoint
SELECT app_enable_tenant_rls('product_variants');
--> statement-breakpoint
SELECT app_enable_tenant_rls('orders');
--> statement-breakpoint
SELECT app_enable_tenant_rls('order_items');
--> statement-breakpoint
SELECT app_enable_tenant_rls('payments');
--> statement-breakpoint
SELECT app_enable_tenant_rls('refunds');
--> statement-breakpoint
SELECT app_enable_tenant_rls('fulfillments');
--> statement-breakpoint
SELECT app_enable_tenant_rls('fulfillment_items');
--> statement-breakpoint
ALTER TABLE orders ADD CONSTRAINT orders_assigned_membership_fk
  FOREIGN KEY (organization_id, assigned_membership_id) REFERENCES memberships (organization_id, id)
  ON DELETE SET NULL (assigned_membership_id);
--> statement-breakpoint
ALTER TABLE lead_products ADD CONSTRAINT lead_products_product_fk
  FOREIGN KEY (organization_id, product_id) REFERENCES products (organization_id, id)
  ON DELETE SET NULL (product_id);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON stores, products, product_variants, orders, order_items, fulfillments, fulfillment_items TO crm_app;
--> statement-breakpoint
-- Financial history: insert-only; a payment may only be voided (with reason), never edited or deleted.
GRANT SELECT, INSERT ON payments, refunds TO crm_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON payments, refunds FROM crm_app;
--> statement-breakpoint
GRANT UPDATE (voided_at, voided_by_user_id, void_reason) ON payments TO crm_app;
