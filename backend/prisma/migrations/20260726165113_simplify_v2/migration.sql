-- Idempotent version: each step checks if it needs to run
-- This migration simplifies the schema by removing warehouse/inventory and adding quoting/visibility features

-- Add product fields (ignore if exists)
SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='products' AND COLUMN_NAME='visibility_type');
SET @sql = IF(@exist=0, 'ALTER TABLE products ADD COLUMN visibility_type INTEGER NOT NULL DEFAULT 1 COMMENT ''visibility''', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='products' AND COLUMN_NAME='support_sample');
SET @sql = IF(@exist=0, 'ALTER TABLE products ADD COLUMN support_sample BOOLEAN NOT NULL DEFAULT false COMMENT ''sample''', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Add stock_num to sku
SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='product_skus' AND COLUMN_NAME='stock_num');
SET @sql = IF(@exist=0, 'ALTER TABLE product_skus ADD COLUMN stock_num INTEGER NOT NULL DEFAULT 0 COMMENT ''stock''', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Add channel_type to customers
SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='customers' AND COLUMN_NAME='channel_type');
SET @sql = IF(@exist=0, 'ALTER TABLE customers ADD COLUMN channel_type VARCHAR(50) NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Drop FK if exists and add order columns
SET @exist := (SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND CONSTRAINT_NAME='orders_warehouse_id_fkey');
SET @sql = IF(@exist>0, 'ALTER TABLE orders DROP FOREIGN KEY orders_warehouse_id_fkey', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND COLUMN_NAME='warehouse_id');
SET @sql = IF(@exist>0, 'ALTER TABLE orders DROP COLUMN warehouse_id', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND COLUMN_NAME='quoted_amount');
SET @sql = IF(@exist=0, 'ALTER TABLE orders ADD COLUMN quoted_amount DECIMAL(18,2) NULL, ADD COLUMN quote_note VARCHAR(500) NULL, ADD COLUMN payment_proof VARCHAR(500) NULL, ADD COLUMN logistics_type VARCHAR(50) NULL, ADD COLUMN logistics_info JSON NULL, ADD COLUMN sample_flag BOOLEAN NOT NULL DEFAULT false', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Update status enum
ALTER TABLE orders MODIFY COLUMN status ENUM('draft','pending_quote','pending_confirm','pending_finance','pending_shipment','shipped','completed','cancelled') NOT NULL DEFAULT 'draft';

-- Add quoted_price to order_items
SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='order_items' AND COLUMN_NAME='quoted_price');
SET @sql = IF(@exist=0, 'ALTER TABLE order_items ADD COLUMN quoted_price DECIMAL(18,2) NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Create customer_price_history if not exists
CREATE TABLE IF NOT EXISTS customer_price_history (
  id INTEGER NOT NULL AUTO_INCREMENT,
  tenant_id INTEGER NOT NULL,
  customer_id INTEGER NOT NULL,
  sku_id INTEGER NOT NULL,
  price DECIMAL(18,2) NOT NULL COMMENT '历史成交价',
  order_id INTEGER NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  INDEX cph_idx(tenant_id, customer_id, sku_id)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
