import fs from 'fs';
import path from 'path';
import { connectPrisma } from './zoopla';
import { sendMail } from './mailer';

// Weekly scrape report. Triggered at the end of every scrape run (see index.ts),
// but throttled so the runOnInit re-scrape on each PM2 restart can't email
// repeatedly — at most one report per ~week.

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const THROTTLE_MS = 6 * 24 * 60 * 60 * 1000; // don't resend within 6 days

const RESOURCE_LOG = process.env.RESOURCE_LOG_PATH || '/home/deploy/resource.log';
const REPORT_TO = process.env.REPORT_TO || 'alexbrailko@gmail.com';
// dist/report.js -> project root, writable by the deploy user.
const STATE_FILE = path.join(__dirname, '..', 'report-state.json');

// ---------- throttle state ----------

function readLastSent(): number {
  try {
    const { lastSentAt } = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return typeof lastSentAt === 'number' ? lastSentAt : 0;
  } catch {
    return 0;
  }
}

function writeLastSent(ts: number): void {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify({ lastSentAt: ts }));
  } catch (e) {
    console.log('Could not persist report state:', (e as Error)?.message || e);
  }
}

// ---------- helpers ----------

type Row = {
  serviceCharge: number;
  groundRent: number | null;
  postCode: string;
  listingPrice: number;
};

const gbp = (n: number | null | undefined): string =>
  n == null || isNaN(n) ? '—' : '£' + Math.round(n).toLocaleString('en-GB');

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string)
  );
}

function computeStats(rows: Row[]) {
  const charges = rows
    .map((r) => r.serviceCharge)
    .filter((n) => typeof n === 'number' && !isNaN(n))
    .sort((a, b) => a - b);

  let median: number | null = null;
  if (charges.length) {
    const mid = Math.floor(charges.length / 2);
    median =
      charges.length % 2
        ? charges[mid]
        : Math.round((charges[mid - 1] + charges[mid]) / 2);
  }

  const withGroundRent = rows.filter((r) => r.groundRent != null && r.groundRent > 0).length;

  const areaCounts: Record<string, number> = {};
  for (const r of rows) {
    const area = (r.postCode || '').trim().split(' ')[0] || 'unknown';
    areaCounts[area] = (areaCounts[area] || 0) + 1;
  }
  const topAreas = Object.entries(areaCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const bands: Record<string, number> = { '<60k': 0, '60–80k': 0, '80–100k': 0, '100k+': 0 };
  for (const r of rows) {
    const p = r.listingPrice;
    if (p < 60000) bands['<60k']++;
    else if (p < 80000) bands['60–80k']++;
    else if (p < 100000) bands['80–100k']++;
    else bands['100k+']++;
  }

  return { median, withGroundRent, topAreas, bands };
}

type ResourceSummary = {
  peakMem: number;
  totalMem: number;
  maxSwap: number;
  maxChrome: number;
  maxLoad: number;
  samples: number;
  flat: boolean;
};

// Parses /home/deploy/resource.log lines like:
//   2026-06-21T17:30:01+0100 mem_used=1520MB mem_total=7800MB swap_used=0MB chrome=10 load=0.40
function summarizeResourceLog(filePath: string, since: Date): ResourceSummary | null {
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return null; // monitor not set up yet / not readable — render "unavailable"
  }

  const sinceMs = since.getTime();
  let peakMem = 0;
  let totalMem = 0;
  let maxSwap = 0;
  let maxChrome = 0;
  let maxLoad = 0;
  let samples = 0;

  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split(/\s+/);
    const ts = Date.parse(parts[0]);
    if (isNaN(ts) || ts < sinceMs) continue;

    const val = (key: string): number => {
      const tok = parts.find((p) => p.startsWith(key + '='));
      return tok ? parseFloat(tok.slice(key.length + 1)) : NaN;
    };

    const memUsed = val('mem_used');
    const total = val('mem_total');
    const swap = val('swap_used');
    const chrome = val('chrome');
    const load = val('load');

    if (!isNaN(memUsed)) peakMem = Math.max(peakMem, memUsed);
    if (!isNaN(total)) totalMem = total;
    if (!isNaN(swap)) maxSwap = Math.max(maxSwap, swap);
    if (!isNaN(chrome)) maxChrome = Math.max(maxChrome, chrome);
    if (!isNaN(load)) maxLoad = Math.max(maxLoad, load);
    samples++;
  }

  if (!samples) return null;
  const flat = maxSwap === 0 && (totalMem ? peakMem / totalMem < 0.85 : true);
  return { peakMem, totalMem, maxSwap, maxChrome, maxLoad, samples, flat };
}

