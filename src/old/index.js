const zoopla = require('./zoopla.js');
const cron = require('node-cron');

// const Prisma = require("@prisma/client");

// (async () => {
//   await zoopla.initialize();
//   await zoopla.agreeOnTerms();
//   await zoopla.preparePages();
//   await zoopla.close();

  // const prisma = new Prisma.PrismaClient();
  // const data = await prisma.listing.findMany({
  //     take: 1,
  //     orderBy: {
  //       datePosted: 'desc',
  //     },
  // });

  // const newDate = data[0].datePosted;

  // console.log('data', newDate.setDate(newDate.getDate()-5));


//})();


// every 2 days '0 0 */2 * *'
cron.schedule('0 0 */2 * *', async function() {
  await zoopla.initialize();
  //await zoopla.removeDuplicates();
  await zoopla.agreeOnTerms();
  await zoopla.preparePages();
  await zoopla.close();
  console.log('FINISHED AT', date.toGMTString());
}, {
  runOnInit: true
});

// * * * * *   running a task every minute

// cron.schedule('0 0 */2 * *', async () => {
//   console.log('running a task every minute');
//   await test();
//   console.log('finish');
// }, {
//   runOnInit: true
// });

