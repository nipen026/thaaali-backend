-- DropForeignKey
ALTER TABLE "order_items" DROP CONSTRAINT "order_items_menu_item_id_fkey";

-- AlterTable
ALTER TABLE "order_items" ALTER COLUMN "menu_item_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "external_order_id" TEXT;

-- CreateTable
CREATE TABLE "delivery_integrations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "platform" TEXT NOT NULL,
    "webhook_token" TEXT NOT NULL,
    "webhook_secret" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_order_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_menu_mappings" (
    "id" UUID NOT NULL,
    "integration_id" UUID NOT NULL,
    "external_item_id" TEXT NOT NULL,
    "external_name" TEXT NOT NULL,
    "menu_item_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_menu_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "delivery_integrations_webhook_token_key" ON "delivery_integrations"("webhook_token");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_integrations_tenant_id_platform_key" ON "delivery_integrations"("tenant_id", "platform");

-- CreateIndex
CREATE UNIQUE INDEX "external_menu_mappings_integration_id_external_item_id_key" ON "external_menu_mappings"("integration_id", "external_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_tenant_id_channel_external_order_id_key" ON "orders"("tenant_id", "channel", "external_order_id");

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_menu_item_id_fkey" FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_integrations" ADD CONSTRAINT "delivery_integrations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_menu_mappings" ADD CONSTRAINT "external_menu_mappings_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "delivery_integrations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_menu_mappings" ADD CONSTRAINT "external_menu_mappings_menu_item_id_fkey" FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

