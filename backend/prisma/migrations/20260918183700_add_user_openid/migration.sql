-- AlterTable
ALTER TABLE `users` ADD COLUMN `openid` VARCHAR(64) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `users_openid_key` ON `users`(`openid`);