-- Nullable fields preserve historical leads without inventing consent or customer links.
ALTER TABLE `leads`
  ADD COLUMN `customer_id` INTEGER NULL,
  ADD COLUMN `submission_key` CHAR(64) NULL,
  ADD COLUMN `submission_digest` CHAR(64) NULL;
CREATE UNIQUE INDEX `leads_submission_key_key` ON `leads` (`submission_key`);
CREATE INDEX `leads_tenant_id_customer_id_idx` ON `leads` (`tenant_id`, `customer_id`);
