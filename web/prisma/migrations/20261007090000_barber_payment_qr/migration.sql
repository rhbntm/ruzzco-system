-- CreateTable
CREATE TABLE `barber_payment_qrs` (
    `id` VARCHAR(191) NOT NULL,
    `barber_id` VARCHAR(191) NOT NULL,
    `method` ENUM('CASH', 'GCASH', 'MAYA', 'QRPH') NOT NULL,
    `content_type` VARCHAR(191) NOT NULL,
    `image` MEDIUMBLOB NOT NULL,
    `sha256` CHAR(64) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `barber_payment_qrs_barber_id_method_key`(`barber_id`, `method`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `barber_payment_qrs` ADD CONSTRAINT `barber_payment_qrs_barber_id_fkey` FOREIGN KEY (`barber_id`) REFERENCES `barbers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

