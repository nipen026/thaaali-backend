-- CreateEnum
CREATE TYPE "BusinessType" AS ENUM ('restaurant', 'hotel', 'both');

-- CreateEnum
CREATE TYPE "PlanTier" AS ENUM ('trial', 'starter', 'pro', 'enterprise');

-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('active', 'past_due', 'suspended', 'cancelled');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('owner', 'manager', 'waiter', 'cashier', 'kitchen', 'hotel_desk');

-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('super_admin', 'support_agent', 'billing_admin');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'inactive');

-- CreateEnum
CREATE TYPE "TableStatus" AS ENUM ('available', 'occupied', 'reserved', 'bill_requested');

-- CreateEnum
CREATE TYPE "MenuItemType" AS ENUM ('veg', 'non_veg');

-- CreateEnum
CREATE TYPE "SpiceLevel" AS ENUM ('none', 'mild', 'medium', 'hot', 'extra_hot');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('pending', 'preparing', 'ready', 'delivered', 'billed', 'cancelled');

-- CreateEnum
CREATE TYPE "BillStatus" AS ENUM ('generated', 'paid', 'void');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('cash', 'card', 'upi', 'gateway');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('pending', 'success', 'failed', 'refunded');

-- CreateEnum
CREATE TYPE "InventoryTxnType" AS ENUM ('purchase', 'consumption', 'adjustment', 'wastage');

-- CreateEnum
CREATE TYPE "EmploymentStatus" AS ENUM ('active', 'inactive');

-- CreateEnum
CREATE TYPE "RoomStatus" AS ENUM ('available', 'occupied', 'dirty', 'inspecting');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('confirmed', 'cancelled', 'checked_in');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('user', 'platform_admin');

