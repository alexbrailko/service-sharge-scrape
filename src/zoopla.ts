import * as cheerio from 'cheerio';
import moment from 'moment';
//import { Browser, Page } from 'puppeteer';
import { PageWithCursor as Page } from 'puppeteer-real-browser';
import { Browser } from 'puppeteer-core';
import { Listing, PrismaClient } from '@prisma/client';
import {
  updateURLParameter,
  incrementPrice,
  numberDifferencePercentage,
  delay,
  isNMonthsApart,
  autoScroll,
} from './helpers';
import { ListingMainPage, ListingNoId } from './types';
import fs from 'fs';
import path from 'path';
import { getAddressData, getMapPictureUrl } from './api';
import {
  findArea,
  findCoordinates,
  findGroundRent,
  findServiceCharge,
} from './findData';
import {
  renderMapSnapshot,
  closeSharedSnapshotBrowser,
} from './renderMapSnapshot';

const ROTATE_BROWSER_EVERY_N_BANDS = 10;

var URL = require('url').URL;
require('dotenv').config();
// const puppeteer = addExtra(rebrowserPuppeteer as any);
// puppeteer.use(StealthPlugin());
// puppeteer.use(Adblocker({ blockTrackers: true }));

const BASE_URL = 'https://www.zoopla.co.uk';
const isDev = process.env.NODE_ENV === 'development';

// let page = null;
// let prisma = null;
let finishCurrentUrl = false;
let latestPostDate: Date | null = null;

// export const initBrowser = async () => {
//   try {
//     const browser = await puppeteer.launch();
//     return browser;
//   } catch (e) {
//     console.log('Error initBrowser', e);
//     throw e;
//   }
// };

export const connectPrisma = async () => {
  const prisma = new PrismaClient();

  try {
    await prisma.$connect();
  } catch (e) {
    console.log('Connection error', e);
  }
  return prisma;
};

export const agreeOnTerms = async (page: Page) => {
  try {
    await page.waitForSelector('#usercentrics-cmp-ui', { timeout: 7000 });

    // const frame = await elementHandle.contentFrame();
    // const button = await frame.$('#save');

    await page.click('>>> .uc-accept-button');
  } catch (e) {
    console.log('Error agreeOnTerms', e);
  }
};
export const preparePages = async (
  firstUrl: string,
  prisma: PrismaClient,
  page: Page,
  browser: Browser,
  reconnect?: () => Promise<{ browser: any; page: any }>
) => {
  let newUrl = firstUrl;
  let currentPage: any = page;
  let currentBrowser: any = browser;

  for (let index = 0; index < 97; index++) {
    if (!currentBrowser.connected) {
      throw new Error(
        'Browser disconnected — aborting preparePages so cron can restart with fresh browser'
      );
    }

    if (
      reconnect &&
      index > 0 &&
      index % ROTATE_BROWSER_EVERY_N_BANDS === 0
    ) {
      console.log(`Rotating browser after ${index} bands`);
      try {
        const pages = await currentBrowser.pages();
        await Promise.all(pages.map((p: any) => p.close().catch(() => {})));
        await currentBrowser.close();
      } catch (e) {
        console.log('Error closing browser during rotation:', e);
      }
      try {
        await closeSharedSnapshotBrowser();
      } catch (e) {
        console.log('Error closing snapshot browser during rotation:', e);
      }

      const fresh = await reconnect();
      currentBrowser = fresh.browser;
      currentPage = fresh.page;
      try {
        await currentPage.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
      } catch (e) {
        console.log('Error navigating to BASE_URL after rotation:', e);
      }
    }

    const url = new URL(newUrl);
    const search_params = url.searchParams;
    const priceMin = parseInt(search_params.get('price_min'));
    const priceMax = parseInt(search_params.get('price_max'));

    await delay();

    if (index > 0) {
      newUrl = updateURLParameter(
        newUrl,
        'price_min',
        incrementPrice(priceMin)
      );
      newUrl = updateURLParameter(
        newUrl,
        'price_max',
        incrementPrice(priceMax, true)
      );
    }

    try {
      await scrapeEachPage(newUrl, prisma, currentPage, currentBrowser);
    } catch (e) {
      console.log(
        `Band ${priceMin}-${priceMax} failed, continuing to next band:`,
        e
      );
    }

    // Stop once we reach the £10M ceiling. This was `== 10000000`, which never
    // matched: incremented bands end in ...499999/...999999, so the scrape ran on
    // for dozens of empty multi-million-pound bands (and hammered Cloudflare).
    if (priceMax >= 10000000) {
      break;
    }

    newUrl = updateURLParameter(newUrl, 'pn', 1);
  }

  //finish scraping
  clearScrapedDataFile();
};

