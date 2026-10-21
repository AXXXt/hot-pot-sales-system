-- Additive migration. Existing stock and orders remain intact; historical orders are not reserved.
ALTER TABLE `product_skus`
  ADD COLUMN `reserved_num` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `image_url` VARCHAR(500) NULL,
  ADD COLUMN `packaging_units` JSON NULL,
  ADD COLUMN `low_stock_threshold` INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN `lead_time_days` INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN `safety_stock` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `batch_tracking` BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE `orders` ADD COLUMN `stock_reserved` BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE `stock_movements` ADD COLUMN `batch_allocations` JSON NULL;
CREATE TABLE `stock_batches` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `tenant_id` INTEGER NOT NULL,
  `sku_id` INTEGER NOT NULL,
  `batch_no` VARCHAR(64) NOT NULL,
  `production_date` DATE NULL,
  `expiry_date` DATE NULL,
  `quantity` INTEGER NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `stock_batches_tenant_id_sku_id_batch_no_key` (`tenant_id`, `sku_id`, `batch_no`),
  INDEX `stock_batches_tenant_id_expiry_date_idx` (`tenant_id`, `expiry_date`),
  PRIMARY KEY (`id`),
  CONSTRAINT `stock_batches_sku_id_fkey` FOREIGN KEY (`sku_id`) REFERENCES `product_skus` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `replenishment_plans` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `tenant_id` INTEGER NOT NULL,
  `owner_id` INTEGER NOT NULL,
  `plan_no` VARCHAR(64) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'draft',
  `payload` JSON NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `replenishment_plans_plan_no_key` (`plan_no`),
  INDEX `replenishment_plans_tenant_id_owner_id_status_idx` (`tenant_id`, `owner_id`, `status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
