-- CreateTable
CREATE TABLE `rate_limit_events` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `limiter` VARCHAR(24) NOT NULL,
    `scope` VARCHAR(100) NOT NULL,
    `at` DATETIME(3) NOT NULL,

    INDEX `rate_limit_events_limiter_scope_at_idx`(`limiter`, `scope`, `at`),
    INDEX `rate_limit_events_at_idx`(`at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rate_limit_locks` (
    `limiter` VARCHAR(24) NOT NULL,
    `scope` VARCHAR(100) NOT NULL,
    `locked_until` DATETIME(3) NOT NULL,

    PRIMARY KEY (`limiter`, `scope`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