-- CreateTable
CREATE TABLE "platform_admins" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "PlatformRole" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "custom_domain" TEXT,
    "business_type" "BusinessType" NOT NULL DEFAULT 'both',
    "plan_tier" "PlanTier" NOT NULL DEFAULT 'trial',
    "plan_status" "PlanStatus" NOT NULL DEFAULT 'active',
    "plan_renews_at" TIMESTAMP(3),
    "plan_seats" INTEGER NOT NULL DEFAULT 5,
    "plan_features" TEXT[],
    "billing_customer_id" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "gst_rate" DECIMAL(5,4) NOT NULL DEFAULT 0.05,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "data_residency" TEXT NOT NULL DEFAULT 'shared',
    "dedicated_db_uri" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "avatar" TEXT,
    "role" "Role" NOT NULL,
    "permissions" TEXT[],
    "status" "UserStatus" NOT NULL DEFAULT 'active',
    "refresh_token_version" INTEGER NOT NULL DEFAULT 0,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "family" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_profiles" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "shift" TEXT NOT NULL DEFAULT 'morning',
    "tables_assigned" TEXT[],
    "phone" TEXT,
    "employment_status" "EmploymentStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tables" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "capacity" INTEGER NOT NULL,
    "zone" TEXT NOT NULL,
    "status" "TableStatus" NOT NULL DEFAULT 'available',
    "current_waiter_id" UUID,
    "guests" INTEGER NOT NULL DEFAULT 0,
    "seated_at" TIMESTAMP(3),
    "reservation_time" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_categories" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "sort" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "menu_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "type" "MenuItemType" NOT NULL,
    "spice" "SpiceLevel" NOT NULL DEFAULT 'mild',
    "dietary" TEXT[],
    "available" BOOLEAN NOT NULL DEFAULT true,
    "calories" INTEGER,
    "description" TEXT,
    "image" TEXT,
    "orders_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "menu_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "table_id" UUID,
    "channel" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'pending',
    "waiter_id" UUID,
    "total" DECIMAL(10,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "menu_item_id" UUID NOT NULL,
    "name_snapshot" TEXT NOT NULL,
    "price_snapshot" DECIMAL(10,2) NOT NULL,
    "qty" INTEGER NOT NULL,
    "spice" TEXT,
    "notes" TEXT,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bills" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "bill_number" INTEGER NOT NULL,
    "table_id" UUID,
    "subtotal" DECIMAL(10,2) NOT NULL,
    "discount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "cgst" DECIMAL(10,2) NOT NULL,
    "sgst" DECIMAL(10,2) NOT NULL,
    "total_gst" DECIMAL(10,2) NOT NULL,
    "grand_total" DECIMAL(10,2) NOT NULL,
    "payment_method" TEXT,
    "status" "BillStatus" NOT NULL DEFAULT 'generated',
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_items" (
    "id" UUID NOT NULL,
    "bill_id" UUID NOT NULL,
    "menu_item_id" UUID,
    "name_snapshot" TEXT NOT NULL,
    "price_snapshot" DECIMAL(10,2) NOT NULL,
    "qty" INTEGER NOT NULL,

    CONSTRAINT "bill_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_orders" (
    "bill_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,

    CONSTRAINT "bill_orders_pkey" PRIMARY KEY ("bill_id","order_id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "bill_id" UUID NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "gateway_ref" TEXT,
    "amount" DECIMAL(10,2) NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "current_stock" DECIMAL(10,3) NOT NULL DEFAULT 0,
    "reorder_at" DECIMAL(10,3) NOT NULL,
    "price_per_unit" DECIMAL(10,2) NOT NULL,
    "supplier" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_transactions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "type" "InventoryTxnType" NOT NULL,
    "qty_delta" DECIMAL(10,3) NOT NULL,
    "resulting_stock" DECIMAL(10,3) NOT NULL,
    "reason" TEXT,
    "order_id" UUID,
    "actor_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hotel_rooms" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "floor" INTEGER NOT NULL,
    "status" "RoomStatus" NOT NULL DEFAULT 'available',
    "rate" DECIMAL(10,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hotel_rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "guest_name" TEXT NOT NULL,
    "phone" TEXT,
    "room_type" TEXT NOT NULL,
    "check_in" TIMESTAMP(3) NOT NULL,
    "check_out" TIMESTAMP(3) NOT NULL,
    "guests" INTEGER NOT NULL DEFAULT 1,
    "status" "ReservationStatus" NOT NULL DEFAULT 'confirmed',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stay_records" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "reservation_id" UUID,
    "guest_name" TEXT NOT NULL,
    "phone" TEXT,
    "check_in_at" TIMESTAMP(3) NOT NULL,
    "check_out_at" TIMESTAMP(3),
    "rate_charged" DECIMAL(10,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stay_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "actor_user_id" UUID,
    "actor_type" "ActorType" NOT NULL,
    "impersonated_by" UUID,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" UUID,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_aggregates" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "date" TEXT NOT NULL,
    "revenue" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "orders_count" INTEGER NOT NULL DEFAULT 0,
    "avg_order_value" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "covers" INTEGER NOT NULL DEFAULT 0,
    "channel_split" JSONB NOT NULL DEFAULT '{}',
    "hourly_buckets" INTEGER[],
    "top_items" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_aggregates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "counters" (
    "id" TEXT NOT NULL,
    "tenant_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "counters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_admins_email_key" ON "platform_admins"("email");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_custom_domain_key" ON "tenants"("custom_domain");

-- CreateIndex
CREATE INDEX "users_tenant_id_role_idx" ON "users"("tenant_id", "role");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenant_id_email_key" ON "users"("tenant_id", "email");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_profiles_user_id_key" ON "staff_profiles"("user_id");

-- CreateIndex
CREATE INDEX "staff_profiles_tenant_id_employment_status_idx" ON "staff_profiles"("tenant_id", "employment_status");

-- CreateIndex
CREATE INDEX "tables_tenant_id_status_idx" ON "tables"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "tables_tenant_id_number_key" ON "tables"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "menu_categories_tenant_id_sort_idx" ON "menu_categories"("tenant_id", "sort");

-- CreateIndex
CREATE INDEX "menu_items_tenant_id_category_id_idx" ON "menu_items"("tenant_id", "category_id");

-- CreateIndex
CREATE INDEX "menu_items_tenant_id_available_idx" ON "menu_items"("tenant_id", "available");

-- CreateIndex
CREATE INDEX "orders_tenant_id_status_idx" ON "orders"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "orders_tenant_id_table_id_idx" ON "orders"("tenant_id", "table_id");

-- CreateIndex
CREATE INDEX "orders_tenant_id_created_at_idx" ON "orders"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "order_items_order_id_idx" ON "order_items"("order_id");

-- CreateIndex
CREATE INDEX "bills_tenant_id_status_idx" ON "bills"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "bills_tenant_id_created_at_idx" ON "bills"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "bills_tenant_id_bill_number_key" ON "bills"("tenant_id", "bill_number");

-- CreateIndex
CREATE INDEX "bill_items_bill_id_idx" ON "bill_items"("bill_id");

-- CreateIndex
CREATE INDEX "payments_tenant_id_bill_id_idx" ON "payments"("tenant_id", "bill_id");

-- CreateIndex
CREATE INDEX "payments_gateway_ref_idx" ON "payments"("gateway_ref");

-- CreateIndex
CREATE INDEX "inventory_items_tenant_id_current_stock_idx" ON "inventory_items"("tenant_id", "current_stock");

-- CreateIndex
CREATE INDEX "inventory_transactions_tenant_id_item_id_created_at_idx" ON "inventory_transactions"("tenant_id", "item_id", "created_at");

-- CreateIndex
CREATE INDEX "hotel_rooms_tenant_id_status_idx" ON "hotel_rooms"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "hotel_rooms_tenant_id_number_key" ON "hotel_rooms"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "reservations_tenant_id_check_in_idx" ON "reservations"("tenant_id", "check_in");

-- CreateIndex
CREATE INDEX "stay_records_tenant_id_room_id_check_in_at_idx" ON "stay_records"("tenant_id", "room_id", "check_in_at");

-- CreateIndex
CREATE INDEX "stay_records_tenant_id_check_out_at_idx" ON "stay_records"("tenant_id", "check_out_at");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_created_at_idx" ON "audit_logs"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_actor_user_id_created_at_idx" ON "audit_logs"("actor_user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "daily_aggregates_tenant_id_date_key" ON "daily_aggregates"("tenant_id", "date");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_profiles" ADD CONSTRAINT "staff_profiles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_profiles" ADD CONSTRAINT "staff_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tables" ADD CONSTRAINT "tables_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tables" ADD CONSTRAINT "tables_current_waiter_id_fkey" FOREIGN KEY ("current_waiter_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_categories" ADD CONSTRAINT "menu_categories_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "menu_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_table_id_fkey" FOREIGN KEY ("table_id") REFERENCES "tables"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_waiter_id_fkey" FOREIGN KEY ("waiter_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_menu_item_id_fkey" FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_items" ADD CONSTRAINT "bill_items_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_orders" ADD CONSTRAINT "bill_orders_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_orders" ADD CONSTRAINT "bill_orders_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_rooms" ADD CONSTRAINT "hotel_rooms_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stay_records" ADD CONSTRAINT "stay_records_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stay_records" ADD CONSTRAINT "stay_records_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "hotel_rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stay_records" ADD CONSTRAINT "stay_records_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_aggregates" ADD CONSTRAINT "daily_aggregates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counters" ADD CONSTRAINT "counters_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
