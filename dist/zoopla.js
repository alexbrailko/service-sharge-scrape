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
exports.deleteScrapedDataFile = exports.readScrapedData = exports.saveScrapedData = exports.getLatestScrapedPostDate = exports.checkServiceChargeHistory = exports.saveImage = exports.saveToDb = exports.scrapeListings = exports.scrapeListingsList = exports.scrapeEachPage = exports.preparePages = exports.agreeOnTerms = exports.connectPrisma = exports.initBrowser = void 0;
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
    const browser = await puppeteer_extra_1.default.launch(puppeteerArgs);
    return browser;
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
        const elementHandle = await page.waitForSelector('#gdpr-consent-tool-wrapper iframe');
        const frame = await elementHandle.contentFrame();
        const button = await frame.$('#save');
        await button.click();
    }
    catch (e) {
        console.log('Error agreeOnTeerms', e);
    }
};
exports.agreeOnTerms = agreeOnTerms;
const preparePages = async (firstUrl, prisma, page, browser) => {
    let newUrl = firstUrl;
    for (let index = 0; index < 43; index++) {
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
    (0, exports.deleteScrapedDataFile)();
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
            //throw new Error('Failed to load regular-listings');
            //await browser.close();
            finishCurrentUrl = true;
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
        const listingsList = await (0, exports.scrapeListingsList)(priceMin, priceMax, prisma, page);
        const listings = await (0, exports.scrapeListings)(listingsList, page);
        listingsData.push.apply(listingsData, listings);
        // remove duplicates from listings
        if (listingsData.length) {
            listingsData = listingsData.filter((v, i, a) => a.findIndex((v2) => ['address'].every((k) => v2[k] === v[k])) === i);
            listingsData = await (0, exports.checkServiceChargeHistory)(listingsData, prisma);
            console.log('listingsData length', listingsData.length);
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
            const isLastPage = $("div[data-testid='pagination']")
                .find("use[href='#arrow-right-medium']")
                .parent()
                .parent()
                .parent()
                .parent()
                .attr('aria-disabled');
            if (isLastPage === 'true') {
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
const scrapeListingsList = async (priceMin, priceMax, prisma, page) => {
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
            .find("use[href='#bedroom-medium']")
            .parent()
            .next()
            .text();
        const baths = $(element)
            .find("use[href='#bathroom-medium']")
            .parent()
            .next()
            .text();
        const area = $(element)
            .find("use[href='#dimensions-medium']")
            .parent()
            .next()
            .text();
        const date = $(element)
            .find("li:contains('Listed on')")
            .text()
            .replace('Listed on', '');
        const dateFormatted = (0, moment_1.default)(date, 'Do MMM YYYY').toDate();
        const timezoneOffset = dateFormatted.getTimezoneOffset() * 60000;
        const datePosted = new Date(dateFormatted.getTime() - timezoneOffset);
        const lastReduced = $(element).find("span:contains('Last reduced')");
        if (lastReduced.length && (0, moment_1.default)(datePosted) <= (0, moment_1.default)(latestPostDate)) {
            return null;
        }
        const propertyOfTheWeek = $(element).find("div:contains('Property of the week')");
        if (propertyOfTheWeek.length) {
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
        };
        // }
    })
        .filter((listing) => listing !== null)
        .get();
    const filteredByDate = listings.filter((obj) => (0, moment_1.default)(obj.datePosted) < (0, moment_1.default)(latestPostDate));
    if (filteredByDate.length > 2) {
        finishCurrentUrl = true;
    }
    if (finishCurrentUrl) {
        return listings.filter((listing) => (0, moment_1.default)(listing.datePosted) > (0, moment_1.default)(latestPostDate));
    }
    else {
        return listings;
    }
};
exports.scrapeListingsList = scrapeListingsList;
const scrapeListings = async (listings, page) => {
    if (!listings.length)
        return [];
    const listingsData = listings;
    for (var i = 0; i < listings.length; i++) {
        let html;
        try {
            await page.goto(listings[i].url, { waitUntil: 'networkidle2' });
            html = await page.content();
        }
        catch (e) {
            console.log('Error: scrapeListings for loop', e);
            console.log('url', listings[i].url);
            await (0, helpers_1.delay)();
            await (0, helpers_1.delay)();
            await page.reload({ waitUntil: ['networkidle0', 'domcontentloaded'] });
            await page.goto(listings[i].url, { waitUntil: 'networkidle2' });
        }
        await (0, helpers_1.delay)();
        const $ = cheerio.load(html);
        let listingPrice = $("p[data-testid='price']")
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
        let serviceCharge = (0, findData_1.findServiceCharge)($);
        const title = $('#listing-summary-details-heading p').text();
        const address = $('#listing-summary-details-heading address').text();
        let addressFull = '';
        let postCode = '';
        let coordinates = '';
        let groundRent = null;
        let area = listings[i].area;
        //let pictures = [];
        if (serviceCharge) {
            coordinates = await (0, findData_1.findCoordinates)($, page);
            try {
                const addressData = await (0, api_1.getAddressData)(coordinates);
                if (!addressData) {
                    listingsData.splice(i, 1); // 2nd parameter means remove one item only
                }
                else {
                    addressFull = addressData.addressFull;
                    postCode = addressData.postCode;
                }
            }
            catch (e) {
                console.log('Error getAddressData', e);
                listingsData.splice(i, 1);
                continue;
            }
            if (!area) {
                area = (0, findData_1.findArea)($);
            }
            groundRent = (0, findData_1.findGroundRent)($);
            serviceCharge = serviceCharge > 40 ? serviceCharge : null;
        }
        listingsData[i].url = listings[i].url;
        listingsData[i].type = 'flat';
        listingsData[i].datePosted = listings[i].datePosted;
        listingsData[i].scrapedAt = new Date();
        listingsData[i].title = title;
        listingsData[i].listingPrice = listingPrice;
        listingsData[i].beds = listings[i].beds;
        listingsData[i].baths = listings[i].baths;
        listingsData[i].area = listings[i].area;
        listingsData[i].address = address;
        listingsData[i].addressFull = addressFull;
        listingsData[i].postCode = postCode;
        listingsData[i].coordinates = coordinates;
        listingsData[i].serviceCharge = serviceCharge;
        listingsData[i].groundRent = groundRent;
        listingsData[i].pictures = '';
    }
    return listingsData.filter((listing) => listing.serviceCharge !== null && listing.serviceCharge !== 0);
};
exports.scrapeListings = scrapeListings;
const saveToDb = async (listings = [], prisma) => {
    for (var i = 0; i < listings.length; i++) {
        try {
            const savedListing = await prisma.listing.create({
                data: listings[i],
            });
            const imageUrl = await (0, api_1.getMapPictureUrl)(savedListing.coordinates, 'Aerial');
            await (0, exports.saveImage)(savedListing, imageUrl, './src/images');
        }
        catch (e) {
            console.log('Error saving to db', e);
            break;
        }
    }
    console.log('Listings saved to db');
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
    try {
        const data = fs_1.default.readFileSync(filePath, 'utf8');
        if (data) {
            const parsedData = JSON.parse(data);
            if (parsedData) {
                latestPostDate = parsedData.latestPostDate || null;
                return parsedData.url;
            }
        }
        return '';
    }
    catch (error) {
        console.error(error);
        throw error;
    }
};
exports.readScrapedData = readScrapedData;
const deleteScrapedDataFile = () => {
    const filePath = path_1.default.join('./src/', 'scrapeData.json');
    fs_1.default.rmSync(filePath, {
        force: true,
    });
};
exports.deleteScrapedDataFile = deleteScrapedDataFile;
//# sourceMappingURL=zoopla.js.map