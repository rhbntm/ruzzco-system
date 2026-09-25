-- AlterTable
ALTER TABLE `transactions` ADD COLUMN `assignment_id` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `transactions_assignment_id_idx` ON `transactions`(`assignment_id`);

-- AddForeignKey
ALTER TABLE `transactions` ADD CONSTRAINT `transactions_assignment_id_fkey` FOREIGN KEY (`assignment_id`) REFERENCES `device_assignments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

