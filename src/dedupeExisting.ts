require('dotenv').config();

import { PrismaClient } from '@prisma/client';

const APPLY = process.env.APPLY === 'true';

const num = (v: any) => (typeof v === 'bigint' ? Number(v) : v);

const run = async () => {
  const prisma = new PrismaClient();

  const [dirty] = (await prisma.$queryRaw`
    SELECT COUNT(*) AS c FROM \`Listing\` WHERE url LIKE '%?%'`) as any[];

  const [beforeTotal] = (await prisma.$queryRaw`
    SELECT COUNT(*) AS c FROM \`Listing\``) as any[];

  const [dupes] = (await prisma.$queryRaw`
    SELECT COUNT(*) AS groups, COALESCE(SUM(c - 1), 0) AS rowsToDelete FROM (
      SELECT SUBSTRING_INDEX(url, '?', 1) AS u, serviceCharge, COUNT(*) AS c
      FROM \`Listing\`
      GROUP BY u, serviceCharge
      HAVING c > 1
    ) t`) as any[];

  console.log(`mode: ${APPLY ? 'APPLY (destructive)' : 'DRY RUN'}\n`);
  console.log(`rows total:                    ${num(beforeTotal.c)}`);
  console.log(`urls containing a query string: ${num(dirty.c)}`);
  console.log(`duplicate groups after normalising: ${num(dupes.groups)}`);
  console.log(`rows that would be deleted:     ${num(dupes.rowsToDelete)}`);
  console.log(
    `rows remaining afterwards:      ${
      num(beforeTotal.c) - num(dupes.rowsToDelete)
    }`
  );

  if (!APPLY) {
    console.log(
      '\nNothing changed. Re-run with APPLY=true to normalise urls and delete duplicates.'
    );
    await prisma.$disconnect();
    return;
  }

  console.log('\nnormalising urls...');
  const normalised = await prisma.$executeRaw`
    UPDATE \`Listing\`
    SET url = SUBSTRING_INDEX(url, '?', 1)
    WHERE url LIKE '%?%'`;
  console.log(`  updated ${normalised} rows`);

  console.log('deleting duplicates, keeping one row per (url, serviceCharge)...');
  const deleted = await prisma.$executeRaw`
    DELETE FROM \`Listing\` WHERE id NOT IN (
      SELECT keepId FROM (
        SELECT MIN(id) AS keepId FROM \`Listing\` GROUP BY url, serviceCharge
      ) t
    )`;
  console.log(`  deleted ${deleted} rows`);

  const [afterTotal] = (await prisma.$queryRaw`
    SELECT COUNT(*) AS c FROM \`Listing\``) as any[];
  const [stillDupe] = (await prisma.$queryRaw`
    SELECT COUNT(*) AS c FROM (
      SELECT url, serviceCharge FROM \`Listing\`
      GROUP BY url, serviceCharge HAVING COUNT(*) > 1
    ) t`) as any[];

  console.log(`\nrows now:              ${num(afterTotal.c)}`);
  console.log(`remaining duplicates:  ${num(stillDupe.c)}`);

  await prisma.$disconnect();
};

run().catch(async (e) => {
  console.error('dedupeExisting failed:', e);
  process.exit(1);
});
