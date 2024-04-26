"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.findServiceCharge = exports.findGroundRent = exports.findArea = exports.findCoordinates = void 0;
const helpers_1 = require("./helpers");
const findCoordinates = async ($, page) => {
    try {
        await page.waitForSelector("picture[data-testid='static-google-image']");
    }
    catch (e) {
        console.log('Error findCoordinates');
    }
    const src = $("picture[data-testid='static-google-image'] source").attr('srcset');
    const urlParams = new URLSearchParams(src);
    const coordinates = urlParams.get('center'); //51.544505,-0.110049
    return coordinates;
};
exports.findCoordinates = findCoordinates;
const findArea = ($) => {
    const featuresElement = $("section[data-testid='page_features_section']");
    const patterns = ['sqft', 'sq ft', 'square feet'];
    if (featuresElement.length === 0) {
        return null;
    }
    const text = featuresElement.text();
    for (const pattern of patterns) {
        const numberMatch = text.match(new RegExp(`(\\d{1,3}(?:,\\d{3})*)\\s*(?=${pattern})`, 'gi'));
        if (numberMatch) {
            if (numberMatch.length > 1) {
                const withComma = numberMatch.filter((e) => e.includes(','));
                return (0, helpers_1.extractNumberFromString)(withComma[0] || numberMatch[0]);
            }
            return (0, helpers_1.extractNumberFromString)(numberMatch[0]);
        }
    }
    return null;
};
exports.findArea = findArea;
const findGroundRent = ($) => {
    const text = 'ground rent';
    const groundRentElem = $("button[data-testid='ground-rent-help-icon-wrapper']")
        .parent()
        .parent();
    const groundRentText = $(groundRentElem).text();
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
    const serviceChargeElem = $("button[data-testid='service-charge-help-icon-wrapper']")
        .parent()
        .parent();
    const serviceChargeText = $(serviceChargeElem).text();
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