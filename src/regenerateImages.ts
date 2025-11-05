import { PrismaClient } from '@prisma/client';
import path from 'path';
import fs from 'fs';
import { saveImage } from './zoopla';
import { delay } from './helpers';
import { closeSharedSnapshotBrowser } from './renderMapSnapshot';

const BATCH_SIZE = 2; // Reduced concurrency for stability
const PROGRESS_FILE = path.join(
  process.cwd(),
  'image-regeneration-progress.json'
);
const IMAGE_TIMEOUT_MS = 30_000; // per-image timeout
const MAX_RETRIES = 2; // per-image retry count

async function main() {
  const prisma = new PrismaClient();
  console.log('Starting image regeneration...');

  try {
    await prisma.$connect();
    console.log('Connected to database');

    // Check for existing progress
    let lastId: string | null = null;
    let processedCount = 0;
    let failedIds: string[] = [];

    if (fs.existsSync(PROGRESS_FILE)) {
      try {
        const data = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'));
        lastId = data.lastId || null;
        processedCount = data.processedCount || 0;
        failedIds = data.failedIds || [];
        console.log(
          `Resuming from ID: ${lastId} (${processedCount} images processed)`
        );
        if (failedIds.length)
          console.log(`Previously failed ids: ${failedIds.length}`);
      } catch (e) {
        console.error('Error reading progress file:', e);
      }
    }

    // Get listings to process
    const listings = await prisma.listing.findMany({
      where: {
        coordinates: {
          not: '',
        },
        ...(lastId && {
          id: {
            gt: lastId,
          },
        }),
      },
      select: {
        id: true,
        coordinates: true,
      },
      orderBy: {
        id: 'asc',
      },
    });

    console.log(`Found ${listings.length} listings to process`);

    // Helper: run a promise with timeout
    const withTimeout = <T>(p: Promise<T>, ms: number) => {
      return Promise.race([
        p,
        new Promise<T>((_, rej) =>
          setTimeout(() => rej(new Error('timeout')), ms)
        ),
      ]);
    };

    // Process in batches
    for (let i = 0; i < listings.length; i += BATCH_SIZE) {
      const batch = listings.slice(i, i + BATCH_SIZE);

      // process batch items concurrently but handle per-image retries/timeouts
      await Promise.all(
        batch.map(async (listing) => {
          let success = false;
          for (let attempt = 1; attempt <= MAX_RETRIES && !success; attempt++) {
            try {
              await withTimeout(
                saveImage(
                  listing.id,
                  listing.coordinates,
                  process.env.IMAGES_PATH
                ),
                IMAGE_TIMEOUT_MS
              );
              processedCount++;
              console.log(
                `[${processedCount}] Regenerated image for listing ${listing.id}`
              );
              success = true;
            } catch (err) {
              console.error(
                `Attempt ${attempt} failed for ${listing.id}:`,
                err?.message || err
              );
              if (attempt < MAX_RETRIES) await delay(1000 * attempt);
            }
          }

          if (!success) {
            console.error(
              `Failed to regenerate image for listing ${listing.id} after ${MAX_RETRIES} attempts`
            );
            failedIds.push(listing.id);
          }

          // persist progress after each image (so we can resume reliably)
          try {
            fs.writeFileSync(
              PROGRESS_FILE,
              JSON.stringify(
                { lastId: listing.id, processedCount, failedIds },
                null,
                2
              )
            );
          } catch (e) {
            console.error('Failed to write progress file:', e);
          }
        })
      );

      // Small delay between batches
      await delay(1000);
    }

    // If there were failures, attempt a dedicated retry pass with higher timeouts
    if (failedIds.length) {
      console.log(
        `Retrying ${failedIds.length} failed images with extended timeout...`
      );
      // increase per-image timeout for retry pass
      const RETRY_TIMEOUT_MS = IMAGE_TIMEOUT_MS * 2;
      const RETRY_ATTEMPTS = 3;

      // Close shared browser to reset state before retry pass
      try {
        await closeSharedSnapshotBrowser();
      } catch (e) {
        console.error(
          'Error closing shared snapshot browser before retry pass:',
          e
        );
      }

      for (const id of [...failedIds]) {
        let success = false;
        // fetch coordinates for this listing
        const listing = await prisma.listing.findUnique({
          where: { id },
          select: { coordinates: true },
        });
        if (!listing || !listing.coordinates) {
          console.warn(`Skipping ${id} - no coordinates available`);
          // remove from failedIds
          failedIds = failedIds.filter((x) => x !== id);
          continue;
        }

        for (
          let attempt = 1;
          attempt <= RETRY_ATTEMPTS && !success;
          attempt++
        ) {
          try {
            await withTimeout(
              saveImage(id, listing.coordinates, process.env.IMAGES_PATH),
              RETRY_TIMEOUT_MS
            );
            processedCount++;
            console.log(
              `(retry) [${processedCount}] Regenerated image for listing ${id}`
            );
            success = true;
            // remove id from failedIds
            failedIds = failedIds.filter((x) => x !== id);
            // persist progress
            fs.writeFileSync(
              PROGRESS_FILE,
              JSON.stringify({ lastId: id, processedCount, failedIds }, null, 2)
            );
          } catch (err) {
            console.error(
              `Retry attempt ${attempt} failed for ${id}:`,
              err?.message || err
            );
            // reset browser between attempts
            try {
              await closeSharedSnapshotBrowser();
            } catch (e) {}
            if (attempt < RETRY_ATTEMPTS) await delay(2000 * attempt);
          }
        }
      }
    }

    // Clean up progress file on successful completion (no remaining failures)
    if (fs.existsSync(PROGRESS_FILE) && failedIds.length === 0) {
      fs.unlinkSync(PROGRESS_FILE);
    }

    console.log(
      `Image regeneration completed. Total images processed: ${processedCount}`
    );
  } catch (error) {
    console.error('Error during regeneration:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);
