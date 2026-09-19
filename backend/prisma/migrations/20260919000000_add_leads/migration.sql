-- CreateTable
CREATE TABLE `leads` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenant_id` INTEGER NOT NULL,
    `phone` VARCHAR(20) NOT NULL,
    `name` VARCHAR(100) NULL,
    `store_name` VARCHAR(120) NULL,
    `store_scale` VARCHAR(32) NULL,
    `interested_items` VARCHAR(500) NULL,
    `remark` VARCHAR(500) NULL,
    `source` ENUM('official_site', 'phone', 'manual') NOT NULL DEFAULT 'official_site',
    `status` ENUM('new', 'contacted', 'converted', 'invalid') NOT NULL DEFAULT 'new',
    `assigned_to_id` INTEGER NULL,
    `next_follow_up_at` DATETIME(3) NULL,
    `last_contact_at` DATETIME(3) NULL,
    `ip_address` VARCHAR(64) NULL,
    `user_agent` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lead_follow_ups` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `lead_id` INTEGER NOT NULL,
    `operator_id` INTEGER NULL,
    `content` VARCHAR(500) NOT NULL,
    `next_follow_up_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `leads_tenant_id_status_created_at_idx` ON `leads`(`tenant_id`, `status`, `created_at`);

-- CreateIndex
CREATE INDEX `leads_tenant_id_phone_idx` ON `leads`(`tenant_id`, `phone`);

-- CreateIndex
CREATE INDEX `lead_follow_ups_lead_id_created_at_idx` ON `lead_follow_ups`(`lead_id`, `created_at`);

-- AddForeignKey
ALTER TABLE `leads` ADD CONSTRAINT `leads_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leads` ADD CONSTRAINT `leads_assigned_to_id_fkey` FOREIGN KEY (`assigned_to_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lead_follow_ups` ADD CONSTRAINT `lead_follow_ups_lead_id_fkey` FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lead_follow_ups` ADD CONSTRAINT `lead_follow_ups_operator_id_fkey` FOREIGN KEY (`operator_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;