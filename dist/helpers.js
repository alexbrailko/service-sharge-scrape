"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.helpers = void 0;
const moment_1 = __importDefault(require("moment"));
function numberWithCommas(x) {
    return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
function extractNumberFromString(string) {
    const str = string.match(/\d+\,\d+|\d+\b|\d+(?=\w)/g);
    if (!str)
        return null;
    const removeCommas = str[0].replaceAll(',', '');
    return parseInt(removeCommas);
}
function findMatchedElement($, selector, matcher) {
    return $(selector).filter(function () {
        const reg = new RegExp(matcher, 'ig');
        return reg.test($(this).text());
    });
}
function isBeforeToday(date) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return date < today;
}
function moreThanXHoursAgo(date, hours = 1) {
    const HOURS = 1000 * 60 * (60 * hours);
    const hoursAgo = Date.now() - HOURS;
    return date < hoursAgo;
}
function updateURLParameter(url, param, paramVal) {
    var newAdditionalURL = '';
    var tempArray = url.split('?');
    var baseURL = tempArray[0];
    var additionalURL = tempArray[1];
    var temp = '';
    if (additionalURL) {
        tempArray = additionalURL.split('&');
        for (var i = 0; i < tempArray.length; i++) {
            if (tempArray[i].split('=')[0] != param) {
                newAdditionalURL += temp + tempArray[i];
                temp = '&';
            }
        }
    }
    var rows_txt = temp + '' + param + '=' + paramVal;
    return baseURL + '?' + newAdditionalURL + rows_txt;
}
const incrementPrice = (price, isMax) => {
    let newPrice = price;
    //let maxPrice = newPrice;
    if (isMax) {
        newPrice++;
        // console.log('maxPrice1', maxPrice);
    }
    if (newPrice < 800000) {
        newPrice = newPrice + 50000;
    }
    else if (newPrice >= 800000 && newPrice < 1000000) {
        newPrice = newPrice + 100000;
    }
    else if (newPrice >= 1000000) {
        newPrice = newPrice + 500000;
    }
    if (isMax) {
        return newPrice - 1;
    }
    return newPrice;
};
const extractNumberFromText = (el, str) => {
    const elem = el.text().toLowerCase();
    const cutText = elem.substr(elem.indexOf(str) + str.length);
    const index = cutText.indexOf('£');
    if (index > 20)
        return null;
    if (cutText.substr(0, 30).search(/(n\/a)/) > -1 ||
        cutText.substr(0, 30).includes('tbc')) {
        return null;
    }
    const newText = cutText.substring(index).substr(0, 30);
    const extractNumber = exports.helpers.extractNumberFromString(newText);
    if (newText.includes('pm') ||
        newText.includes('month') ||
        newText.includes('pcm')) {
        return extractNumber * 12;
    }
    if (newText.includes('per quarter')) {
        return extractNumber * 4;
    }
    return extractNumber;
};
async function delay() {
    const delay = Math.floor(Math.random() * (4000 - 2000 + 1)) + 2000;
    return await new Promise((resolve) => setTimeout(resolve, delay));
}
function compareNumberDifference(previousValue, currentValue, diffNumber = 50) {
    if (previousValue === undefined) {
        // No previous value, return false
        return false;
    }
    const difference = Math.abs(currentValue - previousValue);
    return difference >= diffNumber;
}
function isNMonthsApart(date1, date2, months = 3) {
    const moment1 = (0, moment_1.default)(date1);
    const moment2 = (0, moment_1.default)(date2);
    // Calculate the absolute difference in months
    const monthsDiff = Math.abs(moment1.diff(moment2, 'months'));
    // Check if the difference is greater than or equal to 3 months
    return monthsDiff >= months;
}
exports.helpers = {
    numberWithCommas,
    extractNumberFromString,
    findMatchedElement,
    isBeforeToday,
    updateURLParameter,
    moreThanXHoursAgo,
    incrementPrice,
    extractNumberFromText,
    compareNumberDifference,
    delay,
    isNMonthsApart,
};
//# sourceMappingURL=helpers.js.map