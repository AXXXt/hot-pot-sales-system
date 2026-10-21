-- Preserve batch information while an operator saves and reopens a stocktake draft.
ALTER TABLE `stocktake_items` ADD COLUMN `receipt_batch` JSON NULL;
