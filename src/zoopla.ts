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

var URL = require('url').URL;
const fetch = (...args) =>
  import('node-fetch').then(({ default: fetch }) => fetch(...args));
require('dotenv').config();
// const puppeteer = addExtra(rebrowserPuppeteer as any);
// puppeteer.use(StealthPlugin());
// puppeteer.use(Adblocker({ blockTrackers: true }));

const BASE_URL = 'https://www.zoopla.co.uk';
const isDev = process.env.NODE_ENV === 'development';

// let page = null;
// let prisma = null;
let finishCurrentUrl = false;
let latestPostDate = null;

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
  browser: Browser
) => {
  let newUrl = firstUrl;

  for (let index = 0; index < 97; index++) {
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

    await scrapeEachPage(newUrl, prisma, page, browser);

    if (priceMax == 10000000) {
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
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
    });
  } catch (e) {
    console.log('Error going to url', e);
    throw new Error('Failed to load url');
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
      console.log('Error regular-listings', e);
      break;
      //throw new Error('Failed to load regular-listings');
      //await browser.close();
      //finishCurrentUrl = true;
      // break;
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

    listings = await scrapeListings(listingsList, browser);

    listingsData.push.apply(listingsData, listings);

    // remove duplicates from listings
    if (listingsData.length) {
      listingsData = await checkServiceChargeHistory(listingsData, prisma);

      if (listingsData.length && !isDev) await saveToDb(listingsData, prisma);

      if (listingsData.length && isDev) {
        console.log(`${listings.length} listings saved to db`, listingsData);
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
          el.textContent.includes('Next')
        );
      });
      const isLastPage = await nextLink.evaluate(
        (el) => el.getAttribute('aria-disabled') === 'true'
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
        .find("p[data-testid='listing-price']")
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

export const scrapeListings = async (
  listings: ListingMainPage[],
  browser: Browser
): Promise<ListingNoId[]> => {
  if (!listings.length) return [];

  const listingsData: ListingNoId[] = [];

  for (var i = 0; i < listings.length; i++) {
    let html;
    const page = await browser.newPage();

    for (let retry = 0; retry < 3; retry++) {
      // Retry loop with maximum 3 attempts

      try {
        await Promise.all([
          page.waitForNavigation(),
          page.goto(listings[i].url, {
            waitUntil: ['domcontentloaded', 'networkidle2'],
          }),
        ]);

        await delay(3000);

        html = await page.content();
        break; // Exit retry loop on successful navigation
      } catch (e) {
        console.log('Nav error', e);
        // await delay(10000);
        // await page.close();
        // await delay();
        // await page.goto(listings[i].url, { waitUntil: 'networkidle2' }),

        throw new Error(`scrapeListings Err - ${e}`); // Re-throw other errors
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
    let coordinates = '';
    let groundRent = null;
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
    let area = parseInt(areaFind);
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

    const listingData: ListingNoId = {
      url: listings[i]?.url,
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

    await page.close();
    await delay();
  }

  return listingsData.filter(
    (listing) => listing.serviceCharge !== null && listing.serviceCharge !== 0
  );
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

      const imageUrl = await getMapPictureUrl(
        savedListing.coordinates,
        'Aerial'
      );
      await saveImage(savedListing, imageUrl, process.env.IMAGES_PATH);
    } catch (e) {
      console.log('Error saving to db', e);
      break;
    }
  }
  console.log(`${listings.length} listings saved to db`);
};

export const saveImage = async (
  listing: Listing,
  imageUrl: string,
  dirPath: string = './images'
) => {
  const filePath = path.join(dirPath, `${listing.id}.webp`);

  try {
    const response = await fetch(imageUrl);
    const buffer = await response.buffer();

    if (!fs.existsSync(filePath)) {
      await fs.promises.writeFile(filePath, buffer);
      // console.log('Image downloaded and saved successfully');
    } else {
      console.log('Image already exists, skipping creation.');
    }
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

export const saveScrapedData = (url: string, latestPostDate: Date) => {
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
