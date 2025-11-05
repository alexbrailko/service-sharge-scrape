"use strict";
//import { Page, Browser } from 'puppeteer-core';
//import { connect, PageWithCursor as Page } from 'puppeteer-real-browser';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_cron_1 = __importDefault(require("node-cron"));
const zoopla_1 = require("./zoopla");
const helpers_1 = require("./helpers");
//import puppeteer from 'puppeteer';
const puppeteer_real_browser_1 = require("puppeteer-real-browser");
const isDev = process.env.NODE_ENV === 'development';
const BASE_URL = 'https://www.zoopla.co.uk';
const STARTING_URL = 'https://www.zoopla.co.uk/for-sale/flats/london/?page_size=25&search_source=for-sale&search_source=refine&q=London&results_sort=newest_listings&is_shared_ownership=false&is_retirement_home=false&price_min=50000&price_max=99999&property_sub_type=flats&tenure=freehold&tenure=leasehold&is_auction=false&pn=1';
let retryCount = 0;
// will run every Sunday at 8:00
node_cron_1.default.schedule('0 8 * * 7', async function () {
    const { page, browser } = await (0, puppeteer_real_browser_1.connect)({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--disable-features=IsolateOrigins,site-per-process',
            '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
        ],
        customConfig: !isDev
            ? { chromePath: '/usr/bin/chromium-browser' }
            : undefined,
        turnstile: true,
        connectOption: {},
        disableXvfb: false,
        ignoreAllFlags: false,
    });
    try {
        await page.setViewport({
            width: 1200,
            height: 800,
        });
        await start(browser, page);
        // await page.goto(STARTING_URL, {
        //    waitUntil: ['networkidle0', 'domcontentloaded'],
        // });
    }
    catch (e) {
        console.error('EEE', e);
        try {
            await page.close();
        }
        catch (e) {
            console.log('Error page close');
        }
        try {
            await browser.close();
        }
        catch (e) {
            console.log('Error browser close');
        }
        await (0, helpers_1.delay)(10000);
        //await initBrowser();
        await browser.newPage();
        await restart(browser, page);
    }
}, {
    runOnInit: true,
});
const start = async (browser, page) => {
    const prisma = await (0, zoopla_1.connectPrisma)();
    const savedUrl = (0, zoopla_1.readScrapedData)();
    const url = savedUrl ? savedUrl : STARTING_URL;
    await page.goto(BASE_URL, {
        waitUntil: 'domcontentloaded',
    });
    //await agreeOnTerms(page);
    await (0, zoopla_1.preparePages)(url, prisma, page, browser);
    await browser.close();
    await prisma.$disconnect();
};
const restart = async (browser, page) => {
    try {
        // Consider exponential backoff for repeated retries:
        const delay = Math.min(2 ** retryCount * 60000, 300000); // Up to 5 minutes
        console.log(`Retrying after ${delay / 1000} seconds...`);
        await new Promise((resolve) => setTimeout(resolve, delay)); // Wait before restarting
        await start(browser, page);
    }
    catch (error) {
        console.error('Error during restart:', error.message);
        // Handle restart errors (optional)
    }
    finally {
        retryCount++; // Increment retry count
        if (retryCount === 3) {
            throw new Error('Maximum retries exceeded');
        }
    }
};
//# sourceMappingURL=index.js.map