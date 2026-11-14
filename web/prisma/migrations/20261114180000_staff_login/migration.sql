-- Slice 19: staff login. Accounts on users (username, scrypt password hash, one barber per
-- BARBER account), and the signed-in account on each sale (information only).

-- AlterTable
ALTER TABLE `transactions` ADD COLUMN `user_id` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `users` ADD COLUMN `barber_id` VARCHAR(191) NULL,
    ADD COLUMN `is_active` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `last_sign_in_at` DATETIME(3) NULL,
    ADD COLUMN `password_changed_at` DATETIME(3) NULL,
    ADD COLUMN `password_hash` VARCHAR(255) NULL,
    ADD COLUMN `username` VARCHAR(32) NULL,
    MODIFY `email` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `transactions_user_id_idx` ON `transactions`(`user_id`);

-- CreateIndex
CREATE UNIQUE INDEX `users_username_key` ON `users`(`username`);

-- CreateIndex
CREATE UNIQUE INDEX `users_barber_id_key` ON `users`(`barber_id`);

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_barber_id_fkey` FOREIGN KEY (`barber_id`) REFERENCES `barbers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transactions` ADD CONSTRAINT `transactions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

