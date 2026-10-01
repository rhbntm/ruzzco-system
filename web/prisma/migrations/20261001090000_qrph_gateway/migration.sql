-- AlterTable
ALTER TABLE `transactions` ADD COLUMN `payment_status` ENUM('PAID', 'PENDING', 'EXPIRED', 'FAILED') NOT NULL DEFAULT 'PAID',
    MODIFY `payment_method` ENUM('CASH', 'GCASH', 'MAYA', 'QRPH') NOT NULL DEFAULT 'CASH';

-- CreateTable
CREATE TABLE `gateway_payments` (
    `id` VARCHAR(191) NOT NULL,
    `transaction_id` VARCHAR(191) NOT NULL,
    `provider` ENUM('PAYMONGO_TEST') NOT NULL DEFAULT 'PAYMONGO_TEST',
    `intent_id` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(10, 2) NOT NULL,
    `status` ENUM('PAID', 'PENDING', 'EXPIRED', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `paid_at` DATETIME(3) NULL,
    `last_event_id` VARCHAR(191) NULL,

    UNIQUE INDEX `gateway_payments_transaction_id_key`(`transaction_id`),
    UNIQUE INDEX `gateway_payments_intent_id_key`(`intent_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `gateway_webhook_events` (
    `event_id` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `received_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`event_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `gateway_payments` ADD CONSTRAINT `gateway_payments_transaction_id_fkey` FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

