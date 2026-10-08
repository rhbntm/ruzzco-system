-- AlterTable
ALTER TABLE `daily_revenue_forecasts` ADD COLUMN `run_id` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `forecast_runs` (
    `id` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `model_version` VARCHAR(191) NOT NULL,
    `data_from` DATE NOT NULL,
    `data_to` DATE NOT NULL,
    `training_days` INTEGER NOT NULL,
    `avg_ticket` DECIMAL(10, 2) NOT NULL,
    `typical_error_customers` DECIMAL(6, 2) NOT NULL,
    `best_baseline` VARCHAR(191) NOT NULL,
    `best_baseline_error` DECIMAL(6, 2) NOT NULL,
    `weeks_rf_won` INTEGER NOT NULL,
    `weeks_tested` INTEGER NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `daily_revenue_forecasts` ADD CONSTRAINT `daily_revenue_forecasts_run_id_fkey` FOREIGN KEY (`run_id`) REFERENCES `forecast_runs`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

