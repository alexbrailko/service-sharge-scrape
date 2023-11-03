/*
  Warnings:

  - Added the required column `addressFull` to the `Listing` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE `Listing` ADD COLUMN `addressFull` VARCHAR(191) NOT NULL;
