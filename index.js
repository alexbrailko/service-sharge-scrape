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


// const test = async () => {
//   console.log('1');
//   const browser = await puppeteer.launch({
//     headless: false,
//     ignoreDefaultArgs: ["--enable-automation"],
//     args: ["--no-sandbox", "--disabled-setupid-sandbox"],
//   });
//   console.log('2');

//   const page = await browser.newPage();
//   await page.goto("https://www.zoopla.co.uk/for-sale/details/63825058/?search_identifier=f5a594495aa65465a149eafb9709307d");
//   console.log('3');

//   const html = await page.content();
//   const $ = cheerio.load(html);
//   console.log('4');

//   await zoopla.agreeOnTerms(page);
//   console.log('5');
//  // await page.waitForSelector("div[data-testid^='static-map-container']");
//   // const res = await zoopla.findServiceCharge($, page);
//   // console.log('res', res);
//   // const res2 = await zoopla.findGroundRent($, page);
//   // console.log('res2', res2);

 
//    const res = await zoopla.findAddress($);
//    console.log('res', res);

   
//   await browser.close();
// }

// every 2 days '0 0 */2 * *'
cron.schedule('0 0 */2 * *', async function() {
  await zoopla.initialize();
  await zoopla.agreeOnTerms();
  await zoopla.preparePages();
 // await zoopla.scrapeEachPage(a);
 //await zoopla.scrapeListings([{"url": "https://www.zoopla.co.uk/for-sale/details/63896815/?search_identifier=da2ca34e73ad9a0f59e639a14822091a"}]);
  await zoopla.close();
  console.log('FINISHED AT', date.toGMTString());
}, {
  runOnInit: true
});

// * * * * *   running a task every minute

// cron.schedule('0 0 */2 * *', async () => {
//   console.log('running a task every minute');
//   await test();
//   console.log('finish');
// }, {
//   runOnInit: true
// });
