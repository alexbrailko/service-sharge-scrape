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
exports.getLatestScrapedPostDate = exports.removeOldListings = exports.removeDuplicates = exports.addServiceChargeHistory = exports.saveImages = exports.saveImage = exports.getMapPictureUrl = exports.modifyCoordinates = exports.saveToDb = exports.findAddress = exports.findGroundRent = exports.findServiceCharge = exports.scrapeListings = exports.scrapeListingsList = exports.scrapeEachPage = exports.preparePages = exports.agreeOnTerms = exports.connectPrisma = exports.initBrowser = void 0;
const puppeteer_extra_1 = __importDefault(require("puppeteer-extra"));
const puppeteer_extra_plugin_stealth_1 = __importDefault(require("puppeteer-extra-plugin-stealth"));
const puppeteer_extra_plugin_adblocker_1 = __importDefault(require("puppeteer-extra-plugin-adblocker"));
const cheerio = __importStar(require("cheerio"));
const moment_1 = __importDefault(require("moment"));
const client_1 = require("@prisma/client");
const helpers_1 = require("./helpers");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
// import * as nodeUrl from "url";
var URL = require('url').URL;
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
require('dotenv').config();
puppeteer_extra_1.default.use((0, puppeteer_extra_plugin_stealth_1.default)());
puppeteer_extra_1.default.use((0, puppeteer_extra_plugin_adblocker_1.default)({ blockTrackers: true }));
const BASE_URL = 'https://www.zoopla.co.uk';
// let page = null;
// let prisma = null;
let finishScraping = false;
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
const preparePages = async (firstUrl, prisma, page) => {
    let newUrl = firstUrl;
    for (let index = 0; index < 43; index++) {
        const url = new URL(newUrl);
        const search_params = url.searchParams;
        const priceMin = parseInt(search_params.get('price_min'));
        const priceMax = parseInt(search_params.get('price_max'));
        await helpers_1.helpers.delay();
        if (index > 0) {
            newUrl = helpers_1.helpers.updateURLParameter(newUrl, 'price_min', helpers_1.helpers.incrementPrice(priceMin));
            newUrl = helpers_1.helpers.updateURLParameter(newUrl, 'price_max', helpers_1.helpers.incrementPrice(priceMax, true));
        }
        await (0, exports.scrapeEachPage)(newUrl, prisma, page);
        if (priceMax == 10000000) {
            break;
        }
        newUrl = helpers_1.helpers.updateURLParameter(newUrl, 'pn', 1);
    }
};
exports.preparePages = preparePages;
const scrapeEachPage = async (url, prisma, page) => {
    try {
        await page.goto(url, { waitUntil: 'networkidle0' });
    }
    catch (e) {
        console.log('Error going to url', e);
    }
    const html = await page.content();
    const $ = cheerio.load(html);
    const numberOfPages = 40;
    let mainUrl = url;
    let listingsData = [];
    for (var i = 0; i < numberOfPages; i++) {
        console.log('url', mainUrl);
        await page.goto(mainUrl, { waitUntil: 'networkidle0' });
        await helpers_1.helpers.delay();
        await helpers_1.helpers.delay();
        try {
            await page.waitForSelector("div[data-testid='regular-listings']", {
                timeout: 7000,
            });
        }
        catch (e) {
            console.log('E', e);
            //finishScraping = true;
            break;
        }
        const url = new URL(mainUrl);
        // get access to URLSearchParams object
        const search_params = url.searchParams;
        // get url parameters
        const pn = parseInt(search_params.get('pn'));
        const priceMin = parseInt(search_params.get('price_min'));
        const priceMax = parseInt(search_params.get('price_max'));
        const newUrl = helpers_1.helpers.updateURLParameter(mainUrl, 'pn', pn + 1);
        mainUrl = newUrl;
        await (0, exports.getLatestScrapedPostDate)(prisma, priceMin, priceMax);
        const listingsList = await (0, exports.scrapeListingsList)(priceMin, priceMax, prisma, page);
        const listings = await (0, exports.scrapeListings)(listingsList, page);
        listingsData.push.apply(listingsData, listings);
        // remove duplicates from listings
        if (listingsData.length) {
            listingsData = listingsData.filter((v, i, a) => a.findIndex((v2) => ['address'].every((k) => v2[k] === v[k])) === i);
            listingsData = await (0, exports.addServiceChargeHistory)(listingsData, prisma);
            console.log('listingsData length', listingsData.length);
            await (0, exports.saveToDb)(listingsData, prisma);
            listingsData = [];
        }
        if (finishScraping) {
            console.log('finishScraping');
            finishScraping = false;
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
        finishScraping = true;
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
        // if (moment(datePosted) <= moment(latestPostDate)) {
        //   finishScraping = true;
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
    if (filteredByDate.length > 1) {
        finishScraping = true;
    }
    if (finishScraping) {
        return listings.filter((listing) => (0, moment_1.default)(listing.datePosted) > (0, moment_1.default)(latestPostDate));
    }
    else {
        return listings;
    }
};
exports.scrapeListingsList = scrapeListingsList;
const scrapeListings = async (listings, page) => {
    if (!listings.length)
        return;
    const listingsData = listings.map((listing) => ({
        url: listing.url,
        type: '',
        datePosted: listing.datePosted,
        title: '',
        listingPrice: 0,
        beds: listing.beds,
        baths: listing.baths,
        area: listing.area,
        address: '',
        addressFull: '',
        postCode: '',
        coordinates: '',
        serviceCharge: null,
        groundRent: null,
        pictures: '',
        serviceChargeHistory: null,
    }));
    for (var i = 0; i < listings.length; i++) {
        let html;
        try {
            await page.goto(listings[i].url, { waitUntil: 'load' });
            html = await page.content();
        }
        catch (e) {
            console.log('Error: scrapeListings for loop', e);
            console.log('url', listings[i].url);
            await helpers_1.helpers.delay();
            await helpers_1.helpers.delay();
            await page.reload({ waitUntil: ['networkidle0', 'domcontentloaded'] });
            await page.goto(listings[i].url, { waitUntil: 'load' });
        }
        await helpers_1.helpers.delay();
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
        let serviceCharge = await (0, exports.findServiceCharge)($);
        const title = $('#listing-summary-details-heading p').text();
        let address = '';
        let addressFull = '';
        let postCode = '';
        let coordinates = '';
        let groundRent = null;
        //let pictures = [];
        if (serviceCharge) {
            const addressData = await (0, exports.findAddress)($, page);
            address = addressData.address || '';
            addressFull = addressData.addressFull || '';
            postCode = addressData.postCode || '';
            const coordsNew = await (0, exports.modifyCoordinates)(addressFull);
            coordinates = coordsNew ? coordsNew : addressData.coordinates;
            groundRent = await (0, exports.findGroundRent)($);
            serviceCharge = serviceCharge > 40 ? serviceCharge : null;
        }
        listingsData[i].url = listings[i].url;
        listingsData[i].type = 'flat';
        listingsData[i].datePosted = listings[i].datePosted;
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
        //listings[i].pictures = JSON.stringify(pictures);
        if (i === listingsData.length - 1) {
            return listingsData.filter((listing) => listing.serviceCharge !== null && listing.serviceCharge !== 0);
        }
    }
};
exports.scrapeListings = scrapeListings;
const findServiceCharge = async ($) => {
    const text = 'service charge';
    const serviceChargeElem = $("button[data-testid='service-charge-help-icon-wrapper']")
        .parent()
        .parent();
    // .find('div:contains("Service charge:")');
    // .filter(function() {
    //   return $(this).text().indexOf('Service charge:') > -1;
    // })
    //.next().text();
    const serviceChargeText = $(serviceChargeElem).text();
    let serviceChargeAmount = null;
    if (serviceChargeText.includes('month')) {
        serviceChargeAmount =
            helpers_1.helpers.extractNumberFromString(serviceChargeText) * 12;
    }
    else {
        serviceChargeAmount = helpers_1.helpers.extractNumberFromString(serviceChargeText);
    }
    if (!serviceChargeAmount || serviceChargeText === 'Not available') {
        // search in features section
        if ($("div[data-testid='listing_features']")) {
            const filteredElement = helpers_1.helpers.findMatchedElement($, "ul[data-testid='listing_features_bulletted'] li", text);
            if (filteredElement.length) {
                return helpers_1.helpers.extractNumberFromText($(filteredElement), text);
            }
        }
        // search in description
        const filteredElement = helpers_1.helpers.findMatchedElement($, "div[data-testid='truncated_text_container']", text);
        if (filteredElement.length) {
            return helpers_1.helpers.extractNumberFromText($(filteredElement), text);
        }
        else {
            return null;
        }
    }
    else {
        return serviceChargeAmount;
    }
};
exports.findServiceCharge = findServiceCharge;
const findGroundRent = async ($) => {
    const text = 'ground rent';
    const groundRentElem = $("button[data-testid='ground-rent-help-icon-wrapper']")
        .parent()
        .parent();
    const groundRentText = $(groundRentElem).text();
    if (!groundRentText || groundRentText === 'Not available') {
        // search in features section
        if ($("div[data-testid='listing_features']")) {
            const filteredElement = helpers_1.helpers.findMatchedElement($, "ul[data-testid='listing_features_bulletted'] li", text);
            if (filteredElement.length) {
                return helpers_1.helpers.extractNumberFromText($(filteredElement), text);
            }
        }
        // search in description
        const filteredElement = helpers_1.helpers.findMatchedElement($, "div[data-testid='truncated_text_container']", text);
        if (filteredElement.length) {
            return helpers_1.helpers.extractNumberFromText($(filteredElement), text);
        }
        else {
            return null;
        }
    }
    else {
        return helpers_1.helpers.extractNumberFromString(groundRentText);
    }
};
exports.findGroundRent = findGroundRent;
const findAddress = async ($, page) => {
    try {
        await page.waitForSelector("picture[data-testid='static-google-image']");
    }
    catch (e) {
        console.log('Error findAddress');
    }
    const src = $("picture[data-testid='static-google-image'] source").attr('srcset');
    const urlParams = new URLSearchParams(src);
    const coordinates = urlParams.get('center');
    const address = $("address[data-testid='address-label']").text();
    //51.544505,-0.110049
    const res = await fetch(`https://dev.virtualearth.net/REST/v1/Locations/${coordinates}?key=${process.env.BING_API_KEY}`)
        .then((response) => response.json())
        .then((data) => {
        if (data.resourceSets.length) {
            return {
                address: address,
                addressFull: data.resourceSets[0]?.resources[0]?.name,
                postCode: data.resourceSets[0]?.resources[0]?.address.postalCode,
                coordinates: coordinates,
            };
        }
        else {
            return {
                address: address,
                addressFull: '',
                postCode: '',
                coordinates: coordinates,
            };
        }
    })
        .catch((e) => {
        console.log('Error bing api reguest', e);
        return {
            address: address,
            postCode: '',
            coordinates: coordinates,
            addressFull: '',
        };
    });
    return res;
};
exports.findAddress = findAddress;
const saveToDb = async (listings = [], prisma) => {
    for (var i = 0; i < listings.length; i++) {
        try {
            const savedListing = await prisma.listing.create({
                data: listings[i],
            });
            const imageUrl = await (0, exports.getMapPictureUrl)(savedListing.coordinates, 'Aerial');
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
const modifyCoordinates = async (address) => {
    //get more precise coordinates of house location
    try {
        // Encode the address string
        const encodedAddress = encodeURIComponent(address);
        // Construct the URL for the Geocoding API
        const url = `https://dev.virtualearth.net/REST/v1/Locations?query=${encodedAddress}&key=${process.env.BING_API_KEY}`;
        // Make the HTTP request
        const response = await fetch(url);
        // Check if the response is successful
        if (!response.ok) {
            throw new Error('Network response was not ok');
        }
        // Parse the JSON response
        const data = await response.json();
        // Extract latitude and longitude from the response
        if (data.resourceSets &&
            data.resourceSets.length > 0 &&
            data.resourceSets[0].resources.length > 0) {
            const coordinates = data.resourceSets[0].resources[0].point.coordinates;
            const latitude = coordinates[0];
            const longitude = coordinates[1];
            return latitude + ',' + longitude;
        }
        else {
            console.log('No results found for the provided address.');
        }
    }
    catch (error) {
        console.error('There was a problem with the fetch operation:', error);
    }
};
exports.modifyCoordinates = modifyCoordinates;
const getMapPictureUrl = async (coords, type = 'BirdsEye', count = 0) => {
    try {
        const imgResponse = await fetch(`https://dev.virtualearth.net/REST/v1/Imagery/Map/${type}/${coords}/19?mapSize=760,460&pp=${coords};128;&mapLayer=Basemap,Buildings&key=${process.env.BING_API_KEY}`);
        if (imgResponse.status !== 200 && !count) {
            count++;
            return (0, exports.getMapPictureUrl)(coords, 'Aerial');
        }
        if (count) {
            count = 0;
        }
        return imgResponse?.url;
    }
    catch (e) {
        console.log('Error getMapPicture', e);
    }
};
exports.getMapPictureUrl = getMapPictureUrl;
const saveImage = async (listing, imageUrl, dirPath = './images') => {
    //const dirPath = `./src/images/${imageUrls[i].id}`;
    // if (!fs.existsSync(dirPath)) {
    //   fs.mkdirSync(dirPath);
    // }
    const filePath = path_1.default.join(dirPath, `${listing.id}.webp`);
    try {
        const response = await fetch(imageUrl);
        const buffer = await response.buffer();
        // Check if file exists before writing
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
const saveImages = async (listingsData) => {
    for (var i = 0; i < listingsData.length; i++) {
        const imageUrl = await (0, exports.getMapPictureUrl)(listingsData[i].coordinates, 'Aerial');
        await (0, exports.saveImage)(listingsData[i], imageUrl, './src/images');
    }
};
exports.saveImages = saveImages;
const addServiceChargeHistory = async (listings, prisma) => {
    let filteredListings = listings;
    for (const listing of listings) {
        const matchedAddressListing = await prisma.listing.findFirst({
            where: {
                addressFull: {
                    equals: listing.addressFull,
                },
                beds: {
                    equals: listing.beds,
                },
            },
        });
        if (matchedAddressListing &&
            helpers_1.helpers.compareNumberDifference(matchedAddressListing.serviceCharge, listing.serviceCharge)) {
            let serviceChargeHistory = '';
            if (matchedAddressListing.serviceChargeHistory) {
                const data = JSON.parse(matchedAddressListing.serviceChargeHistory);
                data.push({
                    datePosted: listing.datePosted,
                    serviceCharge: listing.serviceCharge,
                    url: matchedAddressListing.url,
                });
                serviceChargeHistory = JSON.stringify(data);
            }
            else {
                const data = [
                    {
                        datePosted: matchedAddressListing.datePosted,
                        serviceCharge: matchedAddressListing.serviceCharge,
                        url: matchedAddressListing.url,
                    },
                    {
                        datePosted: listing.datePosted,
                        serviceCharge: listing.serviceCharge,
                        url: listing.url,
                    },
                ];
                serviceChargeHistory = JSON.stringify(data);
            }
            // if dates are at least 3 motnh apart
            if (helpers_1.helpers.isNMonthsApart(matchedAddressListing.datePosted, listing.datePosted, 3)) {
                await prisma.listing.update({
                    where: {
                        id: matchedAddressListing.id,
                    },
                    data: {
                        serviceChargeHistory: serviceChargeHistory,
                        serviceCharge: listing.serviceCharge,
                    },
                });
            }
        }
        if (matchedAddressListing) {
            filteredListings = filteredListings.filter((l) => l.addressFull !== matchedAddressListing.addressFull);
        }
    }
    return filteredListings;
};
exports.addServiceChargeHistory = addServiceChargeHistory;
const removeDuplicates = async (prisma) => {
    const rows = await prisma.listing.findMany();
    function isDuplicate(entry, arr) {
        return arr.some((x) => entry.addressFull === x.addressFull &&
            entry.listingPrice === x.listingPrice);
    }
    let newArray = [];
    let duplicateIds = [];
    for (const entry of rows) {
        if (!isDuplicate(entry, newArray)) {
            newArray.push(entry);
        }
        else {
            duplicateIds.push(entry.id);
        }
    }
    await prisma.listing.deleteMany({
        where: {
            id: {
                in: duplicateIds,
            },
        },
    });
    if (duplicateIds.length) {
        console.log('DELETED DUPLICATES', duplicateIds.length);
    }
};
exports.removeDuplicates = removeDuplicates;
const removeOldListings = async (prisma) => {
    await prisma.listing.deleteMany({
        where: {
            datePosted: {
                lt: (0, moment_1.default)().subtract(50, 'days').toDate(),
            },
        },
    });
};
exports.removeOldListings = removeOldListings;
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
//# sourceMappingURL=zoopla.js.map