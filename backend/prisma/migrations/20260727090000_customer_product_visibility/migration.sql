ALTER TABLE `products`
    ADD COLUMN `is_factory_product` BOOLEAN NOT NULL DEFAULT false;

UPDATE `products`
SET `is_factory_product` = (`visibility_type` = 1);

ALTER TABLE `customers`
    ADD COLUMN `product_visibility_mode` ENUM('factory', 'all', 'custom') NOT NULL DEFAULT 'factory';

CREATE TABLE `customer_visible_products` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` INTEGER NOT NULL,
    `customer_id` INTEGER NOT NULL,
    `product_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `customer_visible_products_tenant_id_customer_id_product_id_key`(`tenant_id`, `customer_id`, `product_id`),
    INDEX `customer_visible_products_tenant_id_product_id_idx`(`tenant_id`, `product_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `customer_visible_products`
    ADD CONSTRAINT `customer_visible_products_tenant_id_fkey`
        FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `customer_visible_products_customer_id_fkey`
        FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `customer_visible_products_product_id_fkey`
        FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

UPDATE `customer_levels`
SET `code` = 'normal', `name` = '普通客户'
WHERE `code` = 'standard';

ALTER TABLE `products` DROP COLUMN `visibility_type`;
ALTER TABLE `customers` DROP COLUMN `channel_type`;
