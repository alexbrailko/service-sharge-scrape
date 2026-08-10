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
  normalizeListingUrl,
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
import { hardenPage } from './hardenPage';

const ROTATE_BROWSER_EVERY_N_BANDS = 10;
const MAX_CONSECUTIVE_BLOCKS = 5;
const MAX_CONSECUTIVE_EMPTY_BANDS = 6;
const RESCRAPE_AFTER_DAYS = parseInt(
  process.env.RESCRAPE_AFTER_DAYS || '85',
  10
);
const BLOCK_BACKOFF_BASE_MS = 60000;
const BLOCK_BACKOFF_MAX_MS = 15 * 60000;

const CHALLENGE_CLEAR_TIMEOUT_MS = 45000;
const CHALLENGE_POLL_MS = 2000;
const CHALLENGE_RETRY_SELECTOR_MS = 15000;

export const BLOCK_ABORT_MESSAGE = 'consecutive Cloudflare challenges';

const isChallengePage = async (page: any): Promise<boolean> => {
  try {
    const title = ((await page.title()) || '').toLowerCase();
    if (
      /just a moment|attention required|verify you are human|access denied/.test(
        title
      )
    ) {
      return true;
    }
    const content = (await page.content()).toLowerCase();
    return content.includes('_cf_chl_opt');
  } catch {
    return false;
  }
};

const waitForChallengeToClear = async (page: any): Promise<boolean> => {
  const deadline = Date.now() + CHALLENGE_CLEAR_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await delay(CHALLENGE_POLL_MS);
    if (!(await isChallengePage(page))) return true;
  }
  return false;
};

export type RunStats = {
  bandsScanned: number;
  bandsBlocked: number;
  bandsEmpty: number;
  browserRotations: number;
  stoppedEarly: boolean;
  aborted: boolean;
};

let runStats: RunStats = {
  bandsScanned: 0,
  bandsBlocked: 0,
  bandsEmpty: 0,
  browserRotations: 0,
  stoppedEarly: false,
  aborted: false,
};

export const getRunStats = (): RunStats => ({ ...runStats });

export const resetRunStats = (): void => {
  runStats = {
    bandsScanned: 0,
    bandsBlocked: 0,
    bandsEmpty: 0,
    browserRotations: 0,
    stoppedEarly: false,
    aborted: false,
  };
};

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
  prisma: PrismaClient | null,
  page: Page,
  browser: Browser,
  reconnect?: () => Promise<{ browser: any; page: any }>
) => {
  let newUrl = firstUrl;
  let currentPage: any = page;
  let currentBrowser: any = browser;
  let consecutiveBlocks = 0;
  let consecutiveEmptyBands = 0;

  resetRunStats();

  const rotateBrowser = async (why: string): Promise<void> => {
    if (!reconnect) return;
    console.log(`Rotating browser (${why})`);
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
    runStats.browserRotations++;
    try {
      await currentPage.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    } catch (e) {
      console.log('Error navigating to BASE_URL after rotation:', e);
    }
  };

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
      await rotateBrowser(`after ${index} bands`);
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

    let outcome: BandOutcome = { blocked: false, rendered: false };
    let bandErrored = false;

    try {
      outcome = await scrapeEachPage(
        newUrl,
        prisma,
        currentPage,
        currentBrowser
      );
    } catch (e) {
      bandErrored = true;
      console.log(
        `Band ${priceMin}-${priceMax} failed, continuing to next band:`,
        e
      );
    }

    runStats.bandsScanned++;

    if (outcome.blocked) {
      consecutiveBlocks++;
      consecutiveEmptyBands = 0;
      runStats.bandsBlocked++;

      if (consecutiveBlocks >= MAX_CONSECUTIVE_BLOCKS) {
        runStats.aborted = true;
        throw new Error(
          `Aborting run after ${consecutiveBlocks} ${BLOCK_ABORT_MESSAGE} (last band ${priceMin}-${priceMax})`
        );
      }

      const backoffMs = Math.min(
        BLOCK_BACKOFF_BASE_MS * 2 ** (consecutiveBlocks - 1),
        BLOCK_BACKOFF_MAX_MS
      );
      console.log(
        `Cloudflare challenge ${consecutiveBlocks}/${MAX_CONSECUTIVE_BLOCKS} — backing off ${
          backoffMs / 1000
        }s then rotating browser`
      );
      await delay(backoffMs);
      await rotateBrowser(`Cloudflare challenge on band ${priceMin}-${priceMax}`);
    } else {
      consecutiveBlocks = 0;

      if (outcome.rendered || bandErrored) {
        consecutiveEmptyBands = 0;
      } else {
        consecutiveEmptyBands++;
        runStats.bandsEmpty++;

        if (consecutiveEmptyBands >= MAX_CONSECUTIVE_EMPTY_BANDS) {
          runStats.stoppedEarly = true;
          console.log(
            `Stopping after ${consecutiveEmptyBands} consecutive empty bands (last ${priceMin}-${priceMax})`
          );
          break;
        }
      }
    }

    if (priceMax >= 10000000) {
      break;
    }

    newUrl = updateURLParameter(newUrl, 'pn', 1);
  }

  //finish scraping
  clearScrapedDataFile();
};

export type BandOutcome = { blocked: boolean; rendered: boolean };

