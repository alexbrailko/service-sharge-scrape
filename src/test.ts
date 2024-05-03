import * as cheerio from 'cheerio';

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

import {
  checkServiceChargeHistory,
  connectPrisma,
  initBrowser,
} from './zoopla';
import { getAddressData } from './api';
import { findArea, findCoordinates, findServiceCharge } from './findData';
import { delay } from './helpers';

// (async () => {
//   const browser = await initBrowser();
//   const prisma = await connectPrisma();
//   const page = await browser.newPage();
//   await page.goto('https://www.zoopla.co.uk/for-sale/details/66698047/', {
//     waitUntil: 'networkidle2',
//   });
//   const html = await page.content();
//   const $ = cheerio.load(html);
//   const res = findArea($);
//   console.log('area', res);
//   await browser.close();
// })();

(async () => {
  const browser = await initBrowser();
  const prisma = await connectPrisma();
  const page = await browser.newPage();

  const data = await prisma.listing.findMany({
    where: {
      area: null,
      datePosted: {
        gte: new Date('2023-09-30'),
      },
    },
    skip: 1480,
  });

  console.log('data', data.length);

  for (let index = 0; index < data.length; index++) {
    const element = data[index];

    await page.goto(element.url, {
      waitUntil: 'networkidle2',
    });
    const html = await page.content();
    const $ = cheerio.load(html);
    const area = findArea($);
    console.log('id', element.id, '   ', index + 1);

    //const res = await getAddressData(element.coordinates);
    if (area) {
      console.log('area', area);

      await prisma.listing.update({
        where: {
          id: element.id,
        },
        data: {
          area: area,
        },
      });
      // await new Promise((resolve) => setTimeout(resolve, 300));
      // console.log('scraped', element.id, index);
    }
    await delay();
  }
  await browser.close();
})();
