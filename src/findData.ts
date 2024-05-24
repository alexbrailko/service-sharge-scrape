import * as cheerio from 'cheerio';
import { Page } from 'puppeteer';
import {
  extractNumberFromString,
  extractNumberFromText,
  findMatchedElement,
} from './helpers';

export const findCoordinates = async ($: cheerio.CheerioAPI, page: Page) => {
  try {
    await page.waitForSelector("picture[data-testid='static-google-image']");
  } catch (e) {
    console.log('Error findCoordinates');
  }

  const src = $("picture[data-testid='static-google-image'] source").attr(
    'srcset'
  );
  const urlParams = new URLSearchParams(src);
  const coordinates = urlParams.get('center'); //51.544505,-0.110049

  return coordinates;
};

export const findArea = ($: cheerio.CheerioAPI) => {
  const patterns = ['sqft', 'sq ft', 'sq.ft', 'square feet'];
  const sqFtPattern = patterns.join('|');

  const listItems = $("div[data-testid='listing_features'] ul li")
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
  const groundRentElem = $(
    "button[data-testid='ground-rent-help-icon-wrapper']"
  )
    .parent()
    .parent();

  const groundRentText = $(groundRentElem).text();

  if (!groundRentText || groundRentText === 'Not available') {
    // search in features section
    if ($("div[data-testid='listing_features']")) {
      const filteredElement = findMatchedElement(
        $,
        "ul[data-testid='listing_features_bulletted'] li",
        text
      );

      if (filteredElement.length) {
        return extractNumberFromText($(filteredElement), text);
      }
    }

    // search in description
    const filteredElement = findMatchedElement(
      $,
      "div[data-testid='truncated_text_container']",
      text
    );

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

  const serviceChargeElem = $(
    "button[data-testid='service-charge-help-icon-wrapper']"
  )
    .parent()
    .parent();

  const serviceChargeText = $(serviceChargeElem).text();

  let serviceChargeAmount: number = null;

  if (serviceChargeText.includes('month')) {
    serviceChargeAmount = extractNumberFromString(serviceChargeText) * 12;
  } else {
    serviceChargeAmount = extractNumberFromString(serviceChargeText);
  }

  if (!serviceChargeAmount || serviceChargeText === 'Not available') {
    // search in features section
    if ($("div[data-testid='listing_features']")) {
      const filteredElement = findMatchedElement(
        $,
        "ul[data-testid='listing_features_bulletted'] li",
        text
      );
      if (filteredElement.length) {
        return extractNumberFromText($(filteredElement), text);
      }
    }

    // search in description
    const filteredElement = findMatchedElement(
      $,
      "div[data-testid='truncated_text_container']",
      text
    );

    if (filteredElement.length) {
      return extractNumberFromText($(filteredElement), text);
    } else {
      return null;
    }
  } else {
    return serviceChargeAmount;
  }
};