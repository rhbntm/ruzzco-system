-- CreateTable
CREATE TABLE `users` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `role` ENUM('OWNER', 'CASHIER', 'BARBER') NOT NULL DEFAULT 'BARBER',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `barbers` (
    `id` VARCHAR(191) NOT NULL,
    `full_name` VARCHAR(191) NOT NULL,
    `commission_rate` DECIMAL(5, 2) NOT NULL DEFAULT 0.50,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `services` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `standard_price` DECIMAL(10, 2) NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `transactions` (
    `id` VARCHAR(191) NOT NULL,
    `cashier_id` VARCHAR(191) NULL,
    `barber_id` VARCHAR(191) NOT NULL,
    `total_amount` DECIMAL(10, 2) NOT NULL,
    `list_price` DECIMAL(10, 2) NULL,
    `discount_type` ENUM('NONE', 'PERCENT', 'FIXED') NOT NULL DEFAULT 'NONE',
    `discount_amount` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `amount_paid` DECIMAL(10, 2) NULL,
    `tip_amount` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `custom_amount` BOOLEAN NOT NULL DEFAULT false,
    `custom_amount_note` VARCHAR(255) NULL,
    `barber_commission_amount` DECIMAL(10, 2) NOT NULL,
    `commission_base` ENUM('LIST_PRICE', 'AMOUNT_PAID') NOT NULL DEFAULT 'LIST_PRICE',
    `payment_method` ENUM('CASH', 'GCASH', 'MAYA') NOT NULL DEFAULT 'CASH',
    `payment_reference` VARCHAR(191) NULL,
    `transaction_time` DATETIME(3) NOT NULL,
    `synced_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `transactions_barber_id_idx`(`barber_id`),
    INDEX `transactions_transaction_time_idx`(`transaction_time`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `transaction_items` (
    `id` VARCHAR(191) NOT NULL,
    `transaction_id` VARCHAR(191) NOT NULL,
    `service_id` VARCHAR(191) NOT NULL,
    `price_at_sale` DECIMAL(10, 2) NOT NULL,

    INDEX `transaction_items_transaction_id_idx`(`transaction_id`),
    INDEX `transaction_items_service_id_idx`(`service_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `commission_logs` (
    `id` VARCHAR(191) NOT NULL,
    `barber_id` VARCHAR(191) NOT NULL,
    `transaction_id` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(10, 2) NOT NULL,
    `logged_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `commission_logs_barber_id_idx`(`barber_id`),
    INDEX `commission_logs_transaction_id_idx`(`transaction_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `device_assignments` (
    `id` VARCHAR(191) NOT NULL,
    `device_key` VARCHAR(191) NOT NULL,
    `barber_id` VARCHAR(191) NOT NULL,
    `assigned_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `revoked_at` DATETIME(3) NULL,

    INDEX `device_assignments_device_key_idx`(`device_key`),
    INDEX `device_assignments_barber_id_idx`(`barber_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `shift_reconciliations` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `reconciliation_date` DATE NOT NULL,
    `expected_cash` DECIMAL(10, 2) NOT NULL,
    `counted_cash` DECIMAL(10, 2) NOT NULL,
    `variance` DECIMAL(10, 2) NOT NULL,
    `gcash_total` DECIMAL(10, 2) NOT NULL,
    `maya_total` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `total_revenue` DECIMAL(10, 2) NOT NULL,
    `petty_cash_amount` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `petty_cash_note` VARCHAR(255) NULL,
    `note` TEXT NULL,
    `reconciled_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `shift_reconciliations_reconciliation_date_key`(`reconciliation_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `daily_payout_ledgers` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `barber_id` VARCHAR(191) NOT NULL,
    `business_date` DATE NOT NULL,
    `commission_total` DECIMAL(10, 2) NOT NULL,
    `tip_total` DECIMAL(10, 2) NOT NULL,
    `total_owed` DECIMAL(10, 2) NOT NULL,
    `cash_paid` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `gcash_paid` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `paid_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `daily_payout_ledgers_business_date_idx`(`business_date`),
    UNIQUE INDEX `daily_payout_ledgers_barber_id_business_date_key`(`barber_id`, `business_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `daily_revenue_forecasts` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `forecast_date` DATE NOT NULL,
    `predicted_revenue` DECIMAL(10, 2) NOT NULL,
    `confidence_lower_bound` DECIMAL(10, 2) NULL,
    `confidence_upper_bound` DECIMAL(10, 2) NULL,
    `predicted_headcount` INTEGER NULL,
    `generated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `daily_revenue_forecasts_forecast_date_key`(`forecast_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sync_mismatch_logs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `transaction_id` VARCHAR(191) NOT NULL,
    `device_key` VARCHAR(191) NOT NULL,
    `claimed_barber_id` VARCHAR(191) NOT NULL,
    `resolved_barber_id` VARCHAR(191) NOT NULL,
    `detected_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `sync_mismatch_logs_device_key_idx`(`device_key`),
    INDEX `sync_mismatch_logs_transaction_id_idx`(`transaction_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `transactions` ADD CONSTRAINT `transactions_barber_id_fkey` FOREIGN KEY (`barber_id`) REFERENCES `barbers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transaction_items` ADD CONSTRAINT `transaction_items_transaction_id_fkey` FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transaction_items` ADD CONSTRAINT `transaction_items_service_id_fkey` FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `commission_logs` ADD CONSTRAINT `commission_logs_barber_id_fkey` FOREIGN KEY (`barber_id`) REFERENCES `barbers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `commission_logs` ADD CONSTRAINT `commission_logs_transaction_id_fkey` FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `device_assignments` ADD CONSTRAINT `device_assignments_barber_id_fkey` FOREIGN KEY (`barber_id`) REFERENCES `barbers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `daily_payout_ledgers` ADD CONSTRAINT `daily_payout_ledgers_barber_id_fkey` FOREIGN KEY (`barber_id`) REFERENCES `barbers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