export const scrapeEachPage = async (
  url: string,
  prisma: PrismaClient | null,
  page: Page,
  browser: Browser
): Promise<BandOutcome> => {
  let blocked = false;
  let rendered = false;

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
      rendered = true;
    } catch (e) {
      // The listings container didn't render in 7s. Usually one of:
      //   - the price band is genuinely empty (no results) -> expected, skip it;
      //   - the page was blocked (Cloudflare challenge) or failed to load -> flag it.
      const sp = new URL(mainUrl).searchParams;
      const band = `${sp.get('price_min')}-${sp.get('price_max')}`;

      if (await isChallengePage(page)) {
        console.log(
          `Cloudflare challenge on band ${band} — waiting up to ${
            CHALLENGE_CLEAR_TIMEOUT_MS / 1000
          }s for it to clear`
        );

        if (await waitForChallengeToClear(page)) {
          try {
            await page.waitForSelector("div[data-testid='regular-listings']", {
              timeout: CHALLENGE_RETRY_SELECTOR_MS,
            });
            rendered = true;
            console.log(`Challenge cleared for band ${band} — continuing`);
          } catch {
            blocked = true;
          }
        } else {
          blocked = true;
        }

        if (blocked) {
          console.log(
            `regular-listings not found for band ${band} — BLOCKED (challenge did not clear in ${
              CHALLENGE_CLEAR_TIMEOUT_MS / 1000
            }s); moving on.`
          );
          break;
        }
      } else {
        let title = '';
        let reason = 'no results / not loaded';
        try {
          title = (await page.title().catch(() => '')) || '';
          const lc = (await page.content()).toLowerCase();
          if (/no\s*results|couldn.?t find|found 0|0 results/.test(lc)) {
            reason = 'empty band (0 results)';
          }
        } catch {}
        console.log(
          `regular-listings not found for band ${band} [title="${title}"] — ${reason}; moving on.`
        );
        break;
      }
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

    const toScrape = await filterAlreadyScraped(listingsList, prisma);

    let listings: ListingNoId[] = [];

    if (toScrape.length) {
      try {
        listings = await scrapeListings(toScrape, browser);
      } catch (e) {
        console.log('scrapeListings batch failed, continuing pagination:', e);
        listings = [];
      }
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

  return { blocked, rendered };
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
        url: normalizeListingUrl(BASE_URL + url),
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

export const filterAlreadyScraped = async (
  listings: ListingMainPage[],
  prisma: PrismaClient | null
): Promise<ListingMainPage[]> => {
  const byUrl = new Map<string, ListingMainPage>();
  for (const listing of listings) {
    if (listing && listing.url && !byUrl.has(listing.url)) {
      byUrl.set(listing.url, listing);
    }
  }
  const unique = Array.from(byUrl.values());
  const inBatchDupes = listings.length - unique.length;

  if (isDev || !prisma || !unique.length) {
    if (inBatchDupes) {
      console.log(`dropped ${inBatchDupes} in-batch duplicate urls`);
    }
    return unique;
  }

  const cutoff = new Date(Date.now() - RESCRAPE_AFTER_DAYS * 86400000);

  const existing = await prisma.listing.findMany({
    where: {
      OR: unique.map((l) => ({ url: { startsWith: l.url } })),
      scrapedAt: { gte: cutoff },
    },
    select: { url: true },
  });

  const seen = new Set(existing.map((e) => normalizeListingUrl(e.url)));
  const fresh = unique.filter((l) => !seen.has(l.url));
  const alreadyHave = unique.length - fresh.length;

  if (inBatchDupes || alreadyHave) {
    console.log(
      `skipping ${alreadyHave} already scraped within ${RESCRAPE_AFTER_DAYS}d` +
        `${inBatchDupes ? ` + ${inBatchDupes} in-batch dupes` : ''}; ${
          fresh.length
        } left to scrape`
    );
  }

  return fresh;
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
    await hardenPage(page);
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
  prisma: PrismaClient | null
) => {
  if (isDev || !prisma) {
    console.log(`[dev] would save ${listings.length} listings:`);
    listings.forEach((l, i) => {
      console.log(
        `  ${i + 1}. £${l.listingPrice} | serviceCharge £${
          l.serviceCharge
        } | groundRent ${l.groundRent ?? '—'} | ${l.postCode || 'no postcode'} | ${
          l.beds
        } bed | ${l.url}`
      );
    });
    return;
  }

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
      if ((e as any)?.code === 'P2002') {
        console.log(`duplicate blocked by unique index: ${listings[i].url}`);
        continue;
      }
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
  prisma: PrismaClient | null
) => {
  if (isDev || !prisma) return listings;

  const kept: ListingNoId[] = [];

  for (const listing of listings) {
    const [latestListing] = await prisma.listing.findMany({
      where: { url: { startsWith: listing.url } },
      orderBy: { scrapedAt: 'desc' },
      take: 1,
    });

    if (!latestListing) {
      kept.push(listing);
      continue;
    }

    const chargeChanged = numberDifferencePercentage(
      listing.serviceCharge,
      latestListing.serviceCharge,
      5
    );

    const enoughTimePassed = isNMonthsApart(
      listing.datePosted,
      latestListing.datePosted,
      3
    );

    if (chargeChanged && enoughTimePassed) {
      kept.push(listing);
    } else {
      console.log(
        `skipped existing listing (chargeChanged=${chargeChanged}, enoughTimePassed=${enoughTimePassed}): ${listing.url}`
      );
    }
  }

  return kept;
};

export const getLatestScrapedPostDate = async (
  prisma: PrismaClient | null,
  priceMin: number,
  priceMax: number
) => {
  if (isDev || !prisma) {
    if (!latestPostDate) {
      latestPostDate = moment().subtract(9999, 'd').toDate();
    }
    return;
  }

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