export const scrapeEachPage = async (
  url: string,
  prisma: PrismaClient,
  page: Page,
  browser: Browser
) => {
  try {
    // Set a longer timeout for navigation
    await page.setDefaultNavigationTimeout(60000);

    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
  } catch (e) {
    console.log('Error going to url', e);
    await delay(15000); // Wait before giving up
    try {
      await page.reload({ waitUntil: 'domcontentloaded' });
    } catch (reloadError) {
      throw new Error('Failed to load url after retry');
    }
  }

  const html = await page.content();
  const $ = cheerio.load(html);

  const numberOfPages = 40;

  let mainUrl = url;
  let listingsData: ListingNoId[] = [];

  for (var i = 0; i < numberOfPages; i++) {
    console.log('url', mainUrl);

    await page.goto(mainUrl, {
      waitUntil: ['domcontentloaded'],
    });

    await delay();
    await delay();

    try {
      await page.waitForSelector("div[data-testid='regular-listings']", {
        timeout: 7000,
      });
    } catch (e) {
      // The listings container didn't render in 7s. Usually one of:
      //   - the price band is genuinely empty (no results) -> expected, skip it;
      //   - the page was blocked (Cloudflare challenge) or failed to load -> flag it.
      const sp = new URL(mainUrl).searchParams;
      const band = `${sp.get('price_min')}-${sp.get('price_max')}`;
      let title = '';
      let reason = 'no results / not loaded';
      try {
        title = (await page.title().catch(() => '')) || '';
        const t = title.toLowerCase();
        const lc = (await page.content()).toLowerCase();
        // A real Cloudflare challenge is identified by its page title and the
        // `_cf_chl_opt` script var — body keywords alone gave false positives.
        if (
          /just a moment|attention required|verify you are human|access denied/.test(
            t
          ) ||
          lc.includes('_cf_chl_opt')
        ) {
          reason = 'BLOCKED (Cloudflare challenge)';
        } else if (/no\s*results|couldn.?t find|found 0|0 results/.test(lc)) {
          reason = 'empty band (0 results)';
        }
      } catch {}
      console.log(
        `regular-listings not found for band ${band} [title="${title}"] — ${reason}; moving on.`
      );
      break;
    }

    const url = new URL(mainUrl);
    // get access to URLSearchParams object
    const search_params = url.searchParams;
    // get url parameters
    const pn = parseInt(search_params.get('pn'));
    const priceMin = parseInt(search_params.get('price_min'));
    const priceMax = parseInt(search_params.get('price_max'));
    const newUrl = updateURLParameter(mainUrl, 'pn', pn + 1);
    mainUrl = newUrl;

    await getLatestScrapedPostDate(prisma, priceMin, priceMax);

    saveScrapedData(url, latestPostDate);

    const listingsList = await scrapeListingsList(page);

    if (!listingsList.length) {
      break;
    }

    let listings: ListingNoId[] = [];

    try {
      listings = await scrapeListings(listingsList, browser);
    } catch (e) {
      console.log('scrapeListings batch failed, continuing pagination:', e);
      listings = [];
    }

    listingsData.push.apply(listingsData, listings);

    // remove duplicates from listings
    if (listingsData.length) {
      listingsData = await checkServiceChargeHistory(listingsData, prisma);

      if (listingsData.length) await saveToDb(listingsData, prisma);

      if (listingsData.length && isDev) {
        //console.log(`${listings.length} listings saved to db`);
      }

      listingsData = [];
    }

    if (finishCurrentUrl) {
      console.log('finishCurrentUrl');

      finishCurrentUrl = false;
      latestPostDate = null;
      break;
    }

    // go to new page

    try {
      await Promise.all([
        page.waitForNavigation(),
        page.goto(mainUrl, {
          waitUntil: ['domcontentloaded'],
        }),
        //page.waitForSelector("div[data-testid^='regular-listings']", { timeout: 3000 }),
      ]);

      const nextLink = await page.evaluateHandle(() => {
        const nav = document.querySelector('nav[aria-label="pagination"]');
        if (!nav) return null;

        return Array.from(nav.querySelectorAll('a')).find((el) =>
          el.textContent?.includes('Next')
        );
      });
      const isLastPage = await (nextLink as any).evaluate((el: any) =>
        el?.getAttribute('aria-disabled') === 'true'
      );

      if (isLastPage) {
        console.log('LAST PAGE');
        break;
      }
    } catch (e) {
      console.log(
        'Error in scrapeEachPage, wait for regular-listings selector'
      );
      //await page.reload({ waitUntil: ["networkidle0", "domcontentloaded"] });
      break;
    }
  }
};

