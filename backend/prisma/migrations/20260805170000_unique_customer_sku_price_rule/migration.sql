DELETE `older`
FROM `customer_price_rules` AS `older`
INNER JOIN `customer_price_rules` AS `newer`
    ON `newer`.`tenant_id` = `older`.`tenant_id`
    AND `newer`.`customer_id` = `older`.`customer_id`
    AND `newer`.`sku_id` = `older`.`sku_id`
    AND `older`.`sku_id` IS NOT NULL
    AND (
        CASE WHEN `newer`.`status` = 'active' THEN 1 ELSE 0 END
            > CASE WHEN `older`.`status` = 'active' THEN 1 ELSE 0 END
        OR (
            CASE WHEN `newer`.`status` = 'active' THEN 1 ELSE 0 END
                = CASE WHEN `older`.`status` = 'active' THEN 1 ELSE 0 END
            AND `newer`.`updated_at` > `older`.`updated_at`
        )
        OR (
            CASE WHEN `newer`.`status` = 'active' THEN 1 ELSE 0 END
                = CASE WHEN `older`.`status` = 'active' THEN 1 ELSE 0 END
            AND `newer`.`updated_at` = `older`.`updated_at`
            AND `newer`.`id` > `older`.`id`
        )
    );

UPDATE `customer_price_rules`
SET `price_type` = 'agreement'
WHERE `sku_id` IS NOT NULL;

DROP INDEX `customer_price_rules_tenant_id_customer_id_sku_id_price_type_key`
    ON `customer_price_rules`;

CREATE UNIQUE INDEX `customer_price_rules_tenant_id_customer_id_sku_id_key`
    ON `customer_price_rules`(`tenant_id`, `customer_id`, `sku_id`);
