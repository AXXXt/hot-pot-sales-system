-- CreateTable
CREATE TABLE `ai_configs` (
    `tenant_id` INTEGER NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `base_url` VARCHAR(500) NOT NULL DEFAULT '',
    `text_model` VARCHAR(100) NOT NULL DEFAULT '',
    `vision_model` VARCHAR(100) NOT NULL DEFAULT '',
    `encrypted_key` TEXT NULL,
    `allow_writes` BOOLEAN NOT NULL DEFAULT false,
    `daily_requests` INTEGER NOT NULL DEFAULT 100,
    `features` JSON NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`tenant_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_conversations` (
    `id` VARCHAR(36) NOT NULL,
    `tenant_id` INTEGER NOT NULL,
    `owner_id` INTEGER NOT NULL,
    `title` VARCHAR(100) NOT NULL,
    `fingerprint` VARCHAR(64) NOT NULL,
    `archived` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `ai_conversations_tenant_id_owner_id_updated_at_idx`(`tenant_id`, `owner_id`, `updated_at`),
    UNIQUE INDEX `ai_conversations_tenant_id_owner_id_id_key`(`tenant_id`, `owner_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_messages` (
    `id` VARCHAR(36) NOT NULL,
    `tenant_id` INTEGER NOT NULL,
    `owner_id` INTEGER NOT NULL,
    `conversation_id` VARCHAR(36) NOT NULL,
    `role` VARCHAR(20) NOT NULL,
    `content` MEDIUMTEXT NOT NULL,
    `cards` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ai_messages_tenant_id_owner_id_conversation_id_created_at_idx`(`tenant_id`, `owner_id`, `conversation_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_attachments` (
    `id` VARCHAR(36) NOT NULL,
    `tenant_id` INTEGER NOT NULL,
    `owner_id` INTEGER NOT NULL,
    `object_key` VARCHAR(500) NOT NULL,
    `mime_type` VARCHAR(100) NOT NULL,
    `file_size` INTEGER NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ai_attachments_tenant_id_owner_id_expires_at_idx`(`tenant_id`, `owner_id`, `expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_action_drafts` (
    `id` VARCHAR(36) NOT NULL,
    `tenant_id` INTEGER NOT NULL,
    `owner_id` INTEGER NOT NULL,
    `conversation_id` VARCHAR(36) NOT NULL,
    `action` VARCHAR(50) NOT NULL,
    `payload` JSON NOT NULL,
    `fingerprint` VARCHAR(64) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `digest` VARCHAR(64) NOT NULL,
    `status` VARCHAR(32) NOT NULL DEFAULT 'draft',
    `expires_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `ai_action_drafts_tenant_id_owner_id_status_idx`(`tenant_id`, `owner_id`, `status`),
    UNIQUE INDEX `ai_action_drafts_tenant_id_owner_id_id_key`(`tenant_id`, `owner_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_action_executions` (
    `id` VARCHAR(36) NOT NULL,
    `tenant_id` INTEGER NOT NULL,
    `owner_id` INTEGER NOT NULL,
    `draft_id` VARCHAR(36) NOT NULL,
    `action` VARCHAR(50) NOT NULL,
    `result` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ai_action_executions_draft_id_key`(`draft_id`),
    INDEX `ai_action_executions_tenant_id_owner_id_created_at_idx`(`tenant_id`, `owner_id`, `created_at`),
    UNIQUE INDEX `ai_action_executions_tenant_id_owner_id_draft_id_key`(`tenant_id`, `owner_id`, `draft_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_usage_records` (
    `id` VARCHAR(36) NOT NULL,
    `tenant_id` INTEGER NOT NULL,
    `owner_id` INTEGER NOT NULL,
    `model` VARCHAR(100) NOT NULL,
    `input_tokens` INTEGER NOT NULL DEFAULT 0,
    `output_tokens` INTEGER NOT NULL DEFAULT 0,
    `images` INTEGER NOT NULL DEFAULT 0,
    `status` VARCHAR(32) NOT NULL DEFAULT 'reserved',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ai_usage_records_tenant_id_owner_id_created_at_idx`(`tenant_id`, `owner_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ops_tasks` (
    `id` VARCHAR(36) NOT NULL,
    `tenant_id` INTEGER NOT NULL,
    `owner_id` INTEGER NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `due_at` DATETIME(3) NOT NULL,
    `status` VARCHAR(32) NOT NULL DEFAULT 'pending',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `ops_tasks_tenant_id_owner_id_status_due_at_idx`(`tenant_id`, `owner_id`, `status`, `due_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_schedules` (
    `id` VARCHAR(36) NOT NULL,
    `tenant_id` INTEGER NOT NULL,
    `owner_id` INTEGER NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `kind` VARCHAR(32) NOT NULL,
    `hour` INTEGER NOT NULL DEFAULT 9,
    `weekday` INTEGER NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `fingerprint` VARCHAR(64) NOT NULL,
    `next_run_at` DATETIME(3) NOT NULL,
    `last_run_at` DATETIME(3) NULL,
    `last_result` JSON NULL,
    `error` VARCHAR(200) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ai_schedules_enabled_next_run_at_idx`(`enabled`, `next_run_at`),
    INDEX `ai_schedules_tenant_id_owner_id_idx`(`tenant_id`, `owner_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ai_messages` ADD CONSTRAINT `ai_messages_tenant_id_owner_id_conversation_id_fkey` FOREIGN KEY (`tenant_id`, `owner_id`, `conversation_id`) REFERENCES `ai_conversations`(`tenant_id`, `owner_id`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_action_drafts` ADD CONSTRAINT `ai_action_drafts_tenant_id_owner_id_conversation_id_fkey` FOREIGN KEY (`tenant_id`, `owner_id`, `conversation_id`) REFERENCES `ai_conversations`(`tenant_id`, `owner_id`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_action_executions` ADD CONSTRAINT `ai_action_executions_tenant_id_owner_id_draft_id_fkey` FOREIGN KEY (`tenant_id`, `owner_id`, `draft_id`) REFERENCES `ai_action_drafts`(`tenant_id`, `owner_id`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Register capabilities without granting new powers to ordinary roles.
INSERT INTO permissions (permission_type, name, code, status, created_at, updated_at) VALUES
('action', '使用AI运营助手', 'ai:use', 'active', NOW(3), NOW(3)),
('action', '确认AI业务操作', 'ai:execute', 'active', NOW(3), NOW(3)),
('action', '配置AI助手', 'ai:configure', 'active', NOW(3), NOW(3)),
('action', '查看AI用量', 'ai:usage:read', 'active', NOW(3), NOW(3)),
('action', '查看AI审计', 'ai:audit:read', 'active', NOW(3), NOW(3)),
('action', '管理个人事务', 'task:manage_own', 'active', NOW(3), NOW(3)),
('action', '查看经营统计', 'analytics:view', 'active', NOW(3), NOW(3)),
('action', '调整商品销售价', 'product:price:update', 'active', NOW(3), NOW(3)),
('action', '导出业务报告', 'export:create', 'active', NOW(3), NOW(3))
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO role_permissions (tenant_id, role_id, permission_id, created_at)
SELECT r.tenant_id, r.id, p.id, NOW(3) FROM roles r JOIN permissions p ON p.code IN ('ai:use', 'ai:execute', 'ai:configure', 'ai:usage:read', 'ai:audit:read', 'task:manage_own', 'analytics:view', 'product:price:update', 'export:create') WHERE r.code = 'super_admin' AND r.status = 'active'
ON DUPLICATE KEY UPDATE role_id = VALUES(role_id);
