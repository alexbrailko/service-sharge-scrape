const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const moment = require('moment');
var URL = require('url').URL;
const helpers = require('./helpers.js');
const db = require('./db/index.js');

const BASE_URL = 'https://www.zoopla.co.uk';
const CURRENT_URL = "https://www.zoopla.co.uk/for-sale/flats/london/?page_size=25&q=london&radius=40&results_sort=newest_listings&search_source=refine&property_sub_type=flats&pn=1";

let browser = null;
let page = null;

const zoopla = {

  initialize: async() => {
    try {
     await db.connectToMongoDb();
    } catch(e) {
      console.log('Error connecting to db', e);
    }
    
    browser = await puppeteer.launch({
      headless: false,
      ignoreDefaultArgs: ["--enable-automation"],
      args: [
        '--no-sandbox', 
        '--disabled-setupid-sandbox', 
        '--disable-site-isolation-trials',
        '--aggressive-cache-discard',
        '--disable-cache',
        '--disable-application-cache',
        '--disable-offline-load-stale-cache',
        '--disable-gpu-shader-disk-cache',
        '--media-cache-size=0',
        '--disk-cache-size=0',
        ],
    });

    page = await browser.newPage();
    //await page.setViewport({ width: 1920, height: 1080 });

    await page.setRequestInterception(true);
    const block_ressources = ['image', 'stylesheet', 'media', 'font', 'texttrack', 'object', 'beacon', 'csp_report', 'imageset'];
    page.on('request', request => {
      //if (request.resourceType() === 'image')
      if (block_ressources.indexOf(request.resourceType) > 0)
        request.abort();
      else
        request.continue();
    });

    await page.goto(CURRENT_URL);
    
   // return page;
  },

  close: async () => {
    await browser.close();
  },

  agreeOnTerms: async() => {
    const elementHandle = await page.waitForSelector('#gdpr-consent-notice');
    await page.waitForTimeout(2000);
    const frame = await elementHandle.contentFrame();
    await frame.waitForSelector('button#manageSettings');
    await frame.click('button#manageSettings');
    await frame.waitForSelector('button#saveAndExit');
    await page.waitForTimeout(300);
    await frame.click('button#saveAndExit');
  },

  scrapeEachPage: async function() {
    const html = await page.content();
    const $ = cheerio.load(html);  
    const numberOfPages = parseInt($("div[data-testid='pagination'] li").eq(-2).find('a').text());
    let mainUrl = CURRENT_URL;
    let listingsData = [];

    for (var i = 0; i < numberOfPages; i++) {
      console.log('url', mainUrl);
      await page.waitForSelector("div[data-testid^='search-result_listing']", {timeout: 10000});

      const url = new URL(mainUrl);
      // get access to URLSearchParams object
      const search_params = url.searchParams;
      // get url parameters
      const pn = parseInt(search_params.get('pn'));
      const newUrl = helpers.updateURLParameter(mainUrl, 'pn', pn + 1);
      mainUrl = newUrl;

      

      const listingsList = await this.scrapeListingsList();
      //console.log('listingsList', listingsList);

      // if (listingsList.length) {
      //   mainUrl = page.url();
      //   console.log('current url', mainUrl);
      // }

      const listings = await this.scrapeListings(listingsList);
     // console.log('listingsLength', listings.length);
      // console.log('listings', listings);

      // go to new page
      if (!listings || !listings.length) {
          await page.waitForTimeout(2000);
          await Promise.all([
              page.waitForNavigation(),
              page.goto(mainUrl),
              page.waitForSelector("div[data-testid^='search-result_listing']")
          ]);
          continue;
      }

      // remove duplicates from listings
      if (!listingsData.length) {
       listingsData.push.apply(listingsData, listings);
      } else {
        listingsData.push.apply(listingsData, listings);
        listingsData.filter((v,i,a)=>a.findIndex(v2=>['address','listingPrice'].every(k=>v2[k] ===v[k]))===i);
        await db.saveToDb(listingsData);
        console.log('saved to db');
        console.log('listings', listingsData);
        listingsData = [];
      }

      // go to new page
      await page.waitForTimeout(2000);
      await Promise.all([
          page.waitForNavigation(),
          page.goto(mainUrl),
          page.waitForSelector("div[data-testid^='search-result_listing']")
      ]);


      // if (listings && listings.length) {

      //   try {
      //     await Promise.all([
      //         page.waitForNavigation(),
      //         page.goto(newUrl),
      //     ]);
      //   } catch(e) {
      //     console.log('Error!', e);
      //     await page.reload({ waitUntil: ["networkidle0", "domcontentloaded"] });
      //     await page.waitForTimeout(3000);
      //     await page.goto(newUrl);
      //   }

      //   continue;
      // }

      // await page.waitForTimeout(5000);
      // try {
      //   await page.waitForSelector("div[data-testid='pagination'] ul li:last-child");
      //   await page.click("div[data-testid='pagination'] ul li:last-child");
      // } catch(e) {
      //   console.log('Error', e);
      //   await page.reload({ waitUntil: ["networkidle0", "domcontentloaded"] });
      //   await page.waitForTimeout(3000);
      //   page.goto(mainUrl);
      // }
     
    }
  },

  scrapeListingsList: async function() {
    const html = await page.content();
    const $ = cheerio.load(html);

    
    const listings = $("div[data-testid^='search-result_listing']")
      .map((index, element) => {
       // if (index > 10) return;

        const url = $(element).find("a[data-testid='listing-details-image-link']").attr("href");
        const beds = $(element).find("div[data-testid='listing-spec'] > div").attr('content');
        const baths = $(element).find("div[data-testid='listing-spec'] > div:nth-of-type(2)").attr('content');
        const date = $(element).find("span[data-testid='date-published']").text().replace('Listed on','');
        const dateFormatted = moment(date, 'Do MMM gggg').toDate();
        const timezoneOffset = dateFormatted.getTimezoneOffset() * 60000;
        const datePosted = new Date(dateFormatted.getTime() - timezoneOffset);

        // find listings starting from previous day
        if (helpers.isBeforeToday(datePosted)) {
          return { url: BASE_URL+url, beds, baths: baths ? baths : null, datePosted };
        }
       
      })
      .get();

    return listings;
  },

  scrapeListings: async function(listings)  {
    if (!listings.length) return;

    await page.waitForSelector("div[data-testid^='search-result_listing']");

    for (var i = 0; i < listings.length; i++) {
      await Promise.all([
          page.waitForNavigation(),
          page.goto(listings[i].url),
      ]);
      const html = await page.content();
      const $ = cheerio.load(html);    
      await page.waitForTimeout(1000);
     
      const serviceCharge = await this.findServiceCharge($);
      const listingPrice = $("p[data-testid='price']").text().replace('£', '');
      const title = $("#listing-summary-details-heading > div:first-child").text();
      const address =  $("address[data-testid='address-label']").text();
      const groundRent = await this.findGroundRent($);
      // const pictures = await this.savePictures($);
      const pictures = [];
    
      listings[i].listingPrice = listingPrice;
      listings[i].title = title;
      listings[i].address = address;
      listings[i].serviceCharge = serviceCharge;
      listings[i].groundRent = groundRent;
      listings[i].pictures = pictures;

      await page.waitForTimeout(3000);

      if (i === listings.length - 1) {
        return listings.filter(listing => listing.serviceCharge !== null);
      }
      
    }

  },

  findServiceCharge: async function($) {
    const text = 'service charge';
    
    const serviceChargeElem = $("div[data-testid='listing-summary-details'] .c-jdOIsX").filter(function() {
        return $(this).text().toLowerCase().includes(text);
    });

    const serviceChargeText =  $(serviceChargeElem).next().text();

    if (!serviceChargeText || serviceChargeText === 'Not available') {

      // search in features section
      if ( $("div[data-testid='listing_features']")) {
        const filteredElement = helpers.findMatchedElement($, "ul[data-testid='listing_features_bulletted'] li", text); 
        if (filteredElement.length) {
          return zoopla.extractNumberFromText($(filteredElement), text, 15);
        } 
      }

      // search in description
      const filteredElement = helpers.findMatchedElement($, "div[data-testid='truncated_text_container']", text); 
      
      if (filteredElement.length) {
        return zoopla.extractNumberFromText($(filteredElement), text, 15);
      } else {
        return null;
      }
       
    } else {
      return helpers.extractNumberFromString(serviceChargeText);
    }
  },

  findGroundRent: async function($) {
    const text = 'ground rent';
    const groundRentElem = $("div[data-testid='listing-summary-details'] .c-jdOIsX").filter(function() {
        return $(this).text().toLowerCase().includes(text);
    });
    const groundRentText =  $(groundRentElem).next().text();

    if (!groundRentText || groundRentText === 'Not available') {

      // search in features section
      if ( $("div[data-testid='listing_features']")) {
        const filteredElement = helpers.findMatchedElement($, "ul[data-testid='listing_features_bulletted'] li", text); 
        
        if (filteredElement.length) {
          return zoopla.extractNumberFromText($(filteredElement), 'ground rent', 12);

         // return filteredListText;
        } 
      }

      // search in description
      const filteredElement = helpers.findMatchedElement($, "div[data-testid='truncated_text_container']", text); 
      
      if (filteredElement.length) {
        return zoopla.extractNumberFromText($(filteredElement), 'ground rent', 12);
      } else {
        return null;
      }
       
    } else {
      return helpers.extractNumberFromString(groundRentText);
    }
  },

  savePictures: async function($) {
    const urls = [];

    await page.waitForSelector("li[data-testid='gallery-image']");
    // const imageLengthString = $("div[data-testid='gallery-counter'] span").text();
    // console.log('imageLengthString', imageLengthString);
    // const n = imageLengthString.lastIndexOf('/');
    // const imageLength = imageLengthString.substring(n + 1)
    // console.log('!!', parseInt(imageLength));


    for (var i = 0; i <  $("li[data-testid='gallery-image']").length; i++) {
      try {
        await page.waitForSelector("section[aria-labelledby='listing-gallery-heading'] button[data-testid='arrow_right']");
      } catch(e) {
        await page.reload({ waitUntil: ["networkidle0", "domcontentloaded"] });
      }
      await page.click("section[aria-labelledby='listing-gallery-heading'] button[data-testid='arrow_right']");
      await page.waitForTimeout(700);
      const srcset = await page.$$eval("li[data-testid='gallery-image'][aria-hidden='false'] picture source", (pic) => {
        return pic.map(i => i.srcset);
      } );
      const srcsetArr = srcset[0].split(","); 
      
      const small = srcsetArr.find(img =>  img.includes('480w')).replace(':p 480w','');
      const medium = srcsetArr.find(img => img.includes('768w')).replace(':p 768w','');
      const large = srcsetArr.find(img =>  img.includes('1200w')).replace(':p 1200w','');

      urls.push({ small, medium, large  });
    }

    return urls.reverse();
  },

  extractNumberFromText: (el, str, num) => {
      var elem = el.text().toLowerCase();
      var myString = elem.substr(elem.indexOf(str) + num).substring(0, num);
      var extractNumber = helpers.extractNumberFromString(myString);
      return extractNumber;
  }

}

module.exports = zoopla; 