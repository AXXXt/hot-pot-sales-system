-- CreateTable
CREATE TABLE `customer_repayments` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` INTEGER NOT NULL,
    `customer_id` INTEGER NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `method` VARCHAR(32) NOT NULL,
    `note` VARCHAR(255) NULL,
    `operator_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `customer_repayments_tenant_id_customer_id_created_at_idx` ON `customer_repayments`(`tenant_id`, `customer_id`, `created_at`);

-- AddForeignKey
ALTER TABLE `customer_repayments` ADD CONSTRAINT `customer_repayments_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_repayments` ADD CONSTRAINT `customer_repayments_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE `order_refunds` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` INTEGER NOT NULL,
    `order_id` INTEGER NOT NULL,
    `amount` DECIMAL(18, 2) NOT NULL,
    `method` VARCHAR(32) NOT NULL,
    `reason` VARCHAR(255) NULL,
    `operator_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `order_refunds_tenant_id_order_id_created_at_idx` ON `order_refunds`(`tenant_id`, `order_id`, `created_at`);

-- AddForeignKey
ALTER TABLE `order_refunds` ADD CONSTRAINT `order_refunds_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `order_refunds` ADD CONSTRAINT `order_refunds_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;