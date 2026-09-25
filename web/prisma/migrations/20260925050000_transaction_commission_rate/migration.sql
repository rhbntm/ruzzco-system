-- Snapshot the commission rate on each sale. Hand-edited from `prisma migrate diff`: a plain
-- `ADD COLUMN ... NOT NULL` would give existing rows an implicit 0.00 rate.

-- AlterTable: nullable first so existing rows can be backfilled
ALTER TABLE `transactions` ADD COLUMN `commission_rate` DECIMAL(5, 2) NULL;

-- Backfill: no code path has ever changed a barber's rate, so the current rate is the rate
-- every existing sale was recorded with. The barber FK guarantees a match for every row.
UPDATE `transactions` t
  JOIN `barbers` b ON b.`id` = t.`barber_id`
  SET t.`commission_rate` = b.`commission_rate`
  WHERE t.`commission_rate` IS NULL;

-- AlterTable: fails (strict mode) if any row is still NULL, so nothing is left unfilled
ALTER TABLE `transactions` MODIFY `commission_rate` DECIMAL(5, 2) NOT NULL;
