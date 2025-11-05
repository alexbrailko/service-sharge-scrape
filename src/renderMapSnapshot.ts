import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

type SnapshotOptions = {
  coords: string; // "lat,lon"
  zoom?: number; // default 19
  width?: number; // default 760
  height?: number; // default 460
  marker?: boolean; // add marker at coords
  mapLayer?: 'osm' | 'satellite'; // for extensibility
  waitMs?: number; // extra wait after tiles load
  outputFile?: string; // if set, save to file and return path
  retries?: number; // retry count on failure
};

export async function renderMapSnapshot(
  opts: SnapshotOptions
): Promise<Buffer | string> {
  const {
    coords,
    zoom = 18,
    width = 760,
    height = 460,
    marker = true,
    mapLayer = 'osm',
    waitMs = 800,
    outputFile,
    retries = 2,
  } = opts;

  // Parse coords
  const [latStr, lonStr] = coords.split(',').map((s) => s.trim());
  const lat = parseFloat(latStr);
  const lon = parseFloat(lonStr);
  if (Number.isNaN(lat) || Number.isNaN(lon)) {
    throw new Error('Invalid coords. Expected "lat,lon"');
  }

  const html = `
  <!doctype html>
  <html>
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src * 'unsafe-inline' 'unsafe-eval' data:;">
    <link rel="stylesheet" href="https://unpkg.com/leaflet/dist/leaflet.css"/>
    <style>
      html,body,#map { margin:0; padding:0; height:100%; width:100% }
    </style>
  </head>
  <body>
    <div id="map" style="width:${width}px; height:${height}px"></div>
    <script src="https://unpkg.com/leaflet/dist/leaflet.js"></script>
    <script>
      // create map
      const map = L.map('map', {zoomControl:false, attributionControl:false}).setView([${lat}, ${lon}], ${zoom});

      // choose tile layer (OSM default)
      const tileLayerUrl = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
      const tileLayer = L.tileLayer(tileLayerUrl, {maxZoom: 19, detectRetina: true});
      tileLayer.addTo(map);

      ${marker ? `L.marker([${lat}, ${lon}]).addTo(map);` : ''}

      // Report tile loading progress to Puppeteer by exposing a window variable
      window._tileLoadInfo = {total:0, loaded:0, errored:0};
      tileLayer.on('loading', () => {
        // count tiles in flight - Leaflet doesn't expose total, so we approximate by incrementing on tileloadstart
      });
      map.eachLayer(layer => {
        if (layer && layer.on) {
          layer.on('tileloadstart', () => { window._tileLoadInfo.total += 1; });
          layer.on('tileload', () => { window._tileLoadInfo.loaded += 1; });
          layer.on('tileerror', () => { window._tileLoadInfo.errored += 1; });
        }
      });
    </script>
  </body>
  </html>
  `;

  let attempt = 0;
  while (true) {
    attempt++;
    const browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      defaultViewport: { width, height },
    });

    try {
      const page = await browser.newPage();

      // set a friendly user-agent (some tile servers check UA)
      await page.setUserAgent(
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0'
      );

      // set HTML
      await page.setContent(html, { waitUntil: 'domcontentloaded' });

      // wait for at least one tile to load by waiting for networkidle + a small delay
      // more robust: wait until tile counts stabilize (we exposed window._tileLoadInfo)
      try {
        await page.waitForFunction(
          `window._tileLoadInfo && (window._tileLoadInfo.loaded + window._tileLoadInfo.errored) >= Math.max(1, Math.min(10, window._tileLoadInfo.total))`,
          { timeout: 4000 }
        );
      } catch (e) {
        // ignore: network idle will be used as fallback
      }

      // Wait for network idle (tiles) then a little extra
      await page
        .waitForNetworkIdle({ idleTime: 500, timeout: 5000 })
        .catch(() => {});
      await new Promise((r) => setTimeout(r, waitMs));

      // screenshot
      const screenshotBuffer = (await page.screenshot({
        type: 'webp',
      })) as Buffer;

      await page.close();
      await browser.close();

      if (outputFile) {
        const p = path.resolve(outputFile);
        fs.writeFileSync(p, screenshotBuffer as unknown as Uint8Array);
        return p;
      } else {
        return screenshotBuffer;
      }
    } catch (err) {
      await browser.close().catch(() => {});
      if (attempt > retries) throw err;
      // exponential backoff retry
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
}
