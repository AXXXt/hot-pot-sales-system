-- Preserve every accepted request identifier, including requests merged into a recent lead.
CREATE TABLE `lead_submissions` (
  `key` CHAR(64) NOT NULL,
  `digest` CHAR(64) NOT NULL,
  `lead_id` INTEGER NOT NULL,
  `tenant_id` INTEGER NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`key`),
  INDEX `lead_submissions_tenant_id_lead_id_idx` (`tenant_id`, `lead_id`),
  CONSTRAINT `lead_submissions_lead_id_fkey` FOREIGN KEY (`lead_id`) REFERENCES `leads` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
