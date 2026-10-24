CREATE TABLE `customer_notifications` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `tenant_id` INTEGER NOT NULL,
  `user_id` INTEGER NOT NULL,
  `order_id` INTEGER NOT NULL,
  `event_key` VARCHAR(100) NOT NULL,
  `event` VARCHAR(40) NOT NULL,
  `title` VARCHAR(100) NOT NULL,
  `content` VARCHAR(500) NOT NULL,
  `read_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `customer_notifications_event_key_key` (`event_key`),
  INDEX `customer_notifications_tenant_id_user_id_created_at_idx` (`tenant_id`, `user_id`, `created_at`),
  INDEX `customer_notifications_tenant_id_user_id_read_at_idx` (`tenant_id`, `user_id`, `read_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `customer_notifications_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `customer_notifications_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `customer_notifications_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
