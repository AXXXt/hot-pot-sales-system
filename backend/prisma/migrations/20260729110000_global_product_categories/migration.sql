CREATE UNIQUE INDEX `product_categories_tenant_id_code_key`
  ON `product_categories`(`tenant_id`, `code`);

ALTER TABLE `product_categories`
  DROP FOREIGN KEY `product_categories_brand_id_fkey`;

DROP INDEX `product_categories_tenant_id_brand_id_code_key`
  ON `product_categories`;

DROP INDEX `product_categories_tenant_id_brand_id_status_idx`
  ON `product_categories`;

ALTER TABLE `product_categories`
  DROP COLUMN `brand_id`;

CREATE INDEX `product_categories_tenant_id_status_idx`
  ON `product_categories`(`tenant_id`, `status`);
