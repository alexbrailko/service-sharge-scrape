require('dotenv').config();

import { connect } from 'puppeteer-real-browser';
import { hardenPage, hardenBrowser } from './hardenPage';
import { delay, ensureDir } from './helpers';

const isDev = process.env.NODE_ENV === 'development';
const PROFILE_DIR = process.env.CHROME_PROFILE_DIR || '';
const TARGET = process.env.SOLVE_URL || 'https://www.zoopla.co.uk/';
const MAX_WAIT_MS = parseInt(process.env.SOLVE_TIMEOUT_MS || '300000', 10);
const POLL_MS = 3000;

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

const run = async () => {
  if (!PROFILE_DIR) {
    console.error(
      'CHROME_PROFILE_DIR is not set. Add it to .env before running the solver.'
    );
    process.exit(1);
  }

  console.log(`Profile:  ${PROFILE_DIR}`);
  console.log(`Target:   ${TARGET}`);
  console.log(`Solve the challenge in the window that opens.\n`);

  ensureDir(PROFILE_DIR);

  const customConfig: Record<string, unknown> = { userDataDir: PROFILE_DIR };
  if (!isDev) customConfig.chromePath = '/usr/bin/chromium-browser';

  const conn = await connect({
    headless: false,
    args: [],
    customConfig,
    turnstile: true,
    connectOption: {},
    disableXvfb: false,
    ignoreAllFlags: false,
  });

  const { browser, page } = conn;
  await hardenBrowser(browser);
  await hardenPage(page);
  await page.setViewport({ width: 1200, height: 800 });

  await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 60000 });

  const deadline = Date.now() + MAX_WAIT_MS;
  let solved = false;

  while (Date.now() < deadline) {
    if (!(await isChallenge(page))) {
      solved = true;
      break;
    }
    await delay(POLL_MS);
    const left = Math.round((deadline - Date.now()) / 1000);
    console.log(`  still challenged — ${left}s left`);
  }

  if (!solved) {
    console.error('\nChallenge was not solved before the timeout.');
  } else {
    const cookies = await page.cookies();
    const clearance = cookies.find((c: any) => c.name === 'cf_clearance');
    console.log('\nChallenge cleared.');
    console.log(`Title: ${await page.title().catch(() => '')}`);
    if (clearance) {
      const expiry =
        clearance.expires && clearance.expires > 0
          ? new Date(clearance.expires * 1000).toISOString()
          : 'session';
      console.log(`cf_clearance stored, expires: ${expiry}`);
    } else {
      console.log('No cf_clearance cookie found — the profile may not persist.');
    }
    console.log(`\nProfile seeded at ${PROFILE_DIR}`);
  }

  await delay(2000);

  try {
    const pages = await browser.pages();
    await Promise.all(pages.map((p: any) => p.close().catch(() => {})));
    await browser.close();
  } catch (e) {}

  process.exit(solved ? 0 : 1);
};

run().catch((e) => {
  console.error('solveChallenge failed:', e);
  process.exit(1);
});
