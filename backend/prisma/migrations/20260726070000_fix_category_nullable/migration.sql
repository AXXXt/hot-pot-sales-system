-- Fix: products.category_id should be nullable (matches Prisma schema Int?)
-- Fix: FK constraint should be ON DELETE SET NULL (matches Prisma schema onDelete: SetNull)

ALTER TABLE `products`
  MODIFY `category_id` INTEGER NULL;

ALTER TABLE `products`
  DROP FOREIGN KEY `products_category_id_fkey`;

ALTER TABLE `products`
  ADD CONSTRAINT `products_category_id_fkey`
    FOREIGN KEY (`category_id`) REFERENCES `product_categories`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;
