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
exports.clearScrapedDataFile = exports.readScrapedData = exports.saveScrapedData = exports.getLatestScrapedPostDate = exports.checkServiceChargeHistory = exports.saveImage = exports.saveToDb = exports.scrapeListings = exports.scrapeListingsList = exports.scrapeEachPage = exports.preparePages = exports.agreeOnTerms = exports.connectPrisma = exports.resetRunStats = exports.getRunStats = exports.BLOCK_ABORT_MESSAGE = void 0;
const cheerio = __importStar(require("cheerio"));
const moment_1 = __importDefault(require("moment"));
const client_1 = require("@prisma/client");
const helpers_1 = require("./helpers");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const api_1 = require("./api");
const findData_1 = require("./findData");
const renderMapSnapshot_1 = require("./renderMapSnapshot");
const hardenPage_1 = require("./hardenPage");
const ROTATE_BROWSER_EVERY_N_BANDS = 10;
const MAX_CONSECUTIVE_BLOCKS = 5;
const MAX_CONSECUTIVE_EMPTY_BANDS = 6;
const BLOCK_BACKOFF_BASE_MS = 60000;
const BLOCK_BACKOFF_MAX_MS = 15 * 60000;
const CHALLENGE_CLEAR_TIMEOUT_MS = 45000;
const CHALLENGE_POLL_MS = 2000;
const CHALLENGE_RETRY_SELECTOR_MS = 15000;
exports.BLOCK_ABORT_MESSAGE = 'consecutive Cloudflare challenges';
const isChallengePage = async (page) => {
    try {
        const title = ((await page.title()) || '').toLowerCase();
        if (/just a moment|attention required|verify you are human|access denied/.test(title)) {
            return true;
        }
        const content = (await page.content()).toLowerCase();
        return content.includes('_cf_chl_opt');
    }
    catch {
        return false;
    }
};
const waitForChallengeToClear = async (page) => {
    const deadline = Date.now() + CHALLENGE_CLEAR_TIMEOUT_MS;
    while (Date.now() < deadline) {
        await (0, helpers_1.delay)(CHALLENGE_POLL_MS);
        if (!(await isChallengePage(page)))
            return true;
    }
    return false;
};
let runStats = {
    bandsScanned: 0,
    bandsBlocked: 0,
    bandsEmpty: 0,
    browserRotations: 0,
    stoppedEarly: false,
    aborted: false,
};
const getRunStats = () => ({ ...runStats });
exports.getRunStats = getRunStats;
const resetRunStats = () => {
    runStats = {
        bandsScanned: 0,
        bandsBlocked: 0,
        bandsEmpty: 0,
        browserRotations: 0,
        stoppedEarly: false,
        aborted: false,
    };
};
exports.resetRunStats = resetRunStats;
var URL = require('url').URL;
require('dotenv').config();
// const puppeteer = addExtra(rebrowserPuppeteer as any);
// puppeteer.use(StealthPlugin());
// puppeteer.use(Adblocker({ blockTrackers: true }));
const BASE_URL = 'https://www.zoopla.co.uk';
const isDev = process.env.NODE_ENV === 'development';
// let page = null;
// let prisma = null;
let finishCurrentUrl = false;
let latestPostDate = null;
// export const initBrowser = async () => {
//   try {
//     const browser = await puppeteer.launch();
//     return browser;
//   } catch (e) {
//     console.log('Error initBrowser', e);
//     throw e;
//   }
// };
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
        await page.waitForSelector('#usercentrics-cmp-ui', { timeout: 7000 });
        // const frame = await elementHandle.contentFrame();
        // const button = await frame.$('#save');
        await page.click('>>> .uc-accept-button');
    }
    catch (e) {
        console.log('Error agreeOnTerms', e);
    }
};
exports.agreeOnTerms = agreeOnTerms;
const preparePages = async (firstUrl, prisma, page, browser, reconnect) => {
    let newUrl = firstUrl;
    let currentPage = page;
    let currentBrowser = browser;
    let consecutiveBlocks = 0;
    let consecutiveEmptyBands = 0;
    (0, exports.resetRunStats)();
    const rotateBrowser = async (why) => {
        if (!reconnect)
            return;
        console.log(`Rotating browser (${why})`);
        try {
            const pages = await currentBrowser.pages();
            await Promise.all(pages.map((p) => p.close().catch(() => { })));
            await currentBrowser.close();
        }
        catch (e) {
            console.log('Error closing browser during rotation:', e);
        }
        try {
            await (0, renderMapSnapshot_1.closeSharedSnapshotBrowser)();
        }
        catch (e) {
            console.log('Error closing snapshot browser during rotation:', e);
        }
        const fresh = await reconnect();
        currentBrowser = fresh.browser;
        currentPage = fresh.page;
        runStats.browserRotations++;
        try {
            await currentPage.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
        }
        catch (e) {
            console.log('Error navigating to BASE_URL after rotation:', e);
        }
    };
    for (let index = 0; index < 97; index++) {
        if (!currentBrowser.connected) {
            throw new Error('Browser disconnected — aborting preparePages so cron can restart with fresh browser');
        }
        if (reconnect &&
            index > 0 &&
            index % ROTATE_BROWSER_EVERY_N_BANDS === 0) {
            await rotateBrowser(`after ${index} bands`);
        }
        const url = new URL(newUrl);
        const search_params = url.searchParams;
        const priceMin = parseInt(search_params.get('price_min'));
        const priceMax = parseInt(search_params.get('price_max'));
        await (0, helpers_1.delay)();
        if (index > 0) {
            newUrl = (0, helpers_1.updateURLParameter)(newUrl, 'price_min', (0, helpers_1.incrementPrice)(priceMin));
            newUrl = (0, helpers_1.updateURLParameter)(newUrl, 'price_max', (0, helpers_1.incrementPrice)(priceMax, true));
        }
        let outcome = { blocked: false, rendered: false };
        let bandErrored = false;
        try {
            outcome = await (0, exports.scrapeEachPage)(newUrl, prisma, currentPage, currentBrowser);
        }
        catch (e) {
            bandErrored = true;
            console.log(`Band ${priceMin}-${priceMax} failed, continuing to next band:`, e);
        }
        runStats.bandsScanned++;
        if (outcome.blocked) {
            consecutiveBlocks++;
            consecutiveEmptyBands = 0;
            runStats.bandsBlocked++;
            if (consecutiveBlocks >= MAX_CONSECUTIVE_BLOCKS) {
                runStats.aborted = true;
                throw new Error(`Aborting run after ${consecutiveBlocks} ${exports.BLOCK_ABORT_MESSAGE} (last band ${priceMin}-${priceMax})`);
            }
            const backoffMs = Math.min(BLOCK_BACKOFF_BASE_MS * 2 ** (consecutiveBlocks - 1), BLOCK_BACKOFF_MAX_MS);
            console.log(`Cloudflare challenge ${consecutiveBlocks}/${MAX_CONSECUTIVE_BLOCKS} — backing off ${backoffMs / 1000}s then rotating browser`);
            await (0, helpers_1.delay)(backoffMs);
            await rotateBrowser(`Cloudflare challenge on band ${priceMin}-${priceMax}`);
        }
        else {
            consecutiveBlocks = 0;
            if (outcome.rendered || bandErrored) {
                consecutiveEmptyBands = 0;
            }
            else {
                consecutiveEmptyBands++;
                runStats.bandsEmpty++;
                if (consecutiveEmptyBands >= MAX_CONSECUTIVE_EMPTY_BANDS) {
                    runStats.stoppedEarly = true;
                    console.log(`Stopping after ${consecutiveEmptyBands} consecutive empty bands (last ${priceMin}-${priceMax})`);
                    break;
                }
            }
        }
        if (priceMax >= 10000000) {
            break;
        }
        newUrl = (0, helpers_1.updateURLParameter)(newUrl, 'pn', 1);
    }
    //finish scraping
    (0, exports.clearScrapedDataFile)();
};
exports.preparePages = preparePages;
const scrapeEachPage = async (url, prisma, page, browser) => {
    let blocked = false;
    let rendered = false;
    try {
        // Set a longer timeout for navigation
        await page.setDefaultNavigationTimeout(60000);
        await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: 60000,
        });
    }
    catch (e) {
        console.log('Error going to url', e);
        await (0, helpers_1.delay)(15000); // Wait before giving up
        try {
            await page.reload({ waitUntil: 'domcontentloaded' });
        }
        catch (reloadError) {
            throw new Error('Failed to load url after retry');
        }
    }
    const html = await page.content();
    const $ = cheerio.load(html);
    const numberOfPages = 40;
    let mainUrl = url;
    let listingsData = [];
    for (var i = 0; i < numberOfPages; i++) {
        console.log('url', mainUrl);
        await page.goto(mainUrl, {
            waitUntil: ['domcontentloaded'],
        });
        await (0, helpers_1.delay)();
        await (0, helpers_1.delay)();
        try {
            await page.waitForSelector("div[data-testid='regular-listings']", {
                timeout: 7000,
            });
            rendered = true;
        }
        catch (e) {
            // The listings container didn't render in 7s. Usually one of:
            //   - the price band is genuinely empty (no results) -> expected, skip it;
            //   - the page was blocked (Cloudflare challenge) or failed to load -> flag it.
            const sp = new URL(mainUrl).searchParams;
            const band = `${sp.get('price_min')}-${sp.get('price_max')}`;
            if (await isChallengePage(page)) {
                console.log(`Cloudflare challenge on band ${band} — waiting up to ${CHALLENGE_CLEAR_TIMEOUT_MS / 1000}s for it to clear`);
                if (await waitForChallengeToClear(page)) {
                    try {
                        await page.waitForSelector("div[data-testid='regular-listings']", {
                            timeout: CHALLENGE_RETRY_SELECTOR_MS,
                        });
                        rendered = true;
                        console.log(`Challenge cleared for band ${band} — continuing`);
                    }
                    catch {
                        blocked = true;
                    }
                }
                else {
                    blocked = true;
                }
                if (blocked) {
                    console.log(`regular-listings not found for band ${band} — BLOCKED (challenge did not clear in ${CHALLENGE_CLEAR_TIMEOUT_MS / 1000}s); moving on.`);
                    break;
                }
            }
            else {
                let title = '';
                let reason = 'no results / not loaded';
                try {
                    title = (await page.title().catch(() => '')) || '';
                    const lc = (await page.content()).toLowerCase();
                    if (/no\s*results|couldn.?t find|found 0|0 results/.test(lc)) {
                        reason = 'empty band (0 results)';
                    }
                }
                catch { }
                console.log(`regular-listings not found for band ${band} [title="${title}"] — ${reason}; moving on.`);
                break;
            }
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
        try {
            listings = await (0, exports.scrapeListings)(listingsList, browser);
        }
        catch (e) {
            console.log('scrapeListings batch failed, continuing pagination:', e);
            listings = [];
        }
        listingsData.push.apply(listingsData, listings);
        // remove duplicates from listings
        if (listingsData.length) {
            listingsData = await (0, exports.checkServiceChargeHistory)(listingsData, prisma);
            if (listingsData.length)
                await (0, exports.saveToDb)(listingsData, prisma);
            if (listingsData.length && isDev) {
                //console.log(`${listings.length} listings saved to db`);
            }
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
                    waitUntil: ['domcontentloaded'],
                }),
                //page.waitForSelector("div[data-testid^='regular-listings']", { timeout: 3000 }),
            ]);
            const nextLink = await page.evaluateHandle(() => {
                const nav = document.querySelector('nav[aria-label="pagination"]');
                if (!nav)
                    return null;
                return Array.from(nav.querySelectorAll('a')).find((el) => el.textContent?.includes('Next'));
            });
            const isLastPage = await nextLink.evaluate((el) => el?.getAttribute('aria-disabled') === 'true');
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
    return { blocked, rendered };
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
        const date = new Date();
        let listingPrice = $(element)
            .find("[class*='price_priceText__']")
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
        const page = await browser.newPage();
        await (0, hardenPage_1.hardenPage)(page);
        try {
            let html;
            for (let retry = 0; retry < 3; retry++) {
                try {
                    await page.setDefaultNavigationTimeout(60000);
                    await page.goto(listings[i].url, {
                        waitUntil: 'domcontentloaded',
                        timeout: 60000,
                    });
                    await (0, helpers_1.delay)(5000);
                    // The 'Local area' map (which carries the coordinates) and other
                    // below-the-fold sections render lazily on scroll. Scroll the page and
                    // wait for the map source so it's actually in the snapshot — otherwise
                    // findCoordinates gets an empty srcset and the listing is dropped.
                    await (0, helpers_1.autoScroll)(page);
                    await page
                        .waitForSelector('section[aria-labelledby="local-area"] picture source', { timeout: 5000 })
                        .catch(() => { });
                    html = await page.content();
                    break;
                }
                catch (e) {
                    console.log(`Nav error (attempt ${retry + 1}/3):`, e);
                    if (retry < 2) {
                        await (0, helpers_1.delay)(15000);
                        try {
                            await page.reload({ waitUntil: 'domcontentloaded' });
                        }
                        catch (reloadError) {
                            console.log('Reload failed, will retry with fresh navigation');
                        }
                        continue;
                    }
                    throw new Error(`scrapeListings Err - ${e}`);
                }
            }
            if (!html) {
                console.error(`Failed to scrape listing: ${listings[i].url} after 3 retries.`);
                throw new Error('Failed to scrape listings');
            }
            const $ = cheerio.load(html);
            let serviceCharge = (0, findData_1.findServiceCharge)($);
            const container = $('div[aria-label="Listing details"]');
            const title = $(container).find('section h1').text();
            const address = $(container).find('section h1 address').text();
            let addressFull = '';
            let postCode = '';
            let coordinates = '';
            let groundRent = null;
            let bedsFind = $(container)
                .find("use[href='#bedroom-medium']")
                .parent()
                .parent()
                .text();
            let bathsFind = $(container)
                .find("use[href='#bathroom-medium']")
                .parent()
                .parent()
                .text();
            let areaFind = $(container)
                .find("use[href='#dimensions-medium']")
                .parent()
                .parent()
                .text();
            let beds = parseInt(bedsFind);
            let baths = parseInt(bathsFind);
            let area = parseInt(areaFind);
            if (!area) {
                area = (0, findData_1.findArea)($);
            }
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
                groundRent = (0, findData_1.findGroundRent)($);
                serviceCharge = serviceCharge > 40 ? serviceCharge : null;
            }
            const listingData = {
                url: listings[i].url,
                type: 'flat',
                datePosted: listings[i].datePosted,
                scrapedAt: new Date(),
                title,
                listingPrice: listings[i].listingPrice,
                beds,
                baths,
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
        }
        catch (perListingErr) {
            // Skip this listing, but never let one bad listing kill the whole batch
            console.log(`Listing skipped (${listings[i]?.url}):`, perListingErr?.message || perListingErr);
        }
        finally {
            // Always close the page — guarantees no leak on continue/throw/return
            try {
                await page.close();
            }
            catch (closeErr) {
                console.log('page.close error:', closeErr);
            }
        }
        await (0, helpers_1.delay)();
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
            // const imageUrl = await getMapPictureUrl(
            //   savedListing.coordinates,
            //   'Aerial'
            // );
            await (0, exports.saveImage)(savedListing.id, savedListing.coordinates, process.env.IMAGES_PATH);
        }
        catch (e) {
            console.log('Error saving to db', e);
            continue;
        }
    }
    console.log(`${listings.length} listings saved to db`);
};
exports.saveToDb = saveToDb;
const saveImage = async (id, coords, dirPath = './images') => {
    if (!coords)
        return;
    const filePath = path_1.default.join(dirPath, `${id}.webp`);
    try {
        await (0, renderMapSnapshot_1.renderMapSnapshot)({ coords, outputFile: filePath });
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
const BATCH_SIZE = 5; // Number of parallel operations
const PROGRESS_FILE = 'image-regeneration-progress.json';
const saveProgress = (progress) => {
    fs_1.default.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
};
const loadProgress = () => {
    try {
        if (fs_1.default.existsSync(PROGRESS_FILE)) {
            const parsed = JSON.parse(fs_1.default.readFileSync(PROGRESS_FILE, 'utf-8'));
            return parsed;
        }
    }
    catch (error) {
        console.error('Error reading progress file:', error);
    }
    return null;
};
//# sourceMappingURL=zoopla.js.map