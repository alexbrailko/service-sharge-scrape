-- CreateTable
CREATE TABLE `Listing` (
    `id` VARCHAR(191) NOT NULL,
    `url` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `datePosted` DATETIME(3) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `listingPrice` INTEGER NOT NULL,
    `beds` INTEGER NULL,
    `baths` INTEGER NULL,
    `address` VARCHAR(191) NOT NULL,
    `postCode` VARCHAR(191) NOT NULL,
    `serviceCharge` INTEGER NOT NULL,
    `groundRent` INTEGER NULL,
    `pictures` LONGTEXT NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
