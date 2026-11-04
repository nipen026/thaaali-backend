-- CreateEnum
CREATE TYPE "PricingUnit" AS ENUM ('item', 'gram');

-- AlterTable
ALTER TABLE "bill_items" ADD COLUMN     "unit" TEXT NOT NULL DEFAULT 'item';

-- AlterTable
ALTER TABLE "menu_items" ADD COLUMN     "pricing_unit" "PricingUnit" NOT NULL DEFAULT 'item';

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "unit" TEXT NOT NULL DEFAULT 'item';
