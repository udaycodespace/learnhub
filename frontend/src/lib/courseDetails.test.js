import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_COURSE_PRICE,
  formatPriceLabel,
  isPaidPrice,
  parseCoursePrice,
} from './coursePricing.js';
import {
  COURSE_CATEGORIES,
  isCategoryPlaceholder,
  isUsableCourseCategory,
  normalizeCourseCategory,
} from './courseCategories.js';
import { validateCourseDetails, validateCourseUpload } from './courseUpload.js';

// #135. The browser mirror of the price and category rules. Add Course builds
// one FormData for the whole course, so a price the server is going to refuse
// has to be caught before several hundred megabytes of video go up — the same
// argument #106 made for the file rules in this module.
//
// The table below is asserted character-for-character against
// backend/tests/course-details-validation.test.js. If the two sides drift, one
// of these two files fails.

const REJECTED = [
  'abc',
  '-500',
  '1e9',
  '99.99.99',
  'NaN',
  'Infinity',
  '<script>alert(1)</script>',
  '499.999',
  'free money',
  '--1',
  '+499',
  '.5',
];

const ACCEPTED = ['499', '499.00', '1', '0.01', '12.5', '1000000'];

const FREE = ['0', '0.00', '00', 'free', 'Free', ' ', '', undefined, null];

test('the prices the API refuses are refused here too', () => {
  for (const price of REJECTED) {
    const result = parseCoursePrice(price);

    assert.equal(result.valid, false, `${price} should be refused`);
    assert.equal(result.normalized, null);
    assert.ok(result.reason);
  }
});

test('an ordinary price is accepted and stored as typed', () => {
  for (const price of ACCEPTED) {
    const result = parseCoursePrice(price);

    assert.equal(result.valid, true, `${price} should be accepted`);
    assert.equal(result.free, false);
    assert.equal(result.normalized, price);
  }
});

test('a price written the way people write prices is accepted', () => {
  assert.equal(parseCoursePrice('Rs. 1,299').normalized, '1299');
  assert.equal(parseCoursePrice('₹1,299').normalized, '1299');
  assert.equal(parseCoursePrice('$ 49.99').normalized, '49.99');
});

test('free stays free', () => {
  for (const price of FREE) {
    const result = parseCoursePrice(price);

    assert.equal(result.valid, true, `${price} should be accepted`);
    assert.equal(result.free, true);
    assert.equal(result.normalized, 'free');
  }
});

test('a zero the free pattern does not match is still free', () => {
  assert.equal(parseCoursePrice('0.000').free, true);
});

test('the ceiling matches the server', () => {
  assert.equal(MAX_COURSE_PRICE, 1000000);
  assert.equal(parseCoursePrice(String(MAX_COURSE_PRICE)).valid, true);
  assert.equal(parseCoursePrice(String(MAX_COURSE_PRICE + 1)).valid, false);
});

test('an accepted price reads as paid and renders as a label', () => {
  const result = parseCoursePrice('Rs. 1,299');

  assert.equal(isPaidPrice(result.normalized), true);
  assert.equal(formatPriceLabel(result.normalized), '1299');
});

test("the dropdown's placeholder is not a category", () => {
  assert.equal(isCategoryPlaceholder('Select categories'), true);
  assert.equal(isCategoryPlaceholder('  Select   categories '), true);
  assert.equal(isCategoryPlaceholder('Select a category'), true);
  assert.equal(isUsableCourseCategory('Select categories'), false);
  assert.equal(isUsableCourseCategory(''), false);
});

test('a real category is usable, including one outside the dropdown', () => {
  for (const category of [...COURSE_CATEGORIES, 'Engineering', 'Web']) {
    assert.equal(isUsableCourseCategory(category), true, category);
  }
});

test('a category is whitespace-collapsed, not rewritten', () => {
  assert.equal(normalizeCourseCategory('IT  &   Software'), 'IT & Software');
  assert.equal(normalizeCourseCategory(null), '');
});

test('validateCourseDetails reports both fields at once', () => {
  const errors = validateCourseDetails({
    C_price: 'abc',
    C_categories: 'Select categories',
  });

  assert.ok(errors.C_price);
  assert.ok(errors.C_categories);
});

test('validateCourseDetails passes a good course', () => {
  assert.deepEqual(
    validateCourseDetails({ C_price: '499', C_categories: 'IT & Software' }),
    {},
  );
  assert.deepEqual(
    validateCourseDetails({ C_price: '0', C_categories: 'Engineering' }),
    {},
  );
});

test('a bad price stops the submission before the sections are read', () => {
  // The point of the ordering: the upload is what costs minutes, so the cheap
  // check runs first.
  const result = validateCourseUpload({
    C_price: 'abc',
    C_categories: 'IT & Software',
    sections: [],
  });

  assert.equal(result.valid, false);
  assert.ok(result.detailErrors.C_price);
  // Not "add at least one section" — the price is the thing to fix.
  assert.match(result.formError, /number/i);
});

test('a good course with no sections still reports the sections', () => {
  const result = validateCourseUpload({
    C_price: '499',
    C_categories: 'IT & Software',
    sections: [],
  });

  assert.equal(result.valid, false);
  assert.deepEqual(result.detailErrors, {});
  assert.match(result.formError, /at least one section/i);
});

test('every validateCourseUpload result carries detailErrors', () => {
  // The form spreads this onto state, so a result without the key would leave
  // a stale error marked on a field the user has since fixed.
  const results = [
    validateCourseUpload({ C_price: 'abc', C_categories: 'Web', sections: [] }),
    validateCourseUpload({ C_price: '499', C_categories: 'Web', sections: [] }),
    validateCourseUpload({
      C_price: '499',
      C_categories: 'Web',
      sections: [{ S_title: 'a', S_description: 'b', S_content: null }],
    }),
  ];

  for (const result of results) {
    assert.ok(
      result.detailErrors && typeof result.detailErrors === 'object',
      JSON.stringify(result),
    );
  }
});
