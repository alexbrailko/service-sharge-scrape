import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import Adblocker from 'puppeteer-extra-plugin-adblocker';
import * as cheerio from 'cheerio';
import moment from 'moment';
import { Browser, Page } from 'puppeteer';

import { Listing, PrismaClient } from '@prisma/client';
import { helpers } from './helpers';
import { ListingMainPage, ListingNoId, ServiceChargeHistory } from './types';
import fs from 'fs';
import path from 'path';
// import * as nodeUrl from "url";
var URL = require('url').URL;
const fetch = (...args) =>
  import('node-fetch').then(({ default: fetch }) => fetch(...args));
require('dotenv').config();

puppeteer.use(StealthPlugin());
puppeteer.use(Adblocker({ blockTrackers: true }));

const BASE_URL = 'https://www.zoopla.co.uk';

// let page = null;
// let prisma = null;
let finishScraping = false;
let latestPostDate = null;

const puppeteerArgs = {
  headless: true,
  // ignoreDefaultArgs: ['--enable-automation'],
  ignoreHTTPSErrors: true,
  slowMo: 0,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--window-size=1920,1080',
    '--remote-debugging-port=9222',
    '--remote-debugging-address=0.0.0.0', // You know what your doing?
    '--disable-gpu',
    '--disable-features=IsolateOrigins,site-per-process',
    '--blink-settings=imagesEnabled=true',
    '--disable-web-security',
  ],
};

export const initBrowser = async () => {
  const browser = await puppeteer.launch(puppeteerArgs);
  return browser;
};

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
    const elementHandle = await page.waitForSelector(
      '#gdpr-consent-tool-wrapper iframe'
    );

    const frame = await elementHandle.contentFrame();
    const button = await frame.$('#save');

    await button.click();
  } catch (e) {
    console.log('Error agreeOnTeerms', e);
  }
};

export const preparePages = async (
  firstUrl: string,
  prisma: PrismaClient,
  page: Page
) => {
  let newUrl = firstUrl;

  for (let index = 0; index < 43; index++) {
    const url = new URL(newUrl);
    const search_params = url.searchParams;
    const priceMin = parseInt(search_params.get('price_min'));
    const priceMax = parseInt(search_params.get('price_max'));

    await helpers.delay();

    if (index > 0) {
      newUrl = helpers.updateURLParameter(
        newUrl,
        'price_min',
        helpers.incrementPrice(priceMin)
      );
      newUrl = helpers.updateURLParameter(
        newUrl,
        'price_max',
        helpers.incrementPrice(priceMax, true)
      );
    }

    await scrapeEachPage(newUrl, prisma, page);

    if (priceMax == 10000000) {
      break;
    }

    newUrl = helpers.updateURLParameter(newUrl, 'pn', 1);
  }
};

