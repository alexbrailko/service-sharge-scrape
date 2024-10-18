import { delay } from './helpers';
import {
  connectPrisma,
  initBrowser,
  preparePages,
  scrapeEachPage,
  scrapeListingsList,
} from './zoopla';
import * as cheerio from 'cheerio';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import Adblocker from 'puppeteer-extra-plugin-adblocker';

async function extractNumber() {
  const { pipeline } = await import('@xenova/transformers');
  const pipe = await pipeline(
    'question-answering',
    'Xenova/distilbert-base-cased-distilled-squad'
  );

  // Prepare a question that prompts the model to find numbers
  const question = '25m Open Air Swimming Pool';
  const context =
    "What is the number of square feet (sq. ft) in this text? Return 0 if no 'square feet', 'sq.ft', 'sqft' or 'sq ft' working is present.";

  const res = await pipe(context, question);

  console.log('res', res);

  // try {
  //   // Send the text and question to the pipeline
  //   const response = await numberExtractionPipeline([text, question]);

  //   // Extract the answer (the identified number)
  //   const answer = response[0].answer;

  //   // Check if an answer was found and parse it to a number
  //   if (answer) {
  //     return parseInt(answer, 10);
  //   } else {
  //     return null; // No number found
  //   }
  // } catch (error) {
  //   console.error('Error during number extraction:', error);
  //   return null; // Handle errors gracefully
  // }
}

//extractNumber();

// (async () => {
//   try {
//     const { pipeline } = await import('@xenova/transformers'); // Replace with actual package name
//     let pipe = await pipeline('question-answering');
//     const question = 'What is the number in this text?';
//     // ... rest of your code using TextPipeline
//   } catch (error) {
//     console.error('Error during import:', error);
//   }
// })();

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
//   const STARTING_URL =
//     'https://www.zoopla.co.uk/for-sale/property/sw1w/?q=1%20Ebury%20Square%2C%20London%20SW1W&search_source=for-sale&pn=1&price_min=19000000&price_max=20000000&pn=1';
//   await page.goto(STARTING_URL, {
//     waitUntil: ['networkidle0', 'domcontentloaded'],
//   });

//   const res = await scrapeListingsList(page);
//   console.log('res', res);

//   // const html = await page.content();
//   // const $ = cheerio.load(html);
//   // const res = findArea($);
//   // console.log('area', res);
//   // await browser.close();
// })();

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

(async () => {
  puppeteer.use(StealthPlugin());
  puppeteer.use(Adblocker({ blockTrackers: true }));

  const browser = await puppeteer.launch(puppeteerArgs);
  await delay();
  const prisma = await connectPrisma();

  await delay();
  await delay();
  const page = await browser.newPage();

  const data = await prisma.listing.findMany({
    where: {
      listingPrice: {
        equals: 0,
      },
    },
    orderBy: {
      datePosted: 'desc',
    },
  });

  console.log('data', data.length);

  for (let index = 0; index < data.length; index++) {
    const element = data[index];

    await page.goto(element.url, {
      waitUntil: 'networkidle2',
    });
    const html = await page.content();
    const $ = cheerio.load(html);

    let listingPrice: string | number = $('.r4q9to0 ._194zg6t3.r4q9to1')
      .text()
      .replace('£', '')
      .replaceAll(',', '');
    // if string has numbers
    if (listingPrice.match(/^[0-9]+$/)) {
      listingPrice = parseInt(listingPrice);
    } else {
      listingPrice = 0;
    }

    console.log('listingPrice', listingPrice, 'url', element.url);
    console.log('count', index);

    if (listingPrice) {
      await prisma.listing.update({
        where: {
          id: element.id,
        },
        data: {
          listingPrice: listingPrice,
        },
      });
    }
    await delay(2000);
  }
  await browser.close();
})();

// (async () => {
//   const STARTING_URL =
//     'https://www.zoopla.co.uk/for-sale/flats/london/?page_size=25&search_source=for-sale&q=London&results_sort=newest_listings&search_source=refine&is_shared_ownership=false&is_retirement_home=false&price_min=50000&price_max=99999&pn=1';
//   await preparePages(STARTING_URL, null, null, null);
// })();