export const scrapeListingsList = async (page: Page) => {
  const html = await page.content();
  const $ = cheerio.load(html);

  const listingsContainer = $("div[data-testid='regular-listings']").children();

  if (!listingsContainer.length) {
    console.log('No listings found');
    finishCurrentUrl = true;
  }

  const listings = $(listingsContainer)
    .map((index, element) => {
      const url = $(element).find('a').attr('href');
      const date = new Date();

      let listingPrice: string | number = $(element)
        .find("[class*='price_priceText__']")
        .text()
        .replace('£', '')
        .replaceAll(',', '');
      // if string has numbers
      if (listingPrice.match(/^[0-9]+$/)) {
        listingPrice = parseInt(listingPrice);
      } else {
        listingPrice = 0;
      }

      const dateFormatted = moment(date, 'Do MMM YYYY').toDate();
      const timezoneOffset = dateFormatted.getTimezoneOffset() * 60000;
      const datePosted = new Date(dateFormatted.getTime() - timezoneOffset);

      const lastReduced = $(element).find("span:contains('Last reduced')");

      if (!url) {
        return null;
      }

      if (lastReduced.length && moment(datePosted) <= moment(latestPostDate)) {
        return null;
      }

      const propertyOfTheWeek = $(element).find(
        "div:contains('Property of the week')"
      );

      if (propertyOfTheWeek.length) {
        return null;
      }

      const highlighted = $(element).find("div:contains('Highlight')");

      if (highlighted.length) {
        return null;
      }

      const backToMarket = $(element).find("div:contains('Back to market')");

      if (backToMarket.length) {
        return null;
      }

      // if (moment(datePosted) <= moment(latestPostDate)) {
      //   finishCurrentUrl = true;
      // }

      // if (
      // datePosted > moment().subtract(1, 'day') &&
      //  moment(datePosted) > moment(latestPostDate)
      // ) {
      return {
        url: BASE_URL + url,
        datePosted,
        listingPrice,
      };
      // }
    })
    .filter((listing) => listing !== null)
    .get();

  const filteredByDate = listings.filter(
    (obj) => moment(obj.datePosted) < moment(latestPostDate)
  );

  if (filteredByDate.length > 2) {
    finishCurrentUrl = true;
    console.log('finishCurrentUrl');
    return [];
  } else if (filteredByDate.length && filteredByDate.length <= 2) {
    return listings.filter(
      (listing) => moment(listing.datePosted) > moment(latestPostDate)
    );
  } else {
    return listings;
  }
};

type InFlightListing = Omit<ListingNoId, 'serviceCharge'> & {
  serviceCharge: number | null;
};

