const zoopla = require('./zoopla.js');
const puppeteer = require('puppeteer');
const cheerio = require('cheerio');

(async () => {

  // const page = await zoopla.initialize();
  // const html = await page.content();
  // const $ = cheerio.load(html);

  await zoopla.initialize();
  await zoopla.agreeOnTerms();
  await zoopla.scrapeEachPage();
  await zoopla.close();  

  
  



  // const filteredListings = listings.filter(listing => listing.serviceCharge !== null);
  // console.log('filteredListings', filteredListings);

  //   browser = await puppeteer.launch({
  //     headless: false,
  //     ignoreDefaultArgs: ["--enable-automation"],
  //     args: ["--no-sandbox", "--disabled-setupid-sandbox"],
  //   });

  //   const page = await browser.newPage();
  //   await page.goto("https://www.zoopla.co.uk/for-sale/details/62050089/?search_identifier=1ab1b2c04212a70c7896c7539345f4e9"); 

  //   const html = await page.content();
  //   const $ = cheerio.load(html);


  //   const elementHandle = await page.waitForSelector('#gdpr-consent-notice');
  //   await page.waitForTimeout(2000);
  //   const frame = await elementHandle.contentFrame();
  //   await frame.waitForSelector('button#manageSettings');
  //   await frame.click('button#manageSettings');
  //   await frame.waitForSelector('button#saveAndExit');
  //   await frame.click('button#saveAndExit');

  //   const res2 = await zoopla.findServiceCharge($, page);
  //   console.log('res2', res2);


  




})();