export const scrapeEachPage = async (
  url: string,
  prisma: PrismaClient,
  page: Page
) => {
  try {
    await page.goto(url, { waitUntil: 'networkidle0' });
  } catch (e) {
    console.log('Error going to url', e);
  }

  const html = await page.content();
  const $ = cheerio.load(html);

  const numberOfPages = 40;

  let mainUrl = url;
  let listingsData: ListingNoId[] = [];

  for (var i = 0; i < numberOfPages; i++) {
    console.log('url', mainUrl);

    await page.goto(mainUrl, { waitUntil: 'networkidle0' });

    await helpers.delay();
    await helpers.delay();

    try {
      await page.waitForSelector("div[data-testid='regular-listings']", {
        timeout: 7000,
      });
    } catch (e) {
      console.log('E', e);
      //finishScraping = true;
      break;
    }

    const url = new URL(mainUrl);
    // get access to URLSearchParams object
    const search_params = url.searchParams;
    // get url parameters
    const pn = parseInt(search_params.get('pn'));
    const priceMin = parseInt(search_params.get('price_min'));
    const priceMax = parseInt(search_params.get('price_max'));
    const newUrl = helpers.updateURLParameter(mainUrl, 'pn', pn + 1);
    mainUrl = newUrl;

    await getLatestScrapedPostDate(prisma, priceMin, priceMax);

    const listingsList = await scrapeListingsList(
      priceMin,
      priceMax,
      prisma,
      page
    );

    const listings = await scrapeListings(listingsList, page);

    listingsData.push.apply(listingsData, listings);
    // remove duplicates from listings
    if (listingsData.length) {
      listingsData = listingsData.filter(
        (v, i, a) =>
          a.findIndex((v2) => ['address'].every((k) => v2[k] === v[k])) === i
      );

      listingsData = await addServiceChargeHistory(listingsData, prisma);

      console.log('listingsData length', listingsData.length);

      await saveToDb(listingsData, prisma);

      listingsData = [];
    }

    if (finishScraping) {
      console.log('finishScraping');

      finishScraping = false;
      latestPostDate = null;
      break;
    }

    // go to new page

    try {
      await Promise.all([
        page.waitForNavigation(),
        page.goto(mainUrl, {
          waitUntil: ['networkidle0', 'domcontentloaded'],
        }),
        //page.waitForSelector("div[data-testid^='regular-listings']", { timeout: 3000 }),
      ]);
      const isLastPage = $("div[data-testid='pagination']")
        .find("use[href='#arrow-right-medium']")
        .parent()
        .parent()
        .parent()
        .parent()
        .attr('aria-disabled');

      if (isLastPage === 'true') {
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

export const scrapeListingsList = async (
  priceMin: number,
  priceMax: number,
  prisma: PrismaClient,
  page: Page
) => {
  const html = await page.content();
  const $ = cheerio.load(html);

  const listingsContainer = $("div[data-testid='regular-listings']").children();

  if (!listingsContainer.length) {
    console.log('No listings found');
    finishScraping = true;
  }

  const listings = $(listingsContainer)
    .map((index, element) => {
      const url = $(element).find('a').attr('href');
      const beds = $(element)
        .find("use[href='#bedroom-medium']")
        .parent()
        .next()
        .text();
      const baths = $(element)
        .find("use[href='#bathroom-medium']")
        .parent()
        .next()
        .text();
      const area = $(element)
        .find("use[href='#dimensions-medium']")
        .parent()
        .next()
        .text();
      const date = $(element)
        .find("li:contains('Listed on')")
        .text()
        .replace('Listed on', '');
      const dateFormatted = moment(date, 'Do MMM YYYY').toDate();
      const timezoneOffset = dateFormatted.getTimezoneOffset() * 60000;
      const datePosted = new Date(dateFormatted.getTime() - timezoneOffset);

      const lastReduced = $(element).find("span:contains('Last reduced')");

      if (lastReduced.length && moment(datePosted) <= moment(latestPostDate)) {
        return null;
      }

      // if (moment(datePosted) <= moment(latestPostDate)) {
      //   finishScraping = true;
      // }

      // if (
      // datePosted > moment().subtract(1, 'day') &&
      //  moment(datePosted) > moment(latestPostDate)
      // ) {
      return {
        url: BASE_URL + url,
        beds: beds ? parseInt(beds) : null,
        baths: baths ? parseInt(baths) : null,
        area: area ? parseInt(area) : null,
        datePosted,
      };
      // }
    })
    .filter((listing) => listing !== null)
    .get();

  const filteredByDate = listings.filter(
    (obj) => moment(obj.datePosted) < moment(latestPostDate)
  );

  if (filteredByDate.length > 1) {
    finishScraping = true;
  }

  if (finishScraping) {
    return listings.filter(
      (listing) => moment(listing.datePosted) > moment(latestPostDate)
    );
  } else {
    return listings;
  }
};

export const scrapeListings = async (
  listings: ListingMainPage[],
  page: Page
) => {
  if (!listings.length) return;

  const listingsData: any = listings.map((listing) => ({
    url: listing.url,
    type: '',
    datePosted: listing.datePosted,
    title: '',
    listingPrice: 0,
    beds: listing.beds,
    baths: listing.baths,
    area: listing.area,
    address: '',
    addressFull: '',
    postCode: '',
    coordinates: '',
    serviceCharge: null,
    groundRent: null,
    pictures: '',
    serviceChargeHistory: null,
  }));

  for (var i = 0; i < listings.length; i++) {
    let html;

    try {
      await page.goto(listings[i].url, { waitUntil: 'load' });
      html = await page.content();
    } catch (e) {
      console.log('Error: scrapeListings for loop', e);
      console.log('url', listings[i].url);
      await helpers.delay();
      await helpers.delay();
      await page.reload({ waitUntil: ['networkidle0', 'domcontentloaded'] });
      await page.goto(listings[i].url, { waitUntil: 'load' });
    }

    await helpers.delay();

    const $ = cheerio.load(html);

    let listingPrice: string | number = $("p[data-testid='price']")
      .text()
      .replace('£', '')
      .replaceAll(',', '');
    // if string has numbers
    if (listingPrice.match(/^[0-9]+$/)) {
      listingPrice = parseInt(listingPrice);
    } else {
      listingPrice = 0;
    }

    let serviceCharge = await findServiceCharge($);

    const title = $('#listing-summary-details-heading p').text();

    let address = '';
    let addressFull = '';
    let postCode = '';
    let coordinates = '';
    let groundRent = null;
    //let pictures = [];

    if (serviceCharge) {
      const addressData = await findAddress($, page);
      address = addressData.address || '';
      addressFull = addressData.addressFull || '';
      postCode = addressData.postCode || '';
      const coordsNew = await modifyCoordinates(addressFull);
      coordinates = coordsNew ? coordsNew : addressData.coordinates;
      groundRent = await findGroundRent($);

      serviceCharge = serviceCharge > 40 ? serviceCharge : null;
    }

    listingsData[i].url = listings[i].url;
    listingsData[i].type = 'flat';
    listingsData[i].datePosted = listings[i].datePosted;
    listingsData[i].title = title;
    listingsData[i].listingPrice = listingPrice;
    listingsData[i].beds = listings[i].beds;
    listingsData[i].baths = listings[i].baths;
    listingsData[i].area = listings[i].area;
    listingsData[i].address = address;
    listingsData[i].addressFull = addressFull;
    listingsData[i].postCode = postCode;
    listingsData[i].coordinates = coordinates;
    listingsData[i].serviceCharge = serviceCharge;
    listingsData[i].groundRent = groundRent;
    //listings[i].pictures = JSON.stringify(pictures);

    if (i === listingsData.length - 1) {
      return listingsData.filter(
        (listing) =>
          listing.serviceCharge !== null && listing.serviceCharge !== 0
      );
    }
  }
};

export const findServiceCharge = async ($: cheerio.CheerioAPI) => {
  const text = 'service charge';

  const serviceChargeElem = $(
    "button[data-testid='service-charge-help-icon-wrapper']"
  )
    .parent()
    .parent();
  // .find('div:contains("Service charge:")');
  // .filter(function() {
  //   return $(this).text().indexOf('Service charge:') > -1;
  // })
  //.next().text();

  const serviceChargeText = $(serviceChargeElem).text();

  let serviceChargeAmount = null;

  if (serviceChargeText.includes('month')) {
    serviceChargeAmount =
      helpers.extractNumberFromString(serviceChargeText) * 12;
  } else {
    serviceChargeAmount = helpers.extractNumberFromString(serviceChargeText);
  }

  if (!serviceChargeAmount || serviceChargeText === 'Not available') {
    // search in features section
    if ($("div[data-testid='listing_features']")) {
      const filteredElement = helpers.findMatchedElement(
        $,
        "ul[data-testid='listing_features_bulletted'] li",
        text
      );
      if (filteredElement.length) {
        return helpers.extractNumberFromText($(filteredElement), text);
      }
    }

    // search in description
    const filteredElement = helpers.findMatchedElement(
      $,
      "div[data-testid='truncated_text_container']",
      text
    );

    if (filteredElement.length) {
      return helpers.extractNumberFromText($(filteredElement), text);
    } else {
      return null;
    }
  } else {
    return serviceChargeAmount;
  }
};

export const findGroundRent = async ($: cheerio.CheerioAPI) => {
  const text = 'ground rent';
  const groundRentElem = $(
    "button[data-testid='ground-rent-help-icon-wrapper']"
  )
    .parent()
    .parent();

  const groundRentText = $(groundRentElem).text();

  if (!groundRentText || groundRentText === 'Not available') {
    // search in features section
    if ($("div[data-testid='listing_features']")) {
      const filteredElement = helpers.findMatchedElement(
        $,
        "ul[data-testid='listing_features_bulletted'] li",
        text
      );

      if (filteredElement.length) {
        return helpers.extractNumberFromText($(filteredElement), text);
      }
    }

    // search in description
    const filteredElement = helpers.findMatchedElement(
      $,
      "div[data-testid='truncated_text_container']",
      text
    );

    if (filteredElement.length) {
      return helpers.extractNumberFromText($(filteredElement), text);
    } else {
      return null;
    }
  } else {
    return helpers.extractNumberFromString(groundRentText);
  }
};

export const findAddress = async ($: cheerio.CheerioAPI, page: Page) => {
  try {
    await page.waitForSelector("picture[data-testid='static-google-image']");
  } catch (e) {
    console.log('Error findAddress');
  }

  const src = $("picture[data-testid='static-google-image'] source").attr(
    'srcset'
  );
  const urlParams = new URLSearchParams(src);
  const coordinates = urlParams.get('center');
  const address = $("address[data-testid='address-label']").text();
  //51.544505,-0.110049
  const res = await fetch(
    `https://dev.virtualearth.net/REST/v1/Locations/${coordinates}?key=${process.env.BING_API_KEY}`
  )
    .then((response) => response.json())
    .then((data) => {
      if (data.resourceSets.length) {
        return {
          address: address,
          addressFull: data.resourceSets[0]?.resources[0]?.name,
          postCode: data.resourceSets[0]?.resources[0]?.address.postalCode,
          coordinates: coordinates,
        };
      } else {
        return {
          address: address,
          addressFull: '',
          postCode: '',
          coordinates: coordinates,
        };
      }
    })
    .catch((e) => {
      console.log('Error bing api reguest', e);
      return {
        address: address,
        postCode: '',
        coordinates: coordinates,
        addressFull: '',
      };
    });

  return res;
};

export const saveToDb = async (listings = [], prisma: PrismaClient) => {
  for (var i = 0; i < listings.length; i++) {
    try {
      const savedListing = await prisma.listing.create({
        data: listings[i],
      });

      const imageUrl = await getMapPictureUrl(
        savedListing.coordinates,
        'Aerial'
      );
      await saveImage(savedListing, imageUrl, './src/images');
    } catch (e) {
      console.log('Error saving to db', e);
      break;
    }
  }
  console.log('Listings saved to db');
};

export const modifyCoordinates = async (address: string) => {
  //get more precise coordinates of house location
  try {
    // Encode the address string
    const encodedAddress = encodeURIComponent(address);

    // Construct the URL for the Geocoding API
    const url = `https://dev.virtualearth.net/REST/v1/Locations?query=${encodedAddress}&key=${process.env.BING_API_KEY}`;

    // Make the HTTP request
    const response = await fetch(url);

    // Check if the response is successful
    if (!response.ok) {
      throw new Error('Network response was not ok');
    }

    // Parse the JSON response
    const data = await response.json();

    // Extract latitude and longitude from the response
    if (
      data.resourceSets &&
      data.resourceSets.length > 0 &&
      data.resourceSets[0].resources.length > 0
    ) {
      const coordinates = data.resourceSets[0].resources[0].point.coordinates;
      const latitude = coordinates[0];
      const longitude = coordinates[1];

      return latitude + ',' + longitude;
    } else {
      console.log('No results found for the provided address.');
    }
  } catch (error) {
    console.error('There was a problem with the fetch operation:', error);
  }
};

export const getMapPictureUrl = async (
  coords: string,
  type: string = 'BirdsEye',
  count: number = 0
): Promise<string> => {
  try {
    const imgResponse = await fetch(
      `https://dev.virtualearth.net/REST/v1/Imagery/Map/${type}/${coords}/19?mapSize=760,460&pp=${coords};128;&mapLayer=Basemap,Buildings&key=${process.env.BING_API_KEY}`
    );

    if (imgResponse.status !== 200 && !count) {
      count++;
      return getMapPictureUrl(coords, 'Aerial');
    }
    if (count) {
      count = 0;
    }

    return imgResponse?.url;
  } catch (e) {
    console.log('Error getMapPicture', e);
  }
};

export const saveImage = async (
  listing: Listing,
  imageUrl: string,
  dirPath: string = './images'
) => {
  //const dirPath = `./src/images/${imageUrls[i].id}`;
  // if (!fs.existsSync(dirPath)) {
  //   fs.mkdirSync(dirPath);
  // }

  const filePath = path.join(dirPath, `${listing.id}.webp`);

  try {
    const response = await fetch(imageUrl);
    const buffer = await response.buffer();

    // Check if file exists before writing
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

export const saveImages = async (listingsData: Listing[]) => {
  for (var i = 0; i < listingsData.length; i++) {
    const imageUrl = await getMapPictureUrl(
      listingsData[i].coordinates,
      'Aerial'
    );
    await saveImage(listingsData[i], imageUrl, './src/images');
  }
};

export const addServiceChargeHistory = async (
  listings: ListingNoId[],
  prisma: PrismaClient
) => {
  let filteredListings = listings;

  for (const listing of listings) {
    const matchedAddressListing = await prisma.listing.findFirst({
      where: {
        addressFull: {
          equals: listing.addressFull,
        },
        beds: {
          equals: listing.beds,
        },
      },
    });

    if (
      matchedAddressListing &&
      helpers.compareNumberDifference(
        matchedAddressListing.serviceCharge,
        listing.serviceCharge
      )
    ) {
      let serviceChargeHistory = '';

      if (matchedAddressListing.serviceChargeHistory) {
        const data: ServiceChargeHistory[] = JSON.parse(
          matchedAddressListing.serviceChargeHistory
        );

        data.push({
          datePosted: listing.datePosted,
          serviceCharge: listing.serviceCharge,
          url: matchedAddressListing.url,
        });

        serviceChargeHistory = JSON.stringify(data);
      } else {
        const data: null | ServiceChargeHistory[] = [
          {
            datePosted: matchedAddressListing.datePosted,
            serviceCharge: matchedAddressListing.serviceCharge,
            url: matchedAddressListing.url,
          },
          {
            datePosted: listing.datePosted,
            serviceCharge: listing.serviceCharge,
            url: listing.url,
          },
        ];
        serviceChargeHistory = JSON.stringify(data);
      }

      // if dates are at least 3 motnh apart
      if (
        helpers.isNMonthsApart(
          matchedAddressListing.datePosted,
          listing.datePosted,
          3
        )
      ) {
        await prisma.listing.update({
          where: {
            id: matchedAddressListing.id,
          },
          data: {
            serviceChargeHistory: serviceChargeHistory,
            serviceCharge: listing.serviceCharge,
          },
        });
      }
    }

    if (matchedAddressListing) {
      filteredListings = filteredListings.filter(
        (l) => l.addressFull !== matchedAddressListing.addressFull
      );
    }
  }

  return filteredListings;
};

export const removeDuplicates = async (prisma: PrismaClient) => {
  const rows = await prisma.listing.findMany();

  function isDuplicate(entry: Listing, arr: Array<Listing>) {
    return arr.some(
      (x) =>
        entry.addressFull === x.addressFull &&
        entry.listingPrice === x.listingPrice
    );
  }

  let newArray = [];
  let duplicateIds = [];

  for (const entry of rows) {
    if (!isDuplicate(entry, newArray)) {
      newArray.push(entry);
    } else {
      duplicateIds.push(entry.id);
    }
  }

  await prisma.listing.deleteMany({
    where: {
      id: {
        in: duplicateIds,
      },
    },
  });

  if (duplicateIds.length) {
    console.log('DELETED DUPLICATES', duplicateIds.length);
  }
};

export const removeOldListings = async (prisma: PrismaClient) => {
  await prisma.listing.deleteMany({
    where: {
      datePosted: {
        lt: moment().subtract(50, 'days').toDate(),
      },
    },
  });
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
