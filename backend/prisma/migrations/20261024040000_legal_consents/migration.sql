-- Store explicit consent without fabricating consent for existing accounts.
CREATE TABLE `legal_consents` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `tenant_id` INTEGER NULL,
  `user_id` INTEGER NULL,
  `lead_id` INTEGER NULL,
  `version` VARCHAR(64) NOT NULL,
  `document_hash` CHAR(64) NOT NULL,
  `channel` VARCHAR(32) NOT NULL,
  `accepted_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `legal_consents_lead_id_key` (`lead_id`),
  UNIQUE INDEX `legal_consents_user_id_version_channel_key` (`user_id`, `version`, `channel`),
  INDEX `legal_consents_tenant_id_user_id_idx` (`tenant_id`, `user_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
