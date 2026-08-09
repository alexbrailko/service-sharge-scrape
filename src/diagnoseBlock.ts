require('dotenv').config();

import { connect } from 'puppeteer-real-browser';
import { hardenPage, hardenBrowser } from './hardenPage';
import { delay, ensureDir } from './helpers';
import { scrapeListingsList } from './zoopla';

const isDev = process.env.NODE_ENV === 'development';

const TARGETS = [
  ['homepage', 'https://www.zoopla.co.uk/'],
  ['plain search', 'https://www.zoopla.co.uk/for-sale/flats/london/'],
  [
    'sorted search',
    'https://www.zoopla.co.uk/for-sale/flats/london/?q=London&results_sort=newest_listings',
  ],
  [
    'priced search',
    'https://www.zoopla.co.uk/for-sale/flats/london/?q=London&results_sort=newest_listings&price_min=50000&price_max=99999',
  ],
  [
    'full scraper url',
    'https://www.zoopla.co.uk/for-sale/flats/london/?page_size=25&search_source=for-sale&search_source=refine&q=London&results_sort=newest_listings&is_shared_ownership=false&is_retirement_home=false&price_min=50000&price_max=99999&property_sub_type=flats&tenure=freehold&tenure=leasehold&is_auction=false&pn=1',
  ],
];

const isChallenge = async (page: any): Promise<boolean> => {
  try {
    const title = ((await page.title()) || '').toLowerCase();
    if (
      /just a moment|attention required|verify you are human|access denied/.test(
        title
      )
    ) {
      return true;
    }
    return (await page.content()).toLowerCase().includes('_cf_chl_opt');
  } catch {
    return false;
  }
};

const dumpFingerprint = async (page: any) => {
  const fp = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl') as any;
    const dbg = gl && gl.getExtension('WEBGL_debug_renderer_info');
    return {
      webdriver: (navigator as any).webdriver,
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      languages: navigator.languages,
      plugins: navigator.plugins.length,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemory: (navigator as any).deviceMemory,
      outerWidth: window.outerWidth,
      outerHeight: window.outerHeight,
      hasChrome: !!(window as any).chrome,
      webglVendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : null,
      webglRenderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null,
      notificationPermission:
        typeof Notification !== 'undefined' ? Notification.permission : null,
    };
  });

  console.log('\n=== fingerprint as the page sees it ===');
  for (const [k, v] of Object.entries(fp)) {
    console.log(`  ${k}: ${JSON.stringify(v)}`);
  }
  console.log('=== end fingerprint ===\n');
};

const run = async () => {
  const conn = await connect({
    headless: process.env.HEADLESS !== 'false',
    args:
      process.env.MINIMAL_ARGS === 'true'
        ? []
        : [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--disable-features=IsolateOrigins,site-per-process',
          ],
    customConfig: (() => {
      const config: Record<string, unknown> = {};
      if (!isDev) config.chromePath = '/usr/bin/chromium-browser';
      if (process.env.CHROME_PROFILE_DIR) {
        ensureDir(process.env.CHROME_PROFILE_DIR);
        config.userDataDir = process.env.CHROME_PROFILE_DIR;
      }
      return Object.keys(config).length ? config : undefined;
    })(),
    turnstile: true,
    connectOption: {},
    disableXvfb: false,
    ignoreAllFlags: false,
  });

  const { browser, page } = conn;
  await hardenBrowser(browser);
  await hardenPage(page);
  await page.setViewport({ width: 1200, height: 800 });

  await dumpFingerprint(page);

  let dumped = true;

  const targets = process.env.QUICK === 'true' ? TARGETS.slice(0, 1) : TARGETS;

  for (const [label, url] of targets) {
    let status: number | string = '?';
    try {
      const res = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });
      status = res ? res.status() : 'no response';
    } catch (e) {
      status = `nav error: ${(e as Error)?.message || e}`;
    }

    await delay(5000);

    let challenged = await isChallenge(page);
    let cleared = false;

    if (challenged) {
      const deadline = Date.now() + 45000;
      while (Date.now() < deadline) {
        await delay(3000);
        if (!(await isChallenge(page))) {
          cleared = true;
          break;
        }
      }
    }

    const title = await page.title().catch(() => '');
    const hasListings = await page
      .$("div[data-testid='regular-listings']")
      .then((el: any) => !!el)
      .catch(() => false);

    const verdict = !challenged
      ? hasListings
        ? 'OK (listings present)'
        : 'OK (no challenge, no listings container)'
      : cleared
      ? 'CHALLENGED then CLEARED'
      : 'CHALLENGED, never cleared';

    console.log(
      `[${label}] status=${status} title="${title}" listings=${hasListings} -> ${verdict}`
    );

    if (hasListings) {
      try {
        const listings = await scrapeListingsList(page as any);
        console.log(`  scraped ${listings.length} listings from [${label}]`);
        listings.slice(0, 5).forEach((l: any, i: number) => {
          console.log(
            `    ${i + 1}. £${l.listingPrice} — ${l.url}`
          );
        });
      } catch (e) {
        console.log(`  scrapeListingsList failed:`, (e as Error)?.message || e);
      }
    }

    if (!dumped && !challenged) {
      dumped = true;
      await dumpFingerprint(page);
    }

    await delay(4000);
  }

  if (!dumped) {
    console.log('Never reached an unchallenged page — fingerprint not dumped.');
  }

  try {
    await browser.close();
  } catch (e) {}
  process.exit(0);
};

run().catch((e) => {
  console.error('diagnose failed:', e);
  process.exit(1);
});