// ---------- HTML / text rendering ----------

function buildReport(d: {
  since: Date;
  now: number;
  newCount: number;
  totalListings: number;
  avg: number | null;
  min: number | null;
  max: number | null;
  stats: ReturnType<typeof computeStats>;
  resource: ResourceSummary | null;
  healthFlag: boolean;
}): { html: string; text: string } {
  const periodStr = `${d.since.toISOString().slice(0, 10)} → ${new Date(d.now)
    .toISOString()
    .slice(0, 10)}`;

  const banner = d.healthFlag
    ? `<div style="background:#fdecea;border:1px solid #f5c6cb;color:#a3231b;padding:12px;border-radius:6px;margin-bottom:16px;font-weight:bold;">
         ⚠ SCRAPE LIKELY FAILED — 0 new listings added this week. Check the scraper logs.
       </div>`
    : '';

  const cell = 'padding:6px 10px;border-bottom:1px solid #eee;';
  const th = 'padding:6px 10px;text-align:left;border-bottom:2px solid #ddd;background:#f7f7f7;';

  const grPct = d.newCount ? Math.round((d.stats.withGroundRent / d.newCount) * 100) : 0;

  const areaRows =
    d.stats.topAreas.map(([a, c]) => `${escapeHtml(a)} (${c})`).join(' · ') || '—';
  const bandRows = Object.entries(d.stats.bands)
    .map(([b, c]) => `${b}: ${c}`)
    .join('  ');

  const resourceHtml = d.resource
    ? `<tr><td style="${cell}">Resource health (7d)</td><td style="${cell}">
         peak mem ${d.resource.peakMem}MB / ${d.resource.totalMem}MB ·
         max swap ${d.resource.maxSwap}MB · max Chrome ${d.resource.maxChrome} ·
         max load ${d.resource.maxLoad.toFixed(2)} ·
         <b style="color:${d.resource.flat ? '#1a7f37' : '#b35900'}">
           ${d.resource.flat ? 'FLAT ✓' : 'ELEVATED — check'}
         </b>
         <span style="color:#888"> (${d.resource.samples} samples)</span>
       </td></tr>`
    : `<tr><td style="${cell}">Resource health (7d)</td><td style="${cell}">resource log unavailable</td></tr>`;

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#222;max-width:640px;">
    <h2 style="margin:0 0 4px;">Weekly scrape report</h2>
    <div style="color:#888;margin-bottom:16px;">${periodStr}</div>
    ${banner}
    <table style="border-collapse:collapse;width:100%;font-size:14px;">
      <tr><th style="${th}">Metric</th><th style="${th}">Value</th></tr>
      <tr><td style="${cell}"><b>New listings this week</b></td><td style="${cell}"><b>${d.newCount}</b></td></tr>
      <tr><td style="${cell}">Total listings in DB</td><td style="${cell}">${d.totalListings.toLocaleString('en-GB')}</td></tr>
      <tr><td style="${cell}">Service charge (new)</td><td style="${cell}">avg ${gbp(d.avg)} · median ${gbp(d.stats.median)} · min ${gbp(d.min)} · max ${gbp(d.max)}</td></tr>
      <tr><td style="${cell}">Ground rent present</td><td style="${cell}">${d.stats.withGroundRent} of ${d.newCount} (${grPct}%)</td></tr>
      <tr><td style="${cell}">Top postcode areas</td><td style="${cell}">${areaRows}</td></tr>
      <tr><td style="${cell}">Price bands</td><td style="${cell}">${escapeHtml(bandRows)}</td></tr>
      ${resourceHtml}
    </table>
    <p style="color:#999;font-size:12px;margin-top:16px;">Sent automatically by the Zoopla scraper at end of run.</p>
  </div>`;

  const text = [
    `Weekly scrape report  (${periodStr})`,
    d.healthFlag ? '** SCRAPE LIKELY FAILED — 0 new listings this week **' : '',
    ``,
    `New listings this week: ${d.newCount}`,
    `Total listings in DB:   ${d.totalListings}`,
    `Service charge (new):   avg ${gbp(d.avg)} · median ${gbp(d.stats.median)} · min ${gbp(d.min)} · max ${gbp(d.max)}`,
    `Ground rent present:    ${d.stats.withGroundRent} of ${d.newCount} (${grPct}%)`,
    `Top postcode areas:     ${areaRows}`,
    `Price bands:            ${bandRows}`,
    d.resource
      ? `Resource health (7d):   peak mem ${d.resource.peakMem}/${d.resource.totalMem}MB · max swap ${d.resource.maxSwap}MB · max Chrome ${d.resource.maxChrome} · max load ${d.resource.maxLoad.toFixed(2)} · ${d.resource.flat ? 'FLAT' : 'ELEVATED'}`
      : `Resource health (7d):   resource log unavailable`,
  ]
    .filter((l) => l !== '')
    .join('\n');

  return { html, text };
}

// ---------- public API ----------

export async function sendWeeklyReport(opts?: { force?: boolean }): Promise<void> {
  const now = Date.now();
  const lastSent = readLastSent();
  if (!opts?.force && now - lastSent < THROTTLE_MS) {
    const days = ((now - lastSent) / 86400000).toFixed(1);
    console.log(`Weekly report skipped — last sent ${days}d ago (throttled).`);
    return;
  }

  const since = new Date(now - SEVEN_DAYS_MS);
  const prisma = await connectPrisma();

  try {
    const where = { scrapedAt: { gte: since } };

    const [totalListings, newCount, agg, rows] = await Promise.all([
      prisma.listing.count(),
      prisma.listing.count({ where }),
      prisma.listing.aggregate({
        where,
        _avg: { serviceCharge: true },
        _min: { serviceCharge: true },
        _max: { serviceCharge: true },
      }),
      prisma.listing.findMany({
        where,
        select: {
          serviceCharge: true,
          groundRent: true,
          postCode: true,
          listingPrice: true,
        },
      }) as Promise<Row[]>,
    ]);

    const stats = computeStats(rows);
    const resource = summarizeResourceLog(RESOURCE_LOG, since);
    const healthFlag = newCount === 0;

    const subject = healthFlag
      ? '[ACTION] Weekly scrape report — 0 new listings'
      : `Weekly scrape report — ${newCount} new listings`;

    const { html, text } = buildReport({
      since,
      now,
      newCount,
      totalListings,
      avg: agg._avg.serviceCharge,
      min: agg._min.serviceCharge,
      max: agg._max.serviceCharge,
      stats,
      resource,
      healthFlag,
    });

    await sendMail({ to: REPORT_TO, subject, html, text });
    writeLastSent(now);
    console.log(`Weekly report sent to ${REPORT_TO} — ${newCount} new listings.`);
  } finally {
    await prisma.$disconnect();
  }
}

// Short alert used when the scrape gives up after repeated failures, so a crashed
// run still produces a signal even though the normal report fires only on success.
export async function sendFailureAlert(message: string): Promise<void> {
  try {
    await sendMail({
      to: REPORT_TO,
      subject: '[ACTION] Scraper failed',
      html: `<p>The Zoopla scraper gave up after repeated failures and is restarting its PM2 process.</p><pre style="background:#f5f5f5;padding:10px;border-radius:6px;">${escapeHtml(
        message
      )}</pre>`,
      text: `The Zoopla scraper gave up after repeated failures and is restarting.\n\n${message}`,
    });
    console.log('Failure alert sent.');
  } catch (e) {
    console.error('Failed to send failure alert:', (e as Error)?.message || e);
  }
}
