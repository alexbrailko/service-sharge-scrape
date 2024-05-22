import moment from 'moment';
import { Page } from 'puppeteer';

export function numberWithCommas(x) {
  return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function extractNumberFromString(string) {
  const str = string.match(/\d+\,\d+|\d+\b|\d+(?=\w)/g);
  if (!str) return null;
  const removeCommas = str[0].replaceAll(',', '');

  return parseInt(removeCommas);
}

export function findMatchedElement($, selector, matcher) {
  return $(selector).filter(function () {
    const reg = new RegExp(matcher, 'ig');
    return reg.test($(this).text());
  });
}

export function isBeforeToday(date) {
  const today = new Date();

  today.setHours(0, 0, 0, 0);

  return date < today;
}

export function moreThanXHoursAgo(date, hours = 1) {
  const HOURS = 1000 * 60 * (60 * hours);
  const hoursAgo = Date.now() - HOURS;

  return date < hoursAgo;
}

export function updateURLParameter(url, param, paramVal) {
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

export const incrementPrice = (price: number, isMax?: boolean) => {
  let newPrice = price;
  //let maxPrice = newPrice;

  if (isMax) {
    newPrice++;
    // console.log('maxPrice1', maxPrice);
  }

  if (newPrice < 1000000) {
    newPrice = newPrice + 50000;
  } else if (newPrice >= 1000000 && newPrice < 3000000) {
    newPrice = newPrice + 100000;
  } else {
    newPrice = newPrice + 500000;
  }

  if (isMax) {
    return newPrice - 1;
  }

  return newPrice;
};

export const extractNumberFromText = (el, str): number => {
  const elem = el.text().toLowerCase();
  const cutText = elem.substr(elem.indexOf(str) + str.length);
  const index = cutText.indexOf('£');

  if (index > 20) return null;
  if (
    cutText.substr(0, 30).search(/(n\/a)/) > -1 ||
    cutText.substr(0, 30).includes('tbc')
  ) {
    return null;
  }

  const newText = cutText.substring(index).substr(0, 30);
  const extractNumber = extractNumberFromString(newText);

  if (
    newText.includes('pm') ||
    newText.includes('month') ||
    newText.includes('pcm')
  ) {
    return extractNumber * 12;
  }

  if (newText.includes('per quarter')) {
    return extractNumber * 4;
  }

  return extractNumber;
};

export async function delay() {
  const delay = Math.floor(Math.random() * (4000 - 2000 + 1)) + 2000;
  return await new Promise((resolve) => setTimeout(resolve, delay));
}

export function numberDifferencePercentage(
  num1: number,
  num2: number,
  percent: number = 5
) {
  // Handle division by zero
  if (num2 === 0) {
    return false;
  }

  // Calculate the absolute difference
  const difference = Math.abs(num1 - num2);

  // Calculate the percentage difference
  const percentageDifference = (difference / Math.abs(num2)) * 100;

  // Check if difference is more than 5%
  return percentageDifference > percent;
}

export function isNMonthsApart(date1: Date, date2: Date, months: number = 3) {
  const moment1 = moment(date1);
  const moment2 = moment(date2);

  // Calculate the absolute difference in months
  const monthsDiff = Math.abs(moment1.diff(moment2, 'months'));

  // Check if the difference is greater than or equal to 3 months
  return monthsDiff >= months;
}

export async function navigateWithRetry(
  page: Page,
  url: string,
  errMsg?: string
) {
  const MAX_RETRIES = 3; // Define maximum retries here
  let retries = 0;
  while (retries < MAX_RETRIES) {
    try {
      await Promise.all([
        page.waitForNavigation(),
        page.goto(url, {
          waitUntil: ['networkidle0', 'domcontentloaded'],
          timeout: 10000,
        }),
      ]);
      return; // Success, exit the loop
    } catch (e) {
      if (e instanceof Error && e.message.includes('navigation')) {
        console.log(
          `Error: Navigation failed for ${url}, retrying (${retries + 1}/${MAX_RETRIES})`
        );
        retries++;
      } else {
        throw e; // Re-throw other errors
      }
    }
    await delay();
  }
  console.error(
    `Error: Navigation failed for ${url} after ${MAX_RETRIES} retries`
  );
  return false;
}
