//const zoopla = require('./zoopla.js');
const puppeteer = require('puppeteer-extra');
const cheerio = require('cheerio');
const { PrismaClient } = require('@prisma/client');
const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");
//const Jimp = require('jimp');
const request = require('request');
const moment = require('moment');

// // Add stealth plugin and use defaults (all tricks to hide puppeteer usage)
// const StealthPlugin = require('puppeteer-extra-plugin-stealth');
// puppeteer.use(StealthPlugin());

// // Add adblocker plugin to block all ads and trackers (saves bandwidth)
// const AdblockerPlugin = require('puppeteer-extra-plugin-adblocker');
// puppeteer.use(AdblockerPlugin({ blockTrackers: true }));

// const BASE_URL = 'https://www.zoopla.co.uk';

// const puppeteerArgs = {
//   headless: true,
//   // ignoreDefaultArgs: ['--enable-automation'],
//   ignoreHTTPSErrors: true,
//   slowMo: 0,
//   args: [
//     '--no-sandbox',
//     '--disable-setuid-sandbox',
//     '--window-size=1400,900',
//     '--remote-debugging-port=9222',
//     "--remote-debugging-address=0.0.0.0", // You know what your doing?
//     '--disable-gpu', "--disable-features=IsolateOrigins,site-per-process", '--blink-settings=imagesEnabled=true',
//     '--disable-web-security',
//   ],
// };

//  const test = async () => {
//   const browser = await puppeteer.launch(puppeteerArgs);

//   const page = await browser.newPage();
//       await page.goto(BASE_URL, {
//       waitUntil: "networkidle2"
//     });
//   await page.goto("https://www.zoopla.co.uk/for-sale/details/65930270/",{
//     waitUntil: "networkidle2"
//   });

//   const html = await page.content();
//   const $ = cheerio.load(html);

//   const res2 = await zoopla.findServiceCharge($, page);
//   console.log('res2', res2);

// }

// const getImageUrls = (data) => {
//   return data.map((d) => {
//     return JSON.parse(d.pictures).map(obj => {
//       delete obj.medium;
//       return {
//         ...obj,
//         id: d.id,
//       }
//     });    
//   });
// }

const saveImages = async (item) => {
  for (let i = 0; i < imageUrls.length; i++) {
    const index = i + 1;
    const dirPath = `./src/images`;
    //const dirPath = `./src/images/${imageUrls[i].id}`;
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath);
    }

    await fetch(imageUrls[i].small)
      .then((response) => response.buffer())
      .then((buffer) => {
        // Write the buffer to a file
        fs.writeFile(path.join(dirPath, `${imageUrls[i].id}-small.webp`), buffer, (err) => {
          if (err) {
            console.error(err);
          } else {
            console.log("Image downloaded successfully");
          }
        });
      })
      .catch((error) => {
        console.error(error);
      });

    await new Promise(resolve => setTimeout(resolve, 500));
  };
}

 const main = async () => {
  // get data from db
  const prisma = new PrismaClient();
  const data = await prisma.listing.findMany({
      take: 10,
      //skip: 60
  });

  //get image urls
 // const imageUrls = getCoo(data);

  data.forEach(async (item, index) => {
     await saveImages(item);
  });
  

}

// const analyzeImage = async () => {
//   let { pipeline, env } = await import('@xenova/transformers');
//   let pipe = await pipeline('image-classification', 'andupets/real-estate-image-classification');
//   const result = await pipe('./src/images/00a881aa-689e-4ec5-b2cb-d4b9722fbced/10-00a881aa-689e-4ec5-b2cb-d4b9722fbced-small.webp');
//   console.log('result', result);
// }

//analyzeImage();




//const bingMapsKey = 'YOUR_BING_MAPS_KEY'; // Replace with your Bing Maps key
const customPinUrl = './pin2.png'; // Replace with your custom pin URL
const coordinates = '51.545385,0.08032'; // Replace with your desired map center coordinates
const zoomLevel = 13;
const outputFilePath = 'map_with_custom_pin4.png';

// function generateMapWithPin(callback) {
//   const mapUrl = `https://dev.virtualearth.net/REST/v1/Imagery/Map/BirdsEye/${coordinates}/19?mapSize=760,460&mapLayer=Basemap,Buildings&key=${process.env.BING_API_KEY}`;

//   request(mapUrl, { encoding: null }, (error, response, body) => {
//     if (error) {
//       console.error('Error fetching map image:', error);
//       callback(error);
//       return;
//     }

//     Jimp.read(body)
//       .then(mapImage => {
//         if (!mapImage) {
//           console.error('Error reading map image');
//           callback(new Error('Error reading map image'));
//           return;
//         }

//         return Jimp.read(customPinUrl)
//           .then(pinImage => {
//             if (!pinImage) {
//               console.error('Error reading custom pin image');
//               callback(new Error('Error reading custom pin image'));
//               return;
//             }

//             const pinWidth = pinImage.bitmap.width;
//             const pinHeight = pinImage.bitmap.height;

//             // Place the pin at the center of the map (adjust as needed)
//             const pinX = mapImage.bitmap.width / 2 - pinWidth / 2;
//             const pinY = mapImage.bitmap.height / 2 - pinHeight / 2;

//             return mapImage.composite(pinImage,pinX,pinY);
//           });
//       })
//       .then(compositeImage => {
//         compositeImage.getBuffer(Jimp.MIME_PNG, (err, imageBuffer) => {
//           if (err) {
//             console.error('Error compositing images:', err);
//             callback(err);
//             return;
//           }

//           fs.writeFile(outputFilePath, imageBuffer, err => {
//             if (err) {
//               console.error('Error saving image:', err);
//               callback(err);
//             } else {
//               console.log('Image saved successfully to:', outputFilePath);
//               callback(null); // Pass null to indicate successful execution
//             }
//           });
//         });
//       })
//       .catch(error => {
//         console.error('Error processing images:', error);
//         callback(error);
//       });
//   });
// }


// // Example usage:
// generateMapWithPin((err, imageBuffer) => {
//   if (err) {
//     console.error('Error generating map:', err);
//   } else {
//     // Do something with the image buffer (e.g., write to a file)
//     console.log('Image generated successfully!');
//   }
// });


(async () => {
  // await zoopla.initialize();
  // await zoopla.agreeOnTerms();
  // await zoopla.preparePages();
  // await zoopla.close();

  const prisma = new PrismaClient();
  const data = await prisma.listing.findMany({
    //  take: 1,
  });


  for (const item of data) {
    // console.log('coords', item.coordinates);
    // console.log('data', item.addressFull);

    const coords =  await zoopla.geocodeAddress(item.addressFull);

    // await prisma.listing.update({
    //   where: {
    //     id: item.id,
    //   },
    //   data: {
    //     coordinates: coords,
    //   },
    // });

    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log('coordsNew', coords);
  }

});


(async () => {
  const date = '5th Dec 2022';
      const dateFormatted = moment(date, 'Do MMM YYYY').toDate();
      const timezoneOffset = dateFormatted.getTimezoneOffset() * 60000;
      const datePosted = new Date(dateFormatted.getTime() - timezoneOffset);
      console.log('datePosted', datePosted);
})


main();

