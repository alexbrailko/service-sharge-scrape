require('dotenv').config();

import { PrismaClient } from '@prisma/client';

const SINCE = process.env.SINCE || '';

const fmt = (rows: any[]) =>
  rows.map((r) =>
    Object.fromEntries(
      Object.entries(r).map(([k, v]) => [
        k,
        typeof v === 'bigint' ? Number(v) : v,
      ])
    )
  );

const run = async () => {
  const prisma = new PrismaClient();
  const since = SINCE ? new Date(SINCE) : new Date(Date.now() - 36 * 3600 * 1000);

  console.log(`Window start: ${since.toISOString()}\n`);

  const [[totals]] = [
    fmt(
      await prisma.$queryRaw`
        SELECT COUNT(*) AS total,
               SUM(scrapedAt >= ${since}) AS inWindow,
               COUNT(DISTINCT url) AS distinctUrls
        FROM \`Listing\``
    ),
  ];

  console.log('--- totals ---');
  console.log(`  rows total:        ${totals.total}`);
  console.log(`  rows in window:    ${totals.inWindow}`);
  console.log(`  distinct urls:     ${totals.distinctUrls}`);
  console.log(
    `  url duplicates:    ${Number(totals.total) - Number(totals.distinctUrls)}\n`
  );

  const dupUrlsAll = fmt(
    await prisma.$queryRaw`
      SELECT COUNT(*) AS dupGroups, SUM(c - 1) AS extraRows FROM (
        SELECT url, COUNT(*) AS c FROM \`Listing\` GROUP BY url HAVING c > 1
      ) t`
  );
  console.log('--- duplicate urls (all time) ---');
  console.log(`  groups: ${dupUrlsAll[0].dupGroups}  extra rows: ${dupUrlsAll[0].extraRows || 0}`);

  const breakdown = fmt(
    await prisma.$queryRaw`
      SELECT
        SUM(dc = 1) AS sameChargeGroups,
        SUM(dc > 1) AS variedChargeGroups,
        SUM(CASE WHEN dc = 1 THEN c - 1 ELSE 0 END) AS sameChargeExtraRows,
        SUM(CASE WHEN dc > 1 THEN c - 1 ELSE 0 END) AS variedChargeExtraRows
      FROM (
        SELECT url, COUNT(*) AS c, COUNT(DISTINCT serviceCharge) AS dc
        FROM \`Listing\` GROUP BY url HAVING c > 1
      ) t`
  );
  const b = breakdown[0];
  console.log('\n--- duplicate url breakdown ---');
  console.log(
    `  identical serviceCharge: ${b.sameChargeGroups} groups, ${b.sameChargeExtraRows} extra rows  (likely junk)`
  );
  console.log(
    `  differing serviceCharge: ${b.variedChargeGroups} groups, ${b.variedChargeExtraRows} extra rows  (likely intentional history)`
  );

  const tightGaps = fmt(
    await prisma.$queryRaw`
      SELECT url, COUNT(*) AS c,
             DATEDIFF(MAX(scrapedAt), MIN(scrapedAt)) AS gapDays,
             MIN(serviceCharge) AS sc
      FROM \`Listing\`
      GROUP BY url
      HAVING c > 1 AND COUNT(DISTINCT serviceCharge) = 1
      ORDER BY gapDays ASC LIMIT 10`
  );
  console.log('\n--- same charge, smallest time gap (worst duplicates) ---');
  if (!tightGaps.length) {
    console.log('  none');
  } else {
    tightGaps.forEach((r) =>
      console.log(`  ${r.c}x  gap=${r.gapDays}d  sc=£${r.sc}  ${r.url}`)
    );
  }

  const topDupUrls = fmt(
    await prisma.$queryRaw`
      SELECT url, COUNT(*) AS c,
             MIN(scrapedAt) AS firstSeen, MAX(scrapedAt) AS lastSeen
      FROM \`Listing\` GROUP BY url HAVING c > 1
      ORDER BY c DESC LIMIT 10`
  );
  topDupUrls.forEach((r) =>
    console.log(`  ${r.c}x  ${r.firstSeen} -> ${r.lastSeen}  ${r.url}`)
  );

  const dupInWindow = fmt(
    await prisma.$queryRaw`
      SELECT url, COUNT(*) AS c FROM \`Listing\`
      WHERE scrapedAt >= ${since}
      GROUP BY url HAVING c > 1 ORDER BY c DESC LIMIT 10`
  );
  console.log(`\n--- duplicate urls created inside this window ---`);
  if (!dupInWindow.length) {
    console.log('  none');
  } else {
    dupInWindow.forEach((r) => console.log(`  ${r.c}x  ${r.url}`));
  }

  const reScraped = fmt(
    await prisma.$queryRaw`
      SELECT COUNT(*) AS c FROM (
        SELECT url FROM \`Listing\`
        GROUP BY url
        HAVING SUM(scrapedAt >= ${since}) > 0 AND SUM(scrapedAt < ${since}) > 0
      ) t`
  );
  console.log(
    `\n--- urls seen both before and inside the window (re-inserted) ---\n  ${reScraped[0].c}`
  );

  const reScrapedRows = fmt(
    await prisma.$queryRaw`
      SELECT url, id, serviceCharge, groundRent, beds, addressFull,
             datePosted, scrapedAt
      FROM \`Listing\`
      WHERE url IN (
        SELECT url FROM \`Listing\`
        GROUP BY url
        HAVING SUM(scrapedAt >= ${since}) > 0 AND SUM(scrapedAt < ${since}) > 0
      )
      ORDER BY url, scrapedAt`
  );

  if (reScrapedRows.length) {
    console.log('\n--- detail for re-inserted urls ---');
    let currentUrl = '';
    for (const r of reScrapedRows) {
      if (String(r.url) !== currentUrl) {
        currentUrl = String(r.url);
        console.log(`\n  ${currentUrl}`);
      }
      console.log(
        `    scrapedAt=${r.scrapedAt} datePosted=${r.datePosted} sc=£${r.serviceCharge} gr=${
          r.groundRent ?? '—'
        } beds=${r.beds} addr="${r.addressFull}"`
      );
    }
    console.log('');
  }

  const dupAddress = fmt(
    await prisma.$queryRaw`
      SELECT addressFull, beds, COUNT(*) AS c,
             COUNT(DISTINCT serviceCharge) AS distinctCharges,
             MIN(scrapedAt) AS firstSeen, MAX(scrapedAt) AS lastSeen
      FROM \`Listing\`
      GROUP BY addressFull, beds HAVING c > 1
      ORDER BY c DESC LIMIT 10`
  );
  console.log('\n--- same addressFull + beds more than once ---');
  if (!dupAddress.length) {
    console.log('  none');
  } else {
    dupAddress.forEach((r) =>
      console.log(
        `  ${r.c}x (${r.distinctCharges} distinct charges) ${r.beds} bed | ${r.firstSeen} -> ${r.lastSeen} | ${r.addressFull}`
      )
    );
  }

  await prisma.$disconnect();
};

run().catch(async (e) => {
  console.error('checkDuplicates failed:', e);
  process.exit(1);
});
