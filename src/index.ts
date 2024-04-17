import {
  initBrowser,
  connectPrisma,
  agreeOnTerms,
  preparePages,
  removeDuplicates,
  findServiceCharge,
  findGroundRent,
  addServiceChargeHistory,
  scrapeEachPage,
} from './zoopla';
import * as cheerio from 'cheerio';

const BASE_URL = 'https://www.zoopla.co.uk';
const CURRENT_URL =
  'https://www.zoopla.co.uk/for-sale/flats/london/?page_size=25&search_source=for-sale&q=London&results_sort=newest_listings&search_source=refine&is_shared_ownership=false&is_retirement_home=false&price_min=650000&price_max=699999&pn=1';

(async () => {
  const browser = await initBrowser();
  const prisma = await connectPrisma();
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });

  await page.goto(BASE_URL, {
    waitUntil: 'networkidle2',
  });

  await agreeOnTerms(page);
  await preparePages(CURRENT_URL, prisma, page);
  //await scrapeEachPage(CURRENT_URL, prisma, page);

  await browser.close();
  await prisma.$disconnect();
})();

//2556
// const data = [
//   {
//     url: 'https://www.zoopla.co.uk/for-sale/details/66350626/',
//     type: 'flat',
//     datePosted: new Date('2024-01-08T00:00:00.000Z'),
//     title: '1 bed flat for sale',
//     listingPrice: 94500,
//     beds: 1,
//     baths: 1,
//     area: 561,
//     address: 'Ottley Drive, Kidbrooke, London SE3',
//     addressFull: '48 Ottley Drive, Kidbrooke, SE3 9GF, England, United Kingdom',
//     postCode: 'SE3 9GF',
//     coordinates: '51.4593153,0.029989',
//     serviceCharge: 3517,
//     groundRent: 7860,
//     pictures: '',
//     serviceChargeHistory: null,
//   },
// ];

// (async () => {
//   const browser = await initBrowser();
//   const prisma = await connectPrisma();
//   const page = await browser.newPage();
//   await page.goto('https://www.zoopla.co.uk/for-sale/details/67107990/', {
//     waitUntil: 'networkidle2',
//   });
//   const html = await page.content();
//   const $ = cheerio.load(html);
//   // let groundRent = await findGroundRent($);
//   // console.log('groundRent', groundRent);

//   const res = await addServiceChargeHistory(data, prisma);
//   console.log('res', res.length);
// })();
