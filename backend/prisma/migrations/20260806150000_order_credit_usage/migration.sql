-- Track occupied customer credit and the payment method chosen for each order.
ALTER TABLE `customers`
  ADD COLUMN `credit_used` DECIMAL(12, 2) NOT NULL DEFAULT 0.00;

ALTER TABLE `orders`
  ADD COLUMN `payment_method` VARCHAR(32) NULL,
  ADD COLUMN `credit_amount` DECIMAL(18, 2) NOT NULL DEFAULT 0.00;
