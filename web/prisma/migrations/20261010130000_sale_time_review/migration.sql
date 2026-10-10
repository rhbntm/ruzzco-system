-- AlterTable
ALTER TABLE `transactions` ADD COLUMN `clock_skew_seconds` INTEGER NULL,
    ADD COLUMN `time_flag` ENUM('FUTURE_TIMESTAMP', 'DEVICE_CLOCK_SKEW') NULL,
    ADD COLUMN `time_review_choice` ENUM('STATED_DATE', 'RECEIVED_DATE') NULL,
    ADD COLUMN `time_reviewed_at` DATETIME(3) NULL,
    ADD COLUMN `time_reviewed_business_date` DATE NULL;

-- CreateIndex
CREATE INDEX `transactions_time_flag_idx` ON `transactions`(`time_flag`);

