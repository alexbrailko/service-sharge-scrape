"use strict";
//import { Page, Browser } from 'puppeteer-core';
//import { connect, PageWithCursor as Page } from 'puppeteer-real-browser';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_cron_1 = __importDefault(require("node-cron"));
const diagnostics_1 = require("./diagnostics");
const renderMapSnapshot_1 = require("./renderMapSnapshot");
const zoopla_1 = require("./zoopla");
const helpers_1 = require("./helpers");
const report_1 = require("./report");
//import puppeteer from 'puppeteer';
const puppeteer_real_browser_1 = require("puppeteer-real-browser");
const child_process_1 = require("child_process");
const util_1 = require("util");
const execAsync = (0, util_1.promisify)(child_process_1.exec);
const isDev = process.env.NODE_ENV === 'development';
const BASE_URL = 'https://www.zoopla.co.uk';
const STARTING_URL = 'https://www.zoopla.co.uk/for-sale/flats/london/?page_size=25&search_source=for-sale&search_source=refine&q=London&results_sort=newest_listings&is_shared_ownership=false&is_retirement_home=false&price_min=50000&price_max=99999&property_sub_type=flats&tenure=freehold&tenure=leasehold&is_auction=false&pn=1';
let retryCount = 0;
let currentScraperBrowser = null;
// Prevents runOnInit + the weekly cron + self-restart from stacking two scrapes.
let isRunning = false;
let isFirstRun = true;
// Kill Chrome orphaned by a previous crash/restart. puppeteer-real-browser
// launches real Chrome via chrome-launcher, whose profile dirs are /tmp/lighthouse.*.
// Linux-only (the server), and only ever called while no scrape of ours is active
// (guarded by isRunning / during shutdown), so it can never kill a live run.
const killStrayChrome = async () => {
    if (process.platform !== 'linux')
        return;
    try {
        await execAsync("pkill -f 'user-data-dir=/tmp/lighthouse' || true");
        await execAsync('rm -rf /tmp/lighthouse.* || true');
    }
    catch (e) {
        console.log('killStrayChrome (non-fatal):', e?.message || e);
    }
};
const connectScraperBrowser = async () => {
    const conn = await (0, puppeteer_real_browser_1.connect)({
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
    currentScraperBrowser = conn.browser;
    await conn.page.setViewport({ width: 1200, height: 800 });
    return { browser: conn.browser, page: conn.page };
};
// will run every Sunday at 8:00
node_cron_1.default.schedule('0 8 * * 7', async function () {
    if (isRunning) {
        console.log('Scrape already running — skipping this trigger');
        return;
    }
    isRunning = true;
    const scheduled = !isFirstRun;
    isFirstRun = false;
    try {
        // Clear any Chrome orphaned by a previous crash/restart before we start.
        await killStrayChrome();
        const { page, browser } = await connectScraperBrowser();
        try {
            await start(browser, page, scheduled);
            // await page.goto(STARTING_URL, {
            //    waitUntil: ['networkidle0', 'domcontentloaded'],
            // });
        }
        catch (e) {
            console.error('EEE', e);
            const msg = e?.message || String(e);
            if (msg.includes(zoopla_1.BLOCK_ABORT_MESSAGE)) {
                await (0, report_1.sendFailureAlert)(msg);
            }
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
            // Create a fresh connection and restart from clean state
            await restart(scheduled);
        }
    }
    finally {
        isRunning = false;
    }
}, {
    runOnInit: true,
});
const start = async (browser, page, scheduled = false) => {
    const prisma = await (0, zoopla_1.connectPrisma)();
    const savedUrl = (0, zoopla_1.readScrapedData)();
    const url = savedUrl ? savedUrl : STARTING_URL;
    await page.goto(BASE_URL, {
        waitUntil: 'domcontentloaded',
    });
    //await agreeOnTerms(page);
    await (0, zoopla_1.preparePages)(url, prisma, page, browser, connectScraperBrowser);
    try {
        const pages = await browser.pages();
        await Promise.all(pages.map((p) => p.close().catch(() => { })));
        await browser.close();
        currentScraperBrowser = null;
    }
    catch (e) {
        // ignore
    }
    currentScraperBrowser = null;
    await prisma.$disconnect();
    // Scrape finished — email the weekly report. Throttled internally to once/week,
    // so the runOnInit re-scrape on every PM2 restart won't spam. Never let a report
    // failure surface as a scrape failure.
    try {
        await (0, report_1.sendWeeklyReport)({ scheduled });
    }
    catch (e) {
        console.error('Weekly report failed:', e?.message || e);
    }
};
const restart = async (scheduled = false) => {
    try {
        // Consider exponential backoff for repeated retries:
        const delayMs = Math.min(2 ** retryCount * 60000, 300000); // Up to 5 minutes
        console.log(`Retrying after ${delayMs / 1000} seconds...`);
        await new Promise((resolve) => setTimeout(resolve, delayMs)); // Wait before restarting
        const { browser, page } = await connectScraperBrowser();
        await start(browser, page, scheduled);
    }
    catch (error) {
        console.error('Error during restart:', error?.message || error);
    }
    finally {
        retryCount++; // Increment retry count
        if (retryCount >= 3) {
            console.log('Maximum retries reached, restarting PM2 process...');
            try {
                await (0, report_1.sendFailureAlert)('Scraper failed after 3 retries; restarting the PM2 process.');
            }
            catch (e) {
                // sendFailureAlert already swallows its own errors; ignore.
            }
            try {
                // Run PM2 restart command
                (0, child_process_1.exec)('pm2 restart scraper', (error, stdout, stderr) => {
                    if (error) {
                        console.error('Failed to restart PM2 process:', error);
                    }
                    else {
                        console.log('PM2 restart initiated:', stdout);
                    }
                    process.exit(1); // Exit the process to ensure PM2 restarts it
                });
            }
            catch (pmError) {
                console.error('Failed to execute PM2 restart command:', pmError);
                process.exit(1);
            }
        }
    }
};
// Periodic diagnostics logging is dev-only (noisy); the browser cleanup below is NOT.
let stopDiagnostics = null;
if (isDev) {
    stopDiagnostics = (0, diagnostics_1.startPeriodicDiagnostics)(60000, () => ({
        scraperBrowser: currentScraperBrowser,
        snapshotBrowser: (0, renderMapSnapshot_1.getSharedSnapshotBrowser)(),
    }));
}
// Graceful shutdown — ALWAYS registered (production included) so a PM2 stop or
// restart closes Chrome instead of orphaning it. This is the core leak fix:
// previously these handlers were inside `if (isDev)` and never ran on the server.
let shuttingDown = false;
async function gracefulShutdown(code = 0) {
    if (shuttingDown)
        return; // ignore duplicate signals
    shuttingDown = true;
    console.log('Shutting down - closing browsers');
    try {
        if (currentScraperBrowser) {
            const pages = await currentScraperBrowser.pages().catch(() => []);
            await Promise.all(pages.map((p) => p.close().catch(() => { })));
            await currentScraperBrowser.close().catch(() => { });
        }
    }
    catch (e) {
        console.log('Error closing scraper browser', e);
    }
    try {
        await (0, renderMapSnapshot_1.closeSharedSnapshotBrowser)();
    }
    catch (e) {
        console.log('Error closing snapshot browser', e);
    }
    // Belt-and-braces: even if puppeteer's close() left the chrome-launcher
    // process behind, make sure nothing survives into the next start.
    try {
        await killStrayChrome();
    }
    catch (e) { }
    try {
        stopDiagnostics?.();
    }
    catch (e) { }
    process.exit(code);
}
process.on('SIGINT', () => {
    console.log('SIGINT received');
    void gracefulShutdown(0);
});
process.on('SIGTERM', () => {
    console.log('SIGTERM received');
    void gracefulShutdown(0);
});
process.on('uncaughtException', (err) => {
    console.error('uncaughtException', err);
    void gracefulShutdown(1);
});
//# sourceMappingURL=index.js.map