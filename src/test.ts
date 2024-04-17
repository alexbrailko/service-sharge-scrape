import { connect } from 'puppeteer-real-browser';

connect({
  headless: 'auto',

  args: [],

  customConfig: {},

  skipTarget: [],

  fingerprint: true,

  turnstile: true,

  connectOption: {},

  tf: true,

  // proxy:{
  //     host:'<proxy-host>',
  //     port:'<proxy-port>',
  //     username:'<proxy-username>',
  //     password:'<proxy-password>'
  // }
})
  .then(async (response) => {
    const { browser, page } = response;
    await page.goto('https://www.zoopla.co.uk');
  })
  .catch((error) => {
    console.log(error.message);
  });
