-- Reconciliations become append-only revisions per business date.
-- Existing rows (at most one per date under the old unique key) become revision 1.

-- AlterTable
ALTER TABLE `shift_reconciliations` ADD COLUMN `revision` INTEGER NOT NULL DEFAULT 1;

-- CreateIndex
CREATE UNIQUE INDEX `shift_reconciliations_reconciliation_date_revision_key` ON `shift_reconciliations`(`reconciliation_date`, `revision`);

-- DropIndex
DROP INDEX `shift_reconciliations_reconciliation_date_key` ON `shift_reconciliations`;
