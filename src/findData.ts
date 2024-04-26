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
  const featuresElement = $("section[data-testid='page_features_section']");

  const patterns = ['sqft', 'sq ft', 'square feet'];

  if (featuresElement.length === 0) {
    return null;
  }

  const text = featuresElement.text();

  for (const pattern of patterns) {
    const numberMatch = text.match(
      new RegExp(`(\\d{1,3}(?:,\\d{3})*)\\s*(?=${pattern})`, 'gi')
    );

    if (numberMatch) {
      if (numberMatch.length > 1) {
        const withComma = numberMatch.filter((e) => e.includes(','));
        return extractNumberFromString(withComma[0] || numberMatch[0]);
      }
      return extractNumberFromString(numberMatch[0]);
    }
  }

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
