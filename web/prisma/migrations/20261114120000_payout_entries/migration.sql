-- Slice 18: each payout to a barber is its own entry, never edited or deleted.

-- CreateTable
CREATE TABLE `payout_entries` (
    `id` CHAR(36) NOT NULL,
    `ledger_id` BIGINT NOT NULL,
    `barber_id` VARCHAR(191) NOT NULL,
    `business_date` DATE NOT NULL,
    `method` ENUM('CASH', 'GCASH') NOT NULL,
    `kind` ENUM('PAYOUT', 'CORRECTION', 'OPENING') NOT NULL DEFAULT 'PAYOUT',
    `amount` DECIMAL(10, 2) NOT NULL,
    `corrects_id` CHAR(36) NULL,
    `note` VARCHAR(200) NULL,
    `owed_at_entry` DECIMAL(10, 2) NOT NULL,
    `recorded_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `payout_entries_ledger_id_recorded_at_idx`(`ledger_id`, `recorded_at`),
    INDEX `payout_entries_business_date_idx`(`business_date`),
    INDEX `payout_entries_corrects_id_idx`(`corrects_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `payout_entries` ADD CONSTRAINT `payout_entries_ledger_id_fkey` FOREIGN KEY (`ledger_id`) REFERENCES `daily_payout_ledgers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payout_entries` ADD CONSTRAINT `payout_entries_barber_id_fkey` FOREIGN KEY (`barber_id`) REFERENCES `barbers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill (edge case 7): each amount saved the old way becomes one OPENING entry, so the
-- row's totals do not change. A row ticked paid keeps showing "additional owed" when it did:
-- its owed_at_entry is capped at what was paid (slice 18, Decision 5).
INSERT INTO `payout_entries` (`id`, `ledger_id`, `barber_id`, `business_date`, `method`, `kind`, `amount`, `owed_at_entry`, `recorded_at`)
SELECT UUID(), `id`, `barber_id`, `business_date`, 'CASH', 'OPENING', `cash_paid`,
       CASE WHEN `paid_at` IS NOT NULL THEN LEAST(`total_owed`, `cash_paid` + `gcash_paid`) ELSE `total_owed` END,
       COALESCE(`paid_at`, `updated_at`)
FROM `daily_payout_ledgers` WHERE `cash_paid` <> 0;

INSERT INTO `payout_entries` (`id`, `ledger_id`, `barber_id`, `business_date`, `method`, `kind`, `amount`, `owed_at_entry`, `recorded_at`)
SELECT UUID(), `id`, `barber_id`, `business_date`, 'GCASH', 'OPENING', `gcash_paid`,
       CASE WHEN `paid_at` IS NOT NULL THEN LEAST(`total_owed`, `cash_paid` + `gcash_paid`) ELSE `total_owed` END,
       COALESCE(`paid_at`, `updated_at`)
FROM `daily_payout_ledgers` WHERE `gcash_paid` <> 0;

-- paid_at now means "has entries". An old row with an amount but no paid tick gets one, and
-- its cash now counts against that day's drawer.
UPDATE `daily_payout_ledgers` SET `paid_at` = `updated_at`
WHERE `paid_at` IS NULL AND (`cash_paid` <> 0 OR `gcash_paid` <> 0);
