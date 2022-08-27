const zoopla = require('./zoopla.js');
const cron = require('node-cron');
 const puppeteer = require('puppeteer');
 const cheerio = require('cheerio');
// const Prisma = require("@prisma/client");

// (async () => {
//   await zoopla.initialize();
//   await zoopla.agreeOnTerms();
//   await zoopla.preparePages();
//   await zoopla.close();

  // const prisma = new Prisma.PrismaClient();
  // const data = await prisma.listing.findMany({
  //     take: 1,
  //     orderBy: {
  //       datePosted: 'desc',
  //     },
  // });

  // const newDate = data[0].datePosted;

  // console.log('data', newDate.setDate(newDate.getDate()-5));


//})();


const test = async () => {
  console.log('1');
  const browser = await puppeteer.launch({
    headless: true,
    ignoreDefaultArgs: ["--enable-automation"],
    args: ["--no-sandbox", "--disabled-setupid-sandbox"],
  });
  console.log('2');

  const page = await browser.newPage();
  await page.goto("https://www.zoopla.co.uk/for-sale/details/62134222/?search_identifier=056afce560195e0740ed055a5235a6de");
  console.log('3');

  const html = await page.content();
  const $ = cheerio.load(html);

  const elementHandle = await page.waitForSelector('#gdpr-consent-notice');
  await page.waitForTimeout(2000);
  const frame = await elementHandle.contentFrame();
  await frame.waitForSelector('button#manageSettings');
  await frame.click('button#manageSettings');
  await frame.waitForSelector('button#saveAndExit');
  await frame.click('button#saveAndExit');
  console.log('4');

  const res = await zoopla.findServiceCharge($, page);
  console.log('res', res);
  const res2 = await zoopla.findGroundRent($, page);
  console.log('res2', res2);
  await browser.close();
}

// cron.schedule('0 0 */3 * *', async function() {
//   await zoopla.initialize();
//   await zoopla.agreeOnTerms();
//   await zoopla.preparePages();
//   await zoopla.close();
//   var date = new Date();
//   console.log('FINISHED AT', date.toGMTString());
// });

cron.schedule('* * * * *', async () => {
  console.log('running a task every minute');
  await test();
  console.log('finish');
});