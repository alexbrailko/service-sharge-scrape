"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const puppeteer_real_browser_1 = require("puppeteer-real-browser");
(0, puppeteer_real_browser_1.connect)({
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
//# sourceMappingURL=test.js.map