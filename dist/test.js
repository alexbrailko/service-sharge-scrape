"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const cheerio = __importStar(require("cheerio"));
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
const zoopla_1 = require("./zoopla");
const findData_1 = require("./findData");
(async () => {
    const browser = await (0, zoopla_1.initBrowser)();
    const prisma = await (0, zoopla_1.connectPrisma)();
    const page = await browser.newPage();
    await page.goto('https://www.zoopla.co.uk/for-sale/details/66939672/', {
        waitUntil: 'networkidle2',
    });
    const html = await page.content();
    const $ = cheerio.load(html);
    const res = (0, findData_1.findServiceCharge)($);
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
//# sourceMappingURL=test.js.map