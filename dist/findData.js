"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.findServiceCharge = exports.findGroundRent = exports.findArea = exports.findCoordinates = void 0;
const helpers_1 = require("./helpers");
const findCoordinates = async ($, page) => {
    try {
        await page.waitForSelector('section[aria-labelledby="local-area"]');
    }
    catch (e) {
        console.log('Error findCoordinates');
    }
    const src = $('section[aria-labelledby="local-area"]')
        .find('picture source')
        .attr('srcset');
    const urlParams = new URLSearchParams(src);
    const coordinates = urlParams.get('center'); //51.544505,-0.110049
    return coordinates;
};
exports.findCoordinates = findCoordinates;
const findArea = ($) => {
    const patterns = ['sqft', 'sq ft', 'sq.ft', 'square feet'];
    const sqFtPattern = patterns.join('|');
    const listItems = $('section[aria-labelledby="about"] ul li')
        .map((i, el) => {
        // Get the text content of the current element
        const text = $(el).text().trim();
        const patternMatch = patterns.some((pattern) => text.toLowerCase().includes(pattern));
        // Add a space after the text (except for the last element)
        return patternMatch ? text : null;
    })
        .get();
    if (listItems.length) {
        const numberMatch = listItems[0].match(new RegExp(`(\\d+(?:,\\d{3})*(?:\.\\d+)?)\\s+(?=${sqFtPattern})`, 'gi'));
        if (numberMatch) {
            const trim = numberMatch[0].replace(/,/g, '').trim();
            const int = parseInt(trim);
            return int > 100 ? int : null;
        }
        return null;
    }
    // TODO - use llm to understand text and give mack the correct number
    // const numberMatch = text.match(
    //   new RegExp(`(\\d+(?:,\\d{3})*(?:\.\\d+)?)\\s+(?=${pattern})`, 'gi')
    // );
    return null;
};
exports.findArea = findArea;
const findGroundRent = ($) => {
    const text = 'ground rent';
    const groundRentElem = $('section[aria-labelledby="key-info"]')
        .find('li')
        .filter((i, el) => $(el).text().toLowerCase().includes(text));
    const groundRentText = $(groundRentElem).find(' > div p').text();
    if (!groundRentText || groundRentText === 'Not available') {
        // search in features section
        if ($("div[data-testid='listing_features']")) {
            const filteredElement = (0, helpers_1.findMatchedElement)($, "ul[data-testid='listing_features_bulletted'] li", text);
            if (filteredElement.length) {
                return (0, helpers_1.extractNumberFromText)($(filteredElement), text);
            }
        }
        // search in description
        const filteredElement = (0, helpers_1.findMatchedElement)($, "div[data-testid='truncated_text_container']", text);
        if (filteredElement.length) {
            return (0, helpers_1.extractNumberFromText)($(filteredElement), text);
        }
        else {
            return null;
        }
    }
    else {
        return (0, helpers_1.extractNumberFromString)(groundRentText);
    }
};
exports.findGroundRent = findGroundRent;
const findServiceCharge = ($) => {
    const text = 'service charge';
    const serviceChargeElem = $('section[aria-labelledby="key-info"]')
        .find('li')
        .filter((i, el) => $(el).text().toLowerCase().includes(text));
    const serviceChargeText = $(serviceChargeElem).find(' > div p').text();
    let serviceChargeAmount = null;
    if (serviceChargeText.includes('month')) {
        serviceChargeAmount = (0, helpers_1.extractNumberFromString)(serviceChargeText) * 12;
    }
    else {
        serviceChargeAmount = (0, helpers_1.extractNumberFromString)(serviceChargeText);
    }
    if (!serviceChargeAmount || serviceChargeText === 'Not available') {
        // search in features section
        if ($("div[data-testid='listing_features']")) {
            const filteredElement = (0, helpers_1.findMatchedElement)($, "ul[data-testid='listing_features_bulletted'] li", text);
            if (filteredElement.length) {
                return (0, helpers_1.extractNumberFromText)($(filteredElement), text);
            }
        }
        // search in description
        const filteredElement = (0, helpers_1.findMatchedElement)($, "div[data-testid='truncated_text_container']", text);
        if (filteredElement.length) {
            return (0, helpers_1.extractNumberFromText)($(filteredElement), text);
        }
        else {
            return null;
        }
    }
    else {
        return serviceChargeAmount;
    }
};
exports.findServiceCharge = findServiceCharge;
//# sourceMappingURL=findData.js.map