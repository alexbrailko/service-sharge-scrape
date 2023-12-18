const zoopla = require('./zoopla.js');
const puppeteer = require('puppeteer-extra');
const cheerio = require('cheerio');

// Add stealth plugin and use defaults (all tricks to hide puppeteer usage)
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

// Add adblocker plugin to block all ads and trackers (saves bandwidth)
const AdblockerPlugin = require('puppeteer-extra-plugin-adblocker');
puppeteer.use(AdblockerPlugin({ blockTrackers: true }));

const BASE_URL = 'https://www.zoopla.co.uk';

const puppeteerArgs = {
  headless: true,
  // ignoreDefaultArgs: ['--enable-automation'],
  ignoreHTTPSErrors: true,
  slowMo: 0,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--window-size=1400,900',
    '--remote-debugging-port=9222',
    "--remote-debugging-address=0.0.0.0", // You know what your doing?
    '--disable-gpu', "--disable-features=IsolateOrigins,site-per-process", '--blink-settings=imagesEnabled=true',
    '--disable-web-security',
  ],
};

 const test = async () => {
  console.log('1');
  const browser = await puppeteer.launch(puppeteerArgs);
  console.log('2');

  const page = await browser.newPage();
      await page.goto(BASE_URL, {
      waitUntil: "networkidle2"
    });
  await page.goto("https://www.zoopla.co.uk/for-sale/details/65930270/",{
    waitUntil: "networkidle2"
  });
  console.log('3');

  const html = await page.content();
  const $ = cheerio.load(html);
  console.log('4');

  //  await zoopla.agreeOnTerms(page);
  //  console.log('5');
 // await page.waitForSelector("div[data-testid^='static-map-container']");
  // const res = await zoopla.savePictures($, page);
  // console.log('res', res);

  const res2 = await zoopla.findServiceCharge($, page);
  console.log('res2', res2);

 
  //  const res = await zoopla.findAddress($);
  //  console.log('res', res);

   
  //await browser.close();
}

test();