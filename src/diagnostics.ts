import { promisify } from 'util';
import { exec as execCb } from 'child_process';
const exec = promisify(execCb);

export async function getChromeProcessList(): Promise<string> {
  try {
    if (process.platform === 'win32') {
      // Check both chrome.exe and chromium.exe
      const chrome = await exec('tasklist /FI "IMAGENAME eq chrome.exe"');
      const chromium = await exec('tasklist /FI "IMAGENAME eq chromium.exe"');
      return [chrome.stdout, chromium.stdout].join('\n');
    } else {
      // Unix-like
      const { stdout } = await exec(
        "ps -ef | grep -i 'chrome|chromium' | grep -v grep || true"
      );
      return stdout;
    }
  } catch (e) {
    return `Error fetching process list: ${e}`;
  }
}

export async function logChromeProcesses() {
  const list = await getChromeProcessList();
  console.log('=== Chrome/Chromium process list ===');
  console.log(list);
  console.log('=== end process list ===');
}

export async function countOpenPages(
  browser: import('puppeteer').Browser | null
) {
  try {
    if (!browser) return null;
    const pages = await browser.pages();
    return pages.length;
  } catch (e) {
    return null;
  }
}

export async function logProcessCounts(options?: {
  scraperBrowser?: import('puppeteer').Browser | null;
  snapshotBrowser?: import('puppeteer').Browser | null;
}) {
  try {
    const chromeList = await getChromeProcessList();
    const processCount = (chromeList.match(/chrome|chromium/gi) || []).length;

    if (processCount > 60) {
      console.warn(
        `WARNING: High number of Chrome processes detected: ${processCount}`
      );
    }

    const scraperPages = options?.scraperBrowser
      ? await countOpenPages(options.scraperBrowser)
      : null;
    const snapshotPages = options?.snapshotBrowser
      ? await countOpenPages(options.snapshotBrowser)
      : null;

    console.log('=== Diagnostics ===');
    console.log('scraper open pages:', scraperPages ?? 'n/a');
    console.log('snapshot open pages:', snapshotPages ?? 'n/a');
    // print a short summary of chrome processes (lines count)
    const lines = (chromeList || '').split('\n').filter((l) => l.trim());
    console.log('chrome/chromium process lines:', lines.length);
    console.log('=== end Diagnostics ===');
  } catch (e) {
    console.log('Diagnostics error', e);
  }
}

export function startPeriodicDiagnostics(
  intervalMs: number = 60000,
  getter?: () => {
    scraperBrowser?: import('puppeteer').Browser | null;
    snapshotBrowser?: import('puppeteer').Browser | null;
  }
) {
  const id = setInterval(async () => {
    try {
      const opts = getter ? getter() : {};
      await logProcessCounts(opts as any);
    } catch (e) {
      console.log('Periodic diagnostics error', e);
    }
  }, intervalMs);

  return () => clearInterval(id);
}
