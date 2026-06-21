//import { Page, Browser } from 'puppeteer-core';
//import { connect, PageWithCursor as Page } from 'puppeteer-real-browser';

import cron from 'node-cron';
import { startPeriodicDiagnostics } from './diagnostics';
import {
  getSharedSnapshotBrowser,
  closeSharedSnapshotBrowser,
} from './renderMapSnapshot';
import {
  connectPrisma,
  agreeOnTerms,
  preparePages,
  readScrapedData,
} from './zoopla';
import { delay } from './helpers';
//import puppeteer from 'puppeteer';
import { connect, PageWithCursor as Page } from 'puppeteer-real-browser';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const isDev = process.env.NODE_ENV === 'development';
const BASE_URL = 'https://www.zoopla.co.uk';
const STARTING_URL =
  'https://www.zoopla.co.uk/for-sale/flats/london/?page_size=25&search_source=for-sale&search_source=refine&q=London&results_sort=newest_listings&is_shared_ownership=false&is_retirement_home=false&price_min=50000&price_max=99999&property_sub_type=flats&tenure=freehold&tenure=leasehold&is_auction=false&pn=1';

let retryCount = 0;
let currentScraperBrowser: any = null;
// Prevents runOnInit + the weekly cron + self-restart from stacking two scrapes.
let isRunning = false;

// Kill Chrome orphaned by a previous crash/restart. puppeteer-real-browser
// launches real Chrome via chrome-launcher, whose profile dirs are /tmp/lighthouse.*.
// Linux-only (the server), and only ever called while no scrape of ours is active
// (guarded by isRunning / during shutdown), so it can never kill a live run.
const killStrayChrome = async () => {
  if (process.platform !== 'linux') return;
  try {
    await execAsync("pkill -f 'user-data-dir=/tmp/lighthouse' || true");
    await execAsync('rm -rf /tmp/lighthouse.* || true');
  } catch (e) {
    console.log('killStrayChrome (non-fatal):', (e as Error)?.message || e);
  }
};

const connectScraperBrowser = async () => {
  const conn = await connect({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    ],
    customConfig: !isDev
      ? { chromePath: '/usr/bin/chromium-browser' }
      : undefined,
    turnstile: true,
    connectOption: {},
    disableXvfb: false,
    ignoreAllFlags: false,
  });
  currentScraperBrowser = conn.browser;
  await conn.page.setViewport({ width: 1200, height: 800 });
  return { browser: conn.browser, page: conn.page };
};

// will run every Sunday at 8:00
cron.schedule(
  '0 8 * * 7',
  async function () {
    if (isRunning) {
      console.log('Scrape already running — skipping this trigger');
      return;
    }
    isRunning = true;

    try {
      // Clear any Chrome orphaned by a previous crash/restart before we start.
      await killStrayChrome();

      const { page, browser } = await connectScraperBrowser();

      try {
        await start(browser, page);

        // await page.goto(STARTING_URL, {
        //    waitUntil: ['networkidle0', 'domcontentloaded'],
        // });
      } catch (e) {
        console.error('EEE', e);
        try {
          await page.close();
        } catch (e) {
          console.log('Error page close');
        }

        try {
          await browser.close();
        } catch (e) {
          console.log('Error browser close');
        }

        await delay(10000);
        // Create a fresh connection and restart from clean state
        await restart();
      }
    } finally {
      isRunning = false;
    }
  },
  {
    runOnInit: true,
  }
);

const start = async (browser: any, page: any) => {
  const prisma = await connectPrisma();
  const savedUrl = readScrapedData();
  const url = savedUrl ? savedUrl : STARTING_URL;

  await page.goto(BASE_URL, {
    waitUntil: 'domcontentloaded',
  });

  //await agreeOnTerms(page);

  await preparePages(url, prisma, page, browser, connectScraperBrowser);

  try {
    const pages = await browser.pages();
    await Promise.all(pages.map((p: any) => p.close().catch(() => {})));
    await browser.close();
    currentScraperBrowser = null;
  } catch (e) {
    // ignore
  }
  currentScraperBrowser = null;
  await prisma.$disconnect();
};

const restart = async () => {
  try {
    // Consider exponential backoff for repeated retries:
    const delayMs = Math.min(2 ** retryCount * 60000, 300000); // Up to 5 minutes

    console.log(`Retrying after ${delayMs / 1000} seconds...`);
    await new Promise((resolve) => setTimeout(resolve, delayMs)); // Wait before restarting

    const { browser, page } = await connectScraperBrowser();
    await start(browser, page);
  } catch (error) {
    console.error('Error during restart:', error?.message || error);
  } finally {
    retryCount++; // Increment retry count

    if (retryCount === 3) {
      console.log('Maximum retries reached, restarting PM2 process...');
      try {
        // Run PM2 restart command
        exec('pm2 restart scraper', (error, stdout, stderr) => {
          if (error) {
            console.error('Failed to restart PM2 process:', error);
          } else {
            console.log('PM2 restart initiated:', stdout);
          }
          process.exit(1); // Exit the process to ensure PM2 restarts it
        });
      } catch (pmError) {
        console.error('Failed to execute PM2 restart command:', pmError);
        process.exit(1);
      }
    }
  }
};
// Periodic diagnostics logging is dev-only (noisy); the browser cleanup below is NOT.
let stopDiagnostics: (() => void) | null = null;
if (isDev) {
  stopDiagnostics = startPeriodicDiagnostics(60000, () => ({
    scraperBrowser: currentScraperBrowser,
    snapshotBrowser: getSharedSnapshotBrowser(),
  }));
}

// Graceful shutdown — ALWAYS registered (production included) so a PM2 stop or
// restart closes Chrome instead of orphaning it. This is the core leak fix:
// previously these handlers were inside `if (isDev)` and never ran on the server.
let shuttingDown = false;
async function gracefulShutdown(code = 0) {
  if (shuttingDown) return; // ignore duplicate signals
  shuttingDown = true;
  console.log('Shutting down - closing browsers');

  try {
    if (currentScraperBrowser) {
      const pages = await currentScraperBrowser.pages().catch(() => []);
      await Promise.all(pages.map((p: any) => p.close().catch(() => {})));
      await currentScraperBrowser.close().catch(() => {});
    }
  } catch (e) {
    console.log('Error closing scraper browser', e);
  }

  try {
    await closeSharedSnapshotBrowser();
  } catch (e) {
    console.log('Error closing snapshot browser', e);
  }

  // Belt-and-braces: even if puppeteer's close() left the chrome-launcher
  // process behind, make sure nothing survives into the next start.
  try {
    await killStrayChrome();
  } catch (e) {}

  try {
    stopDiagnostics?.();
  } catch (e) {}

  process.exit(code);
}

process.on('SIGINT', () => {
  console.log('SIGINT received');
  void gracefulShutdown(0);
});
process.on('SIGTERM', () => {
  console.log('SIGTERM received');
  void gracefulShutdown(0);
});
process.on('uncaughtException', (err) => {
  console.error('uncaughtException', err);
  void gracefulShutdown(1);
});