export const scrapeListings = async (
  listings: ListingMainPage[],
  browser: Browser
): Promise<ListingNoId[]> => {
  if (!listings.length) return [];

  const listingsData: InFlightListing[] = [];

  for (var i = 0; i < listings.length; i++) {
    const page = await browser.newPage();
    try {
      let html;

      for (let retry = 0; retry < 3; retry++) {
        try {
          await page.setDefaultNavigationTimeout(60000);
          await page.goto(listings[i].url, {
            waitUntil: 'domcontentloaded',
            timeout: 60000,
          });
          await delay(5000);
          // The 'Local area' map (which carries the coordinates) and other
          // below-the-fold sections render lazily on scroll. Scroll the page and
          // wait for the map source so it's actually in the snapshot — otherwise
          // findCoordinates gets an empty srcset and the listing is dropped.
          await autoScroll(page);
          await page
            .waitForSelector(
              'section[aria-labelledby="local-area"] picture source',
              { timeout: 5000 }
            )
            .catch(() => {});
          html = await page.content();
          break;
        } catch (e) {
          console.log(`Nav error (attempt ${retry + 1}/3):`, e);
          if (retry < 2) {
            await delay(15000);
            try {
              await page.reload({ waitUntil: 'domcontentloaded' });
            } catch (reloadError) {
              console.log('Reload failed, will retry with fresh navigation');
            }
            continue;
          }
          throw new Error(`scrapeListings Err - ${e}`);
        }
      }

      if (!html) {
        console.error(
          `Failed to scrape listing: ${listings[i].url} after 3 retries.`
        );
        throw new Error('Failed to scrape listings');
      }

      const $ = cheerio.load(html);

      let serviceCharge = findServiceCharge($);

      const container = $('div[aria-label="Listing details"]');

      const title = $(container).find('section h1').text();
      const address = $(container).find('section h1 address').text();

      let addressFull = '';
      let postCode = '';
      let coordinates: string | null = '';
      let groundRent: number | null = null;
      let bedsFind = $(container)
        .find("use[href='#bedroom-medium']")
        .parent()
        .parent()
        .text();

      let bathsFind = $(container)
        .find("use[href='#bathroom-medium']")
        .parent()
        .parent()
        .text();

      let areaFind = $(container)
        .find("use[href='#dimensions-medium']")
        .parent()
        .parent()
        .text();

      let beds = parseInt(bedsFind);
      let baths = parseInt(bathsFind);
      let area: number | null = parseInt(areaFind);
      if (!area) {
        area = findArea($);
      }

      if (serviceCharge) {
        coordinates = await findCoordinates($, page as any);

        if (!coordinates) {
          continue;
        }

        try {
          const addressData = await getAddressData(coordinates);

          if (!addressData) {
            continue;
          } else {
            addressFull = addressData.addressFull;
            postCode = addressData.postCode;
            coordinates = addressData.coordinates;
          }
        } catch (e) {
          console.log('Error getAddressData', e);
          continue;
        }

        groundRent = findGroundRent($);

        serviceCharge = serviceCharge > 40 ? serviceCharge : null;
      }

      const listingData: InFlightListing = {
        url: listings[i].url,
        type: 'flat',
        datePosted: listings[i].datePosted,
        scrapedAt: new Date(),
        title,
        listingPrice: listings[i].listingPrice,
        beds,
        baths,
        area: area,
        address,
        addressFull,
        postCode,
        coordinates,
        serviceCharge,
        groundRent,
        pictures: '',
        serviceChargeHistory: '',
      };

      listingsData.push(listingData);
    } catch (perListingErr) {
      // Skip this listing, but never let one bad listing kill the whole batch
      console.log(
        `Listing skipped (${listings[i]?.url}):`,
        (perListingErr as Error)?.message || perListingErr
      );
    } finally {
      // Always close the page — guarantees no leak on continue/throw/return
      try {
        await page.close();
      } catch (closeErr) {
        console.log('page.close error:', closeErr);
      }
    }
    await delay();
  }

  return listingsData.filter(
    (listing) => listing.serviceCharge !== null && listing.serviceCharge !== 0
  ) as ListingNoId[];
};
export const saveToDb = async (
  listings: ListingNoId[] = [],
  prisma: PrismaClient
) => {
  for (var i = 0; i < listings.length; i++) {
    try {
      const savedListing = await prisma.listing.create({
        data: listings[i],
      });

      // const imageUrl = await getMapPictureUrl(
      //   savedListing.coordinates,
      //   'Aerial'
      // );

      await saveImage(
        savedListing.id,
        savedListing.coordinates,
        process.env.IMAGES_PATH
      );
    } catch (e) {
      console.log('Error saving to db', e);
      continue;
    }
  }
  console.log(`${listings.length} listings saved to db`);
};

