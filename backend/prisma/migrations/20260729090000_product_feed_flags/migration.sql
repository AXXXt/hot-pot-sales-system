ALTER TABLE `products`
  ADD COLUMN `is_new` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `is_hot` BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX `products_tenant_id_brand_id_status_is_new_idx`
  ON `products`(`tenant_id`, `brand_id`, `status`, `is_new`);

CREATE INDEX `products_tenant_id_brand_id_status_is_hot_idx`
  ON `products`(`tenant_id`, `brand_id`, `status`, `is_hot`);
