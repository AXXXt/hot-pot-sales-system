DROP TEMPORARY TABLE IF EXISTS `_customer_level_normal_targets`;

CREATE TEMPORARY TABLE `_customer_level_normal_targets` (
    `tenant_id` INTEGER NOT NULL,
    `brand_id` INTEGER NOT NULL,
    `target_id` INTEGER NOT NULL,
    PRIMARY KEY (`tenant_id`, `brand_id`)
);

INSERT INTO `_customer_level_normal_targets` (`tenant_id`, `brand_id`, `target_id`)
SELECT
    `tenant_id`,
    `brand_id`,
    COALESCE(
        MIN(CASE WHEN `code` = 'normal' THEN `id` END),
        MIN(`id`)
    ) AS `target_id`
FROM `customer_levels`
WHERE `code` IN ('normal', 'regular', 'standard')
GROUP BY `tenant_id`, `brand_id`;

UPDATE `customers` AS `customer`
INNER JOIN `customer_levels` AS `legacy`
    ON `legacy`.`id` = `customer`.`customer_level_id`
INNER JOIN `_customer_level_normal_targets` AS `target`
    ON `target`.`tenant_id` = `legacy`.`tenant_id`
    AND `target`.`brand_id` = `legacy`.`brand_id`
SET `customer`.`customer_level_id` = `target`.`target_id`
WHERE `legacy`.`id` <> `target`.`target_id`
    AND `legacy`.`code` IN ('normal', 'regular', 'standard');

DELETE `legacy`
FROM `customer_levels` AS `legacy`
INNER JOIN `_customer_level_normal_targets` AS `target`
    ON `target`.`tenant_id` = `legacy`.`tenant_id`
    AND `target`.`brand_id` = `legacy`.`brand_id`
WHERE `legacy`.`id` <> `target`.`target_id`
    AND `legacy`.`code` IN ('normal', 'regular', 'standard');

UPDATE `customer_levels` AS `level`
INNER JOIN `_customer_level_normal_targets` AS `target`
    ON `target`.`target_id` = `level`.`id`
SET
    `level`.`code` = 'normal',
    `level`.`name` = '普通客户',
    `level`.`status` = 'active';

DROP TEMPORARY TABLE `_customer_level_normal_targets`;

CREATE UNIQUE INDEX `customer_levels_tenant_id_brand_id_name_key`
    ON `customer_levels`(`tenant_id`, `brand_id`, `name`);
