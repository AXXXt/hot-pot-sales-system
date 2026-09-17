ALTER TABLE `product_categories`
  ADD COLUMN `product_sequence` INTEGER NOT NULL DEFAULT 0 AFTER `sort_order`;

UPDATE `product_categories` AS `category`
LEFT JOIN (
  SELECT
    `category_id`,
    COUNT(*) AS `product_count`,
    MAX(
      CASE
        WHEN `code` REGEXP '-[0-9]+$'
          THEN CAST(SUBSTRING_INDEX(`code`, '-', -1) AS UNSIGNED)
        ELSE 0
      END
    ) AS `max_suffix`
  FROM `products`
  WHERE `category_id` IS NOT NULL
  GROUP BY `category_id`
) AS `stats` ON `stats`.`category_id` = `category`.`id`
SET `category`.`product_sequence` = GREATEST(
  COALESCE(`stats`.`product_count`, 0),
  COALESCE(`stats`.`max_suffix`, 0)
);