export const saveImage = async (
  id: Listing['id'],
  coords: Listing['coordinates'],
  dirPath: string = './images'
) => {
  if (!coords) return;
  const filePath = path.join(dirPath, `${id}.webp`);

  try {
    await renderMapSnapshot({ coords, outputFile: filePath });
  } catch (error) {
    console.error('Image save error', error);
  }
};

/**
 * Checks the service charge history for a list of listingsthat have the same address and beds but a different service charge. If service charge is less or more 5% from the last service charge, this listing will be added to database, otherwise it will be ignored.
 */
export const checkServiceChargeHistory = async (
  listings: ListingNoId[],
  prisma: PrismaClient
) => {
  let filteredListings = listings;

  for (const listing of listings) {
    const latestListings = await prisma.listing.findMany({
      where: {
        addressFull: {
          equals: listing.addressFull,
        },
        beds: {
          equals: listing.beds,
        },
      },
      orderBy: {
        datePosted: 'desc',
      },
      take: 1,
    });

    const latestListing = latestListings.length ? latestListings[0] : null;

    if (!latestListing) {
      continue;
    }

    const noScPriceDiff = !numberDifferencePercentage(
      listing.serviceCharge,
      latestListing.serviceCharge,
      5
    );

    const isLessThanThreeMonthApart = !isNMonthsApart(
      listing.datePosted,
      latestListing.datePosted,
      3
    );

    if ((latestListing && noScPriceDiff) || isLessThanThreeMonthApart) {
      // remove irrelevant listing
      filteredListings = filteredListings.filter(
        (l) => l.addressFull !== latestListing.addressFull
      );
    }
  }

  return filteredListings;
};

export const getLatestScrapedPostDate = async (
  prisma: PrismaClient,
  priceMin: number,
  priceMax: number
) => {
  if (!latestPostDate) {
    const latestPost = await prisma.listing.findMany({
      where: {
        listingPrice: {
          gt: priceMin,
          lte: priceMax,
        },
      },
      orderBy: {
        datePosted: 'desc',
      },
      take: 1,
    });

    if (latestPost.length) {
      latestPostDate = latestPost[0].datePosted;
    } else {
      // if no listings in db, scrape posts from last x days
      // const d = new Date();
      latestPostDate = moment().subtract(9999, 'd').toDate();
    }
  }
};

export const saveScrapedData = (url: string, latestPostDate: Date | null) => {
  const data = { url, latestPostDate };
  const filePath = path.join('./src/', 'scrapeData.json');

  try {
    fs.writeFileSync(filePath, JSON.stringify(data));
  } catch (error) {
    console.error('Error saving data:', error);
    throw error;
  }
};

export const readScrapedData = () => {
  const filePath = path.join('./src/', 'scrapeData.json');

  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, '{}');
  }

  try {
    const data = fs.readFileSync(filePath, 'utf8');

    if (data) {
      const parsedData = JSON.parse(data);

      latestPostDate = parsedData.latestPostDate || null;
      return parsedData.url;
    }

    return '';
  } catch (error) {
    console.error('Error readScrapedData', error);
    throw error;
  }
};

export const clearScrapedDataFile = () => {
  const filePath = path.join('./src/', 'scrapeData.json');
  fs.writeFile(filePath, '', function () {
    console.log('cleared scrapeData.json');
  });
};

const BATCH_SIZE = 5; // Number of parallel operations
const PROGRESS_FILE = 'image-regeneration-progress.json';

interface RegenerationProgress {
  completedIds: string[];
  totalCount: number;
  lastProcessedId?: string;
}

const saveProgress = (progress: RegenerationProgress) => {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
};

const loadProgress = (): RegenerationProgress | null => {
  try {
    if (fs.existsSync(PROGRESS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'));
      return parsed as RegenerationProgress;
    }
  } catch (error) {
    console.error('Error reading progress file:', error);
  }
  return null;
};
