const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const moment = require('moment');
var URL = require('url').URL;
const helpers = require('./helpers.js');
//const db = require('./db/index.js');
const { PrismaClient } = require('@prisma/client')

const BASE_URL = 'https://www.zoopla.co.uk';
const CURRENT_URL = 'https://www.zoopla.co.uk/for-sale/flats/london/?page_size=25&search_source=for-sale&q=London&radius=40&results_sort=newest_listings&search_source=refine&price_min=0&price_max=100000&pn=1';

let browser = null;
let page = null;
let prisma = null;
let finishScraping = false;
let latestPostDate = null;


const zoopla = {
  initialize: async () => {
    prisma = new PrismaClient();

    try {
      const res = await prisma.$connect();
    } catch(e) {
      console.log('Connection error', e);
    }

    browser = await puppeteer.launch({
      headless: true,
      ignoreDefaultArgs: ['--enable-automation'],
      args: [
        '--no-sandbox',
        '--disabled-setupid-sandbox',
        // '--disable-site-isolation-trials',
        // '--aggressive-cache-discard',
        // '--disable-cache',
        // '--disable-application-cache',
        // '--disable-offline-load-stale-cache',
        // '--disable-gpu-shader-disk-cache',
        // '--media-cache-size=0',
        // '--disk-cache-size=0',
      ],
    });

    page = await browser.newPage();
    //await page.setViewport({ width: 1920, height: 1080 });

    // await page.setRequestInterception(true);
    // const block_ressources = ['image', 'stylesheet', 'media', 'font', 'texttrack', 'object', 'beacon', 'csp_report', 'imageset'];
    // page.on('request', request => {
    //   if (block_ressources.indexOf(request.resourceType) > 0)
    //     request.abort();
    //   else
    //     request.continue();
    // });

    await page.goto(BASE_URL);

    // return page;
  },

  close: async () => {
    await browser.close();
    await prisma.$disconnect();
  },

  agreeOnTerms: async () => {
    try {
      await page.waitForTimeout(2000);
      const elementHandle = await page.waitForSelector('#gdpr-consent-notice', {
        timeout: 3000,
      });
      await page.waitForTimeout(2000);
      const frame = await elementHandle.contentFrame();
      await frame.waitForSelector('button#manageSettings');
      await frame.click('button#manageSettings');
      await frame.waitForSelector('button#saveAndExit');
      await page.waitForTimeout(1000);
      await frame.click('button#saveAndExit');
    } catch(e) {
      console.log('Error agreeOnTeerms', e);
    }
  },

  preparePages: async function () {
      let newUrl = CURRENT_URL;

      const incrementPrice = (price, index) => {
        if(index == 0) return price;

        if (price < 1000000) {
          return price + 100000;
        } else if (price < 2500000) {
          return price + 300000;
        } else {
          return price + 500000;
        }
      }

      // var startTime = Date.now();
    for (let index = 0; index < 30; index++) {
      // to prevent memory leak, stop the loop every hour
      // if (helpers.moreThanXHoursAgo(startTime)) {
      //   break;
      // }

      const url = new URL(newUrl);
      const search_params = url.searchParams;
      const priceMin = parseInt(search_params.get('price_min'));
      const priceMax = parseInt(search_params.get('price_max'));
      newUrl = helpers.updateURLParameter(newUrl, 'price_min', incrementPrice(priceMin, index));
      newUrl = helpers.updateURLParameter(newUrl, 'price_max', incrementPrice(priceMax, index));
     // console.log('newUrl', newUrl);
      await this.scrapeEachPage(newUrl);
      if (priceMax == 10000000) {
        break;
      }
      newUrl = helpers.updateURLParameter(newUrl, 'pn', 1);
      await page.waitForTimeout(2000);
    }
  },

  scrapeEachPage: async function (url) {
    try {
      await page.goto(url);
    } catch(e) {
      console.log('Error going to url', e);
    }

    const html = await page.content();
    const $ = cheerio.load(html);
    const numberOfPages = parseInt(
      $("div[data-testid='pagination'] li").eq(-2).find('a').text(),
    );
    if (isNaN(numberOfPages)) return;
 
    let mainUrl = url;
    let listingsData = [];

    for (var i = 0; i < numberOfPages; i++) {
      console.log('url', mainUrl);
      
      await browser.close();
      
      browser = await puppeteer.launch({
        headless: true,
        ignoreDefaultArgs: ['--enable-automation'],
        args: [
          '--no-sandbox',
          '--disabled-setupid-sandbox',
        ],
      });
      page = await browser.newPage();
     
      await page.goto(mainUrl);
      //await zoopla.agreeOnTerms(true);

      try {
        await page.waitForSelector("div[data-testid^='search-result_listing']", {
          timeout: 10000,
        });
      } catch(e) {
        console.log('E', e);
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

      const listingsList = await this.scrapeListingsList(priceMin, priceMax);

      const listings = await this.scrapeListings(listingsList);
      console.log('listingsLength', listings?.length);

      // remove duplicates from listings
      if (!listingsData.length) {
        listingsData.push.apply(listingsData, listings);
      } else {
        listingsData.push.apply(listingsData, listings);
        listingsData.filter(
          (v, i, a) =>
            a.findIndex((v2) =>
              ['address', 'listingPrice'].every((k) => v2[k] === v[k]),
            ) === i,
        );
        await this.saveToDb(listingsData);
        
        // console.log('listings', listingsData);
        listingsData = [];
      }

      if (finishScraping) {
        console.log('finishScraping');
        if (listingsData.length) {
          await this.saveToDb(listingsData);
        }
        finishScraping = false;
        latestPostDate = null;
        break;
      }

      // go to new page
      await page.waitForTimeout(5000);
      try {
        await Promise.all([
          page.waitForNavigation(),
          page.goto(mainUrl),
          page.waitForSelector("div[data-testid^='search-result_listing']"),
        ]);
      } catch(e) {
        console.log('Error in scrapeEachPage', e);
        await page.waitForTimeout(120000);
        await page.reload({ waitUntil: ["networkidle0", "domcontentloaded"] });
      }

    }
  },

  scrapeListingsList: async function (priceMin, priceMax) {
    const html = await page.content();
    const $ = cheerio.load(html);

    if (!latestPostDate) {
      const latestPost = await prisma.listing.findMany({
        where: {
          listingPrice: {
            gt: priceMin,
            lte: priceMax
          }
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
        const d = new Date();
        latestPostDate = moment().subtract(5, 'd').toDate();
      }
    }

    const listings = $("div[data-testid^='search-result_listing']")
      .map((index, element) => {

        const url = $(element)
          .find("a[data-testid='listing-details-image-link']")
          .attr('href');
        const beds = $(element)
          .find("div[data-testid='listing-spec'] > div")
          .attr('content');
        const baths = $(element)
          .find("div[data-testid='listing-spec'] > div:nth-of-type(2)")
          .attr('content');
        const date = $(element)
          .find("span[data-testid='date-published']")
          .text()
          .replace('Listed on', '');
        const dateFormatted = moment(date, 'Do MMM gggg').toDate();
        const timezoneOffset = dateFormatted.getTimezoneOffset() * 60000;
        const datePosted = new Date(dateFormatted.getTime() - timezoneOffset);

        if (moment(datePosted) <= moment(latestPostDate)) {
          finishScraping = true;
        }
        
        if (helpers.isBeforeToday(datePosted) && moment(datePosted) > moment(latestPostDate)) {
          return {
            url: BASE_URL + url,
            beds: beds ? parseInt(beds) : null,
            baths: baths ? parseInt(baths) : null,
            datePosted,
          };
        }
      })
      .get();
    

    if (finishScraping) {
      return listings.filter(
        (listing) => moment(listing.datePosted) > moment(latestPostDate),
      );
      
    } else {
      return listings;
    }
  },

  scrapeListings: async function (listings) {
    if (!listings.length) return;

    try {
      await page.waitForSelector("div[data-testid^='search-result_listing']");
    } catch(e) {
      console.log('Error in scrapeListings');
    }

    for (var i = 0; i < listings.length; i++) {
      let html;

      try {
        await Promise.all([page.waitForNavigation(), page.goto(listings[i].url)]);
        html = await page.content();
      } catch(e) {
        console.log('scrapeListings for loop upper', e);
        await page.waitForTimeout(120000);
        await page.reload({ waitUntil: ["networkidle0", "domcontentloaded"] });
      }

      const $ = cheerio.load(html);
      await page.waitForTimeout(1000);

      let listingPrice = $("p[data-testid='price']")
        .text()
        .replace('£', '')
        .replaceAll(',', '');
      // if string has numbers
      if (listingPrice.match(/^[0-9]+$/)) {
        listingPrice = parseInt(listingPrice);
      } else {
        listingPrice = 0;
      }

      let serviceCharge = await this.findServiceCharge($);

      const title = $(
        '#listing-summary-details-heading > div:first-child',
      ).text();
      const address = $("address[data-testid='address-label']").text();
      let groundRent = null;
      let pictures = [];

      if (serviceCharge) {
        groundRent = await this.findGroundRent($);
        pictures = await this.savePictures($);
        serviceCharge = serviceCharge > 40 ? serviceCharge : null;
      }

      listings[i].listingPrice = parseInt(listingPrice);
      listings[i].title = title;
      listings[i].address = address;
      listings[i].serviceCharge = serviceCharge;
      listings[i].groundRent = groundRent;
      listings[i].pictures = JSON.stringify(pictures);

      await page.waitForTimeout(3000);

      if (i === listings.length - 1) {
        return listings.filter(
          (listing) =>
            listing.serviceCharge !== null && listing.serviceCharge !== 0,
        );
      }
    }
  },

  findServiceCharge: async function ($) {
    const text = 'service charge';

    const serviceChargeElem = $(
      "div[data-testid='listing-summary-details'] div div div div div",
    ).filter(function () {
      return $(this).text().toLowerCase().includes(text);
    });

    const serviceChargeText = $(serviceChargeElem).next().text();

    if (!serviceChargeText || serviceChargeText === 'Not available') {
      // search in features section
      if ($("div[data-testid='listing_features']")) {
        const filteredElement = helpers.findMatchedElement(
          $,
          "ul[data-testid='listing_features_bulletted'] li",
          text,
        );
        if (filteredElement.length) {
          return zoopla.extractNumberFromText($(filteredElement), text, 15);
        }
      }

      // search in description
      const filteredElement = helpers.findMatchedElement(
        $,
        "div[data-testid='truncated_text_container']",
        text,
      );

      if (filteredElement.length) {
        return zoopla.extractNumberFromText($(filteredElement), text, 25);
      } else {
        return null;
      }
    } else {
      return helpers.extractNumberFromString(serviceChargeText);
    }
  },

  findGroundRent: async function ($) {
    const text = 'ground rent';
    const groundRentElem = $(
      "div[data-testid='listing-summary-details'] div div div div div",
    ).filter(function () {
      return $(this).text().toLowerCase().includes(text);
    });
    const groundRentText = $(groundRentElem).next().text();

    if (!groundRentText || groundRentText === 'Not available') {
      // search in features section
      if ($("div[data-testid='listing_features']")) {
        const filteredElement = helpers.findMatchedElement(
          $,
          "ul[data-testid='listing_features_bulletted'] li",
          text,
        );

        if (filteredElement.length) {
          return zoopla.extractNumberFromText($(filteredElement), text, 20);

          // return filteredListText;
        }
      }

      // search in description
      const filteredElement = helpers.findMatchedElement(
        $,
        "div[data-testid='truncated_text_container']",
        text,
      );

      if (filteredElement.length) {
        return zoopla.extractNumberFromText($(filteredElement), text, 12);
      } else {
        return null;
      }
    } else {
      return helpers.extractNumberFromString(groundRentText);
    }
  },

  savePictures: async function ($) {
    const urls = [];

    try {
      await page.waitForSelector("li[data-testid='gallery-image']", {
        timeout: 5000,
      });
    } catch (e) {
      console.log('gallery image', e);
      return [];
    }

    //await page.waitForSelector("li[data-testid='gallery-image']");
    // const imageLengthString = $("div[data-testid='gallery-counter'] span").text();
    // console.log('imageLengthString', imageLengthString);
    // const n = imageLengthString.lastIndexOf('/');
    // const imageLength = imageLengthString.substring(n + 1)
    // console.log('!!', parseInt(imageLength));

    for (var i = 0; i < $("li[data-testid='gallery-image']").length; i++) {
      const srcset = await page.$$eval(
        "li[data-testid='gallery-image'][aria-hidden='false'] picture source",
        (pic) => {
          return pic.map((i) => i.srcset);
        },
      );
      const srcsetArr = srcset[0].split(',');

      const small = srcsetArr
        .find((img) => img.includes('480w'))
        .replace(':p 480w', '');
      const medium = srcsetArr
        .find((img) => img.includes('768w'))
        .replace(':p 768w', '');
      const large = srcsetArr
        .find((img) => img.includes('1200w'))
        .replace(':p 1200w', '');

      urls.push({ small, medium, large });

      try {
        await page.waitForSelector(
          "section[aria-labelledby='listing-gallery-heading'] button[data-testid='arrow_right']",
        );
        await page.click(
          "section[aria-labelledby='listing-gallery-heading'] button[data-testid='arrow_right']",
        );
        await page.waitForTimeout(700);
      } catch (e) {
        console.log('arrow_right selector errror', e);
        break;
      }
    }

    return urls;
  },

  extractNumberFromText: (el, str) => {
    const elem = el.text().toLowerCase();
    const cutText = elem.substr(elem.indexOf(str) + str.length);
    const index = cutText.indexOf('£');

    if (index > 20) return null;
    if (
      cutText.substr(0, 25).search(/(n\/a)/) > -1 ||
      cutText.substr(0, 25).includes('tbc')
    ) {
      return null;
    }

    const newText = cutText.substring(index).substr(0, 25);
    const extractNumber = helpers.extractNumberFromString(newText);
    // str.search(/\per month\b/)

    if (
      newText.includes('pm') ||
      newText.includes('per month') ||
      newText.includes('pcm')
    ) {
      return extractNumber * 12;
    }

    if (newText.includes('per quarter')) {
      return extractNumber * 4;
    }

    return extractNumber;
  },

  saveToDb: async function (listings = []) {
    for (var i = 0; i < listings.length; i++) {
      await prisma.listing.create({
        data: listings[i],
      });
    }
    console.log('Listings saved to db');
  },

  removeDuplicates: async function() {
      const rows = await prisma.listing.findMany();

      function isDuplicate(entry, arr) {
        return arr.some(x => (entry.address == x.address) && (entry.listingPrice == x.listingPrice))
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
                  in: duplicateIds
              }
          }
      })

      if (duplicateIds.length) {
        console.log('DELETED DUPLICATES', duplicateIds.length);
      }
  },
  removeOldListings: async () => {
    await prisma.listing.deleteMany({
      where: {
          datePosted: {
              lt: moment().subtract(50, 'days').toDate()
          }
      }
    });

  }
};

module.exports = zoopla;
