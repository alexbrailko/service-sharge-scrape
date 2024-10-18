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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.clearScrapedDataFile = exports.readScrapedData = exports.saveScrapedData = exports.getLatestScrapedPostDate = exports.checkServiceChargeHistory = exports.saveImage = exports.saveToDb = exports.scrapeListings = exports.scrapeListingsList = exports.scrapeEachPage = exports.preparePages = exports.agreeOnTerms = exports.connectPrisma = exports.initBrowser = void 0;
const puppeteer_extra_1 = __importDefault(require("puppeteer-extra"));
const puppeteer_extra_plugin_stealth_1 = __importDefault(require("puppeteer-extra-plugin-stealth"));
const puppeteer_extra_plugin_adblocker_1 = __importDefault(require("puppeteer-extra-plugin-adblocker"));
const cheerio = __importStar(require("cheerio"));
const moment_1 = __importDefault(require("moment"));
const client_1 = require("@prisma/client");
const helpers_1 = require("./helpers");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const api_1 = require("./api");
const findData_1 = require("./findData");
// import * as nodeUrl from "url";
var URL = require('url').URL;
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
require('dotenv').config();
puppeteer_extra_1.default.use((0, puppeteer_extra_plugin_stealth_1.default)());
puppeteer_extra_1.default.use((0, puppeteer_extra_plugin_adblocker_1.default)({ blockTrackers: true }));
const BASE_URL = 'https://www.zoopla.co.uk';
// let page = null;
// let prisma = null;
let finishCurrentUrl = false;
let latestPostDate = null;
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
const initBrowser = async () => {
    try {
        const browser = await puppeteer_extra_1.default.launch(puppeteerArgs);
        return browser;
    }
    catch (e) {
        console.log('Error initBrowser', e);
        throw e;
    }
};
exports.initBrowser = initBrowser;
const connectPrisma = async () => {
    const prisma = new client_1.PrismaClient();
    try {
        await prisma.$connect();
    }
    catch (e) {
        console.log('Connection error', e);
    }
    return prisma;
};
exports.connectPrisma = connectPrisma;
const agreeOnTerms = async (page) => {
    try {
        await page.waitForSelector('#onetrust-banner-sdk', { timeout: 7000 });
        // const frame = await elementHandle.contentFrame();
        // const button = await frame.$('#save');
        await page.click('#onetrust-accept-btn-handler');
    }
    catch (e) {
        console.log('Error agreeOnTeerms', e);
    }
};
exports.agreeOnTerms = agreeOnTerms;
const preparePages = async (firstUrl, prisma, page, browser) => {
    let newUrl = firstUrl;
    for (let index = 0; index < 97; index++) {
        const url = new URL(newUrl);
        const search_params = url.searchParams;
        const priceMin = parseInt(search_params.get('price_min'));
        const priceMax = parseInt(search_params.get('price_max'));
        await (0, helpers_1.delay)();
        if (index > 0) {
            newUrl = (0, helpers_1.updateURLParameter)(newUrl, 'price_min', (0, helpers_1.incrementPrice)(priceMin));
            newUrl = (0, helpers_1.updateURLParameter)(newUrl, 'price_max', (0, helpers_1.incrementPrice)(priceMax, true));
        }
        await (0, exports.scrapeEachPage)(newUrl, prisma, page, browser);
        if (priceMax == 10000000) {
            break;
        }
        newUrl = (0, helpers_1.updateURLParameter)(newUrl, 'pn', 1);
    }
    //finish scraping
    (0, exports.clearScrapedDataFile)();
};
exports.preparePages = preparePages;
const scrapeEachPage = async (url, prisma, page, browser) => {
    try {
        await page.goto(url, { waitUntil: 'networkidle2' });
    }
    catch (e) {
        console.log('Error going to url', e);
        throw new Error('Failed to load url');
    }
    const html = await page.content();
    const $ = cheerio.load(html);
    const numberOfPages = 40;
    let mainUrl = url;
    let listingsData = [];
    for (var i = 0; i < numberOfPages; i++) {
        console.log('url', mainUrl);
        await page.goto(mainUrl, { waitUntil: 'networkidle2' });
        await (0, helpers_1.delay)();
        await (0, helpers_1.delay)();
        try {
            await page.waitForSelector("div[data-testid='regular-listings']", {
                timeout: 7000,
            });
        }
        catch (e) {
            console.log('Error regular-listings', e);
            break;
            //throw new Error('Failed to load regular-listings');
            //await browser.close();
            //finishCurrentUrl = true;
            // break;
        }
        const url = new URL(mainUrl);
        // get access to URLSearchParams object
        const search_params = url.searchParams;
        // get url parameters
        const pn = parseInt(search_params.get('pn'));
        const priceMin = parseInt(search_params.get('price_min'));
        const priceMax = parseInt(search_params.get('price_max'));
        const newUrl = (0, helpers_1.updateURLParameter)(mainUrl, 'pn', pn + 1);
        mainUrl = newUrl;
        await (0, exports.getLatestScrapedPostDate)(prisma, priceMin, priceMax);
        (0, exports.saveScrapedData)(url, latestPostDate);
        const listingsList = await (0, exports.scrapeListingsList)(page);
        if (!listingsList.length) {
            break;
        }
        let listings = [];
        listings = await (0, exports.scrapeListings)(listingsList, browser);
        listingsData.push.apply(listingsData, listings);
        console.log('listingsData', listingsData);
        // remove duplicates from listings
        if (listingsData.length) {
            listingsData = await (0, exports.checkServiceChargeHistory)(listingsData, prisma);
            if (listingsData.length)
                await (0, exports.saveToDb)(listingsData, prisma);
            listingsData = [];
        }
        if (finishCurrentUrl) {
            console.log('finishCurrentUrl');
            finishCurrentUrl = false;
            latestPostDate = null;
            break;
        }
        // go to new page
        try {
            await Promise.all([
                page.waitForNavigation(),
                page.goto(mainUrl, {
                    waitUntil: ['networkidle0', 'domcontentloaded'],
                }),
                //page.waitForSelector("div[data-testid^='regular-listings']", { timeout: 3000 }),
            ]);
            const nextLink = await page.evaluateHandle(() => {
                const nav = document.querySelector('nav[aria-label="pagination"]');
                if (!nav)
                    return null;
                return Array.from(nav.querySelectorAll('a')).find((el) => el.textContent.includes('Next'));
            });
            const isLastPage = await nextLink.evaluate((el) => el.getAttribute('aria-disabled') === 'true');
            if (isLastPage) {
                console.log('LAST PAGE');
                break;
            }
        }
        catch (e) {
            console.log('Error in scrapeEachPage, wait for regular-listings selector');
            //await page.reload({ waitUntil: ["networkidle0", "domcontentloaded"] });
            break;
        }
    }
};
exports.scrapeEachPage = scrapeEachPage;
const scrapeListingsList = async (page) => {
    const html = await page.content();
    const $ = cheerio.load(html);
    const listingsContainer = $("div[data-testid='regular-listings']").children();
    if (!listingsContainer.length) {
        console.log('No listings found');
        finishCurrentUrl = true;
    }
    const listings = $(listingsContainer)
        .map((index, element) => {
        const url = $(element).find('a').attr('href');
        const beds = $(element)
            .find("span:contains('bed')")
            .text()
            .replace(/\D/g, '');
        const baths = $(element)
            .find("span:contains('bath')")
            .text()
            .replace(/\D/g, '');
        const area = $(element)
            .find("span:contains('sq. ft')")
            .text()
            .replace(/\D/g, '');
        const date = new Date();
        let listingPrice = $(element)
            .find("p[data-testid='listing-price']")
            .text()
            .replace('£', '')
            .replaceAll(',', '');
        // if string has numbers
        if (listingPrice.match(/^[0-9]+$/)) {
            listingPrice = parseInt(listingPrice);
        }
        else {
            listingPrice = 0;
        }
        const dateFormatted = (0, moment_1.default)(date, 'Do MMM YYYY').toDate();
        const timezoneOffset = dateFormatted.getTimezoneOffset() * 60000;
        const datePosted = new Date(dateFormatted.getTime() - timezoneOffset);
        const lastReduced = $(element).find("span:contains('Last reduced')");
        if (!url) {
            return null;
        }
        if (lastReduced.length && (0, moment_1.default)(datePosted) <= (0, moment_1.default)(latestPostDate)) {
            return null;
        }
        const propertyOfTheWeek = $(element).find("div:contains('Property of the week')");
        if (propertyOfTheWeek.length) {
            return null;
        }
        const highlighted = $(element).find("div:contains('Highlight')");
        if (highlighted.length) {
            return null;
        }
        const backToMarket = $(element).find("div:contains('Back to market')");
        if (backToMarket.length) {
            return null;
        }
        // if (moment(datePosted) <= moment(latestPostDate)) {
        //   finishCurrentUrl = true;
        // }
        // if (
        // datePosted > moment().subtract(1, 'day') &&
        //  moment(datePosted) > moment(latestPostDate)
        // ) {
        return {
            url: BASE_URL + url,
            beds: beds ? parseInt(beds) : null,
            baths: baths ? parseInt(baths) : null,
            area: area ? parseInt(area) : null,
            datePosted,
            listingPrice,
        };
        // }
    })
        .filter((listing) => listing !== null)
        .get();
    const filteredByDate = listings.filter((obj) => (0, moment_1.default)(obj.datePosted) < (0, moment_1.default)(latestPostDate));
    if (filteredByDate.length > 2) {
        finishCurrentUrl = true;
        console.log('finishCurrentUrl');
        return [];
    }
    else if (filteredByDate.length && filteredByDate.length <= 2) {
        return listings.filter((listing) => (0, moment_1.default)(listing.datePosted) > (0, moment_1.default)(latestPostDate));
    }
    else {
        return listings;
    }
};
exports.scrapeListingsList = scrapeListingsList;
const scrapeListings = async (listings, browser) => {
    if (!listings.length)
        return [];
    const listingsData = [];
    for (var i = 0; i < listings.length; i++) {
        let html;
        const page = await browser.newPage();
        for (let retry = 0; retry < 3; retry++) {
            // Retry loop with maximum 3 attempts
            try {
                await Promise.all([
                    page.waitForNavigation(),
                    page.goto(listings[i].url, { waitUntil: 'networkidle2' }),
                ]);
                html = await page.content();
                break; // Exit retry loop on successful navigation
            }
            catch (e) {
                console.log('Nav error', e);
                // await delay(10000);
                // await page.close();
                // await delay();
                // await page.goto(listings[i].url, { waitUntil: 'networkidle2' }),
                throw new Error(`scrapeListings Err - ${e}`); // Re-throw other errors
            }
        }
        if (!html) {
            console.error(`Failed to scrape listing: ${listings[i].url} after 3 retries.`);
            throw new Error('Failed to scrape listings');
        }
        const $ = cheerio.load(html);
        let serviceCharge = (0, findData_1.findServiceCharge)($);
        const title = $('div[aria-label="Listing details"] section h1 p').text();
        const address = $('div[aria-label="Listing details"] section h1 address').text();
        let addressFull = '';
        let postCode = '';
        let coordinates = '';
        let groundRent = null;
        let area = listings[i].area;
        //let pictures = [];
        if (serviceCharge) {
            coordinates = await (0, findData_1.findCoordinates)($, page);
            if (!coordinates) {
                continue;
            }
            try {
                const addressData = await (0, api_1.getAddressData)(coordinates);
                if (!addressData) {
                    continue;
                }
                else {
                    addressFull = addressData.addressFull;
                    postCode = addressData.postCode;
                    coordinates = addressData.coordinates;
                }
            }
            catch (e) {
                console.log('Error getAddressData', e);
                continue;
            }
            if (!area) {
                area = (0, findData_1.findArea)($);
            }
            groundRent = (0, findData_1.findGroundRent)($);
            serviceCharge = serviceCharge > 40 ? serviceCharge : null;
        }
        const listingData = {
            url: listings[i]?.url,
            type: 'flat',
            datePosted: listings[i].datePosted,
            scrapedAt: new Date(),
            title,
            listingPrice: listings[i].listingPrice,
            beds: listings[i].beds,
            baths: listings[i].baths,
            area: area,
            address,
            addressFull,
            postCode,
            coordinates,
            serviceCharge,
            groundRent,
            pictures: '',
            serviceChargeHistory: '',
        };
        listingsData.push(listingData);
        await page.close();
        await (0, helpers_1.delay)();
    }
    return listingsData.filter((listing) => listing.serviceCharge !== null && listing.serviceCharge !== 0);
};
exports.scrapeListings = scrapeListings;
const saveToDb = async (listings = [], prisma) => {
    // for (var i = 0; i < listings.length; i++) {
    //   try {
    //     const savedListing = await prisma.listing.create({
    //       data: listings[i],
    //     });
    //     const imageUrl = await getMapPictureUrl(
    //       savedListing.coordinates,
    //       'Aerial'
    //     );
    //     await saveImage(savedListing, imageUrl, process.env.IMAGES_PATH);
    //   } catch (e) {
    //     console.log('Error saving to db', e);
    //     break;
    //   }
    // }
    console.log(`${listings.length} listings saved to db`);
};
exports.saveToDb = saveToDb;
const saveImage = async (listing, imageUrl, dirPath = './images') => {
    const filePath = path_1.default.join(dirPath, `${listing.id}.webp`);
    try {
        const response = await fetch(imageUrl);
        const buffer = await response.buffer();
        if (!fs_1.default.existsSync(filePath)) {
            await fs_1.default.promises.writeFile(filePath, buffer);
            // console.log('Image downloaded and saved successfully');
        }
        else {
            console.log('Image already exists, skipping creation.');
        }
    }
    catch (error) {
        console.error('Image save error', error);
    }
};
exports.saveImage = saveImage;
/**
 * Checks the service charge history for a list of listingsthat have the same address and beds but a different service charge. If service charge is less or more 5% from the last service charge, this listing will be added to database, otherwise it will be ignored.
 */
