-- Older development databases may already contain these columns from db push.
-- Preserve those values and all legacy inventory tables during deployment.
SET @credit_limit_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'customers' AND column_name = 'credit_limit'),
  'SELECT 1',
  'ALTER TABLE `customers` ADD COLUMN `credit_limit` DECIMAL(12, 2) NULL'
);
PREPARE credit_limit_statement FROM @credit_limit_sql;
EXECUTE credit_limit_statement;
DEALLOCATE PREPARE credit_limit_statement;

SET @credit_days_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'customers' AND column_name = 'credit_days'),
  'SELECT 1',
  'ALTER TABLE `customers` ADD COLUMN `credit_days` INTEGER NULL'
);
PREPARE credit_days_statement FROM @credit_days_sql;
EXECUTE credit_days_statement;
DEALLOCATE PREPARE credit_days_statement;
