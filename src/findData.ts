import * as cheerio from 'cheerio';
import { Page } from 'puppeteer';
import {
  extractLatLong,
  extractNumberFromString,
  extractNumberFromText,
  findMatchedElement,
} from './helpers';

export const findCoordinates = async ($: cheerio.CheerioAPI, page: Page) => {
  const src = $('section[aria-labelledby="local-area"] picture source').attr(
    'srcset'
  );

  // src is undefined when the listing has no local-area map; extractLatLong
  // handles the empty/undefined case and returns null without logging an error.
  return extractLatLong(src); //51.544505,-0.110049
};

export const findArea = ($: cheerio.CheerioAPI) => {
  const patterns = ['sqft', 'sq ft', 'sq.ft', 'square feet'];
  const sqFtPattern = patterns.join('|');

  const listItems = $('section[aria-labelledby="about"] ul li')
    .map((i, el) => {
      // Get the text content of the current element
      const text = $(el).text().trim();

      const patternMatch = patterns.some((pattern) =>
        text.toLowerCase().includes(pattern)
      );

      // Add a space after the text (except for the last element)
      return patternMatch ? text : null;
    })
    .get();

  if (listItems.length) {
    const numberMatch = listItems[0].match(
      new RegExp(`(\\d+(?:,\\d{3})*(?:\.\\d+)?)\\s+(?=${sqFtPattern})`, 'gi')
    );

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

export const findGroundRent = ($: cheerio.CheerioAPI) => {
  const text = 'ground rent';
  const groundRentElem = $('section[aria-labelledby="key-info"]')
    .find('li')
    .filter((i, el) => $(el).text().toLowerCase().includes(text));

  const groundRentText = $(groundRentElem).find(' > div p').text();

  if (
    !groundRentText ||
    groundRentText === 'Not available' ||
    groundRentText === 'Ask agent'
  ) {
    // search in the "About this property" feature bullets
    const featureMatch = findMatchedElement(
      $,
      'section[aria-labelledby="about"] li',
      text
    );

    if (featureMatch.length) {
      return extractNumberFromText($(featureMatch), text);
    }

    // search in the description text
    const filteredElement = findMatchedElement($, '#detailed-desc', text);

    if (filteredElement.length) {
      return extractNumberFromText($(filteredElement), text);
    } else {
      return null;
    }
  } else {
    return extractNumberFromString(groundRentText);
  }
};

export const findServiceCharge = ($: cheerio.CheerioAPI) => {
  const text = 'service charge';

  const serviceChargeElem = $('section[aria-labelledby="key-info"]')
    .find('li')
    .filter((i, el) => $(el).text().toLowerCase().includes(text));

  const serviceChargeText = $(serviceChargeElem).find(' > div p').text();

  let serviceChargeAmount: number | null = null;
  const extractedNumber = extractNumberFromString(serviceChargeText);

  if (serviceChargeText.includes('month') && extractedNumber !== null) {
    serviceChargeAmount = extractedNumber * 12;
  } else {
    serviceChargeAmount = extractedNumber;
  }

  if (
    !serviceChargeAmount ||
    serviceChargeText === 'Not available' ||
    serviceChargeText === 'Ask agent'
  ) {
    // search in the "About this property" feature bullets
    const featureMatch = findMatchedElement(
      $,
      'section[aria-labelledby="about"] li',
      text
    );
    if (featureMatch.length) {
      return extractNumberFromText($(featureMatch), text);
    }

    // search in the description text
    const filteredElement = findMatchedElement($, '#detailed-desc', text);

    if (filteredElement.length) {
      return extractNumberFromText($(filteredElement), text);
    } else {
      return null;
    }
  } else {
    return serviceChargeAmount;
  }
};
