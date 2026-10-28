-- CreateTable
CREATE TABLE `devices` (
    `device_key` VARCHAR(191) NOT NULL,
    `secret_hash` CHAR(64) NOT NULL,
    `approved_at` DATETIME(3) NOT NULL,
    `approved_with` ENUM('OWNER', 'APPROVER') NOT NULL,
    `label` VARCHAR(60) NULL,
    `revoked_at` DATETIME(3) NULL,
    `last_seen_at` DATETIME(3) NULL,

    PRIMARY KEY (`device_key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