const checkServiceChargeHistory = async (listings, prisma) => {
    let filteredListings = listings;
    for (const listing of listings) {
        const latestListings = await prisma.listing.findMany({
            where: {
                addressFull: {
                    equals: listing.addressFull,
                },
                beds: {
                    equals: listing.beds,
                },
            },
            orderBy: {
                datePosted: 'desc',
            },
            take: 1,
        });
        const latestListing = latestListings.length ? latestListings[0] : null;
        if (!latestListing) {
            continue;
        }
        const noScPriceDiff = !(0, helpers_1.numberDifferencePercentage)(listing.serviceCharge, latestListing.serviceCharge, 5);
        const isLessThanThreeMonthApart = !(0, helpers_1.isNMonthsApart)(listing.datePosted, latestListing.datePosted, 3);
        if ((latestListing && noScPriceDiff) || isLessThanThreeMonthApart) {
            // remove irrelevant listing
            filteredListings = filteredListings.filter((l) => l.addressFull !== latestListing.addressFull);
        }
    }
    return filteredListings;
};
exports.checkServiceChargeHistory = checkServiceChargeHistory;
const getLatestScrapedPostDate = async (prisma, priceMin, priceMax) => {
    if (!latestPostDate) {
        const latestPost = await prisma.listing.findMany({
            where: {
                listingPrice: {
                    gt: priceMin,
                    lte: priceMax,
                },
            },
            orderBy: {
                datePosted: 'desc',
            },
            take: 1,
        });
        if (latestPost.length) {
            latestPostDate = latestPost[0].datePosted;
        }
        else {
            // if no listings in db, scrape posts from last x days
            // const d = new Date();
            latestPostDate = (0, moment_1.default)().subtract(9999, 'd').toDate();
        }
    }
};
exports.getLatestScrapedPostDate = getLatestScrapedPostDate;
const saveScrapedData = (url, latestPostDate) => {
    const data = { url, latestPostDate };
    const filePath = path_1.default.join('./src/', 'scrapeData.json');
    try {
        fs_1.default.writeFileSync(filePath, JSON.stringify(data));
    }
    catch (error) {
        console.error('Error saving data:', error);
        throw error;
    }
};
exports.saveScrapedData = saveScrapedData;
const readScrapedData = () => {
    const filePath = path_1.default.join('./src/', 'scrapeData.json');
    if (!fs_1.default.existsSync(filePath)) {
        fs_1.default.writeFileSync(filePath, '{}');
    }
    try {
        const data = fs_1.default.readFileSync(filePath, 'utf8');
        if (data) {
            const parsedData = JSON.parse(data);
            latestPostDate = parsedData.latestPostDate || null;
            return parsedData.url;
        }
        return '';
    }
    catch (error) {
        console.error('Error readScrapedData', error);
        throw error;
    }
};
exports.readScrapedData = readScrapedData;
const clearScrapedDataFile = () => {
    const filePath = path_1.default.join('./src/', 'scrapeData.json');
    fs_1.default.writeFile(filePath, '', function () {
        console.log('cleared scrapeData.json');
    });
};
exports.clearScrapedDataFile = clearScrapedDataFile;
//# sourceMappingURL=zoopla.js.map