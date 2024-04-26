import * as cheerio from 'cheerio';

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

import {
  checkServiceChargeHistory,
  connectPrisma,
  initBrowser,
} from './zoopla';
import { getAddressData } from './api';
import { findCoordinates, findServiceCharge } from './findData';

(async () => {
  const browser = await initBrowser();
  const prisma = await connectPrisma();
  const page = await browser.newPage();
  await page.goto('https://www.zoopla.co.uk/for-sale/details/66939672/', {
    waitUntil: 'networkidle2',
  });
  const html = await page.content();
  const $ = cheerio.load(html);

  const res = findServiceCharge($);
  console.log('res', res);

  await browser.close();
})();

(async () => {
  // const prisma = await connectPrisma();
  // const data = await prisma.listing.deleteMany({
  //   where: {
  //     scrapedAt: {
  //       gte: new Date('2024 01 01'),
  //     },
  //   },
  // });
  // for (let index = 0; index < data.length; index++) {
  //   const element = data[index];
  //   const res = await getAddressData(element.coordinates);
  //   if (!res) {
  //     console.log('Error', res);
  //     break;
  //   }
  //   await prisma.listing.update({
  //     where: {
  //       id: element.id,
  //     },
  //     data: {
  //       addressFull: res.addressFull,
  //       postCode: res.postCode,
  //     },
  //   });
  //   await new Promise((resolve) => setTimeout(resolve, 300));
  //   console.log('scraped', element.id, index);
  // }
})();
