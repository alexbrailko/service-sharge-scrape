import { Browser, Page } from 'puppeteer';
import cron from 'node-cron';
import {
  initBrowser,
  connectPrisma,
  agreeOnTerms,
  preparePages,
  readScrapedData,
} from './zoopla';
import { delay } from './helpers';

const BASE_URL = 'https://www.zoopla.co.uk';
const STARTING_URL =
  'https://www.zoopla.co.uk/for-sale/flats/london/?page_size=25&search_source=for-sale&q=London&results_sort=newest_listings&search_source=refine&is_shared_ownership=false&is_retirement_home=false&price_min=50000&price_max=99999&pn=1';

let retryCount = 0;

// will run every Sunday at 8:00
cron.schedule(
  '0 8 * * 7',
  async function () {
    let browser: Browser;
    let page: Page;

    try {
      browser = await initBrowser();
      page = await browser.newPage();

      await start(browser, page);
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

      console.log('1');
      await delay(10000);
      browser = await initBrowser();
      page = await browser.newPage();
      console.log('2');
      await restart(browser, page);
    }
  },
  {
    runOnInit: false,
  }
);

const start = async (browser: Browser, page: Page) => {
  const prisma = await connectPrisma();
  const savedUrl = readScrapedData();
  const url = savedUrl ? savedUrl : STARTING_URL;

  await page.goto(BASE_URL, {
    waitUntil: 'networkidle2',
  });

  await agreeOnTerms(page);
  await preparePages(url, prisma, page, browser);

  await browser.close();
  await prisma.$disconnect();
};

const restart = async (browser: Browser, page: Page) => {
  try {
    // Consider exponential backoff for repeated retries:
    const delay = Math.min(2 ** retryCount * 60000, 300000); // Up to 5 minutes

    console.log(`Retrying after ${delay / 1000} seconds...`);
    await new Promise((resolve) => setTimeout(resolve, delay)); // Wait before restarting

    await start(browser, page);
  } catch (error) {
    console.error('Error during restart:', error.message);
    // Handle restart errors (optional)
  } finally {
    retryCount++; // Increment retry count

    if (retryCount === 3) {
      throw new Error('Maximum retries exceeded');
    }
  }
};
