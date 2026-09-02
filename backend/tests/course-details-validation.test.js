const test = require("node:test");
const assert = require("node:assert/strict");

const {
  MAX_COURSE_PRICE,
  MAX_PRICE_LENGTH,
  formatPriceLabel,
  isPaidPrice,
  parseCoursePrice,
} = require("../utils/coursePricing");
const {
  COURSE_CATEGORIES,
  categoryErrorMessage,
  isCategoryPlaceholder,
  normalizeCourseCategory,
} = require("../utils/courseCategories");
const { validateCourseSubmission } = require("../utils/courseInput");

// #135. POST /api/user/addcourse validated the title, the category, the
// description and the section videos, and never looked at the price:
//
//   C_price: normalizeCoursePrice(asTrimmedString(body.C_price)),
//
// `normalizeCoursePrice` collapses the free forms to one label and passes
// everything else through verbatim, so "abc" and "-500" were stored, rendered
// on the catalogue card, classified paid, put through the payment modal, and
// written into the payments row's `amount` — the column the admin dashboard
// totals.
//
// The category was checked with `requireText`, which any non-empty string
// satisfies, including the dropdown's own "Select categories" placeholder.

const teacher = { _id: "64b7f1e2c3d4e5f607182930", name: "Jane Educator" };

function submission(overrides = {}) {
  return {
    body: {
      C_title: "Intro to Testing",
      C_categories: "Engineering",
      C_description: "A short course.",
      C_price: "499",
      S_title: "Section one",
      S_description: "Opening section",
      ...(overrides.body || {}),
    },
    files: overrides.files || [{ filename: "one.mp4" }],
    user: "user" in overrides ? overrides.user : teacher,
  };
}

/* ------------------------------------------------------------------ *
 * parseCoursePrice
 * ------------------------------------------------------------------ */

test("the prices that were accepted verbatim are refused", () => {
  // Every one of these was stored, advertised and charged before this change.
  const rejected = [
    "abc",
    "-500",
    "1e9",
    "99.99.99",
    "NaN",
    "Infinity",
    "<script>alert(1)</script>",
    "499.999",
    "free money",
    "--1",
    "+499",
    ".5",
  ];

  for (const price of rejected) {
    const result = parseCoursePrice(price);

    assert.equal(result.valid, false, `${price} should be refused`);
    assert.equal(result.normalized, null);
    assert.ok(result.reason, `${price} should say why`);
  }
});

test("an ordinary price is accepted and stored as typed", () => {
  for (const price of ["499", "499.00", "1", "0.01", "12.5", "1000000"]) {
    const result = parseCoursePrice(price);

    assert.equal(result.valid, true, `${price} should be accepted`);
    assert.equal(result.free, false);
    assert.equal(result.normalized, price);
  }
});

test("a price written the way people write prices is accepted", () => {
  // Separators and a currency symbol are stripped, not refused, and are not
  // part of what is stored — so "Rs. 1,299" and "1299" are one price and the
  // catalogue's price column can be compared.
  assert.equal(parseCoursePrice("Rs. 1,299").normalized, "1299");
  assert.equal(parseCoursePrice("₹1,299").normalized, "1299");
  assert.equal(parseCoursePrice("$ 49.99").normalized, "49.99");
  assert.equal(parseCoursePrice("1 299").normalized, "1299");
});

test("free stays free and is not second-guessed", () => {
  for (const price of ["0", "0.00", "00", "free", "Free", " ", "", undefined, null]) {
    const result = parseCoursePrice(price);

    assert.equal(result.valid, true, `${price} should be accepted`);
    assert.equal(result.free, true);
    assert.equal(result.normalized, "free");
    assert.equal(result.amount, 0);
  }
});

test("a zero the free pattern does not match is still free", () => {
  // "0.000" has three decimal places, so FREE_PRICE_PATTERN's 0+(\.0+)? branch
  // matches it but PRICE_PATTERN's two-place limit would not. It must not fall
  // between the two rules and be refused.
  const result = parseCoursePrice("0.000");

  assert.equal(result.valid, true);
  assert.equal(result.free, true);
  assert.equal(result.normalized, "free");
});

test("a price above the ceiling is refused", () => {
  assert.equal(parseCoursePrice(String(MAX_COURSE_PRICE)).valid, true);
  assert.equal(parseCoursePrice(String(MAX_COURSE_PRICE + 1)).valid, false);
  assert.match(
    parseCoursePrice("999999999999").reason,
    new RegExp(String(MAX_COURSE_PRICE)),
  );
});

test("an over-long price is refused before it is parsed", () => {
  const result = parseCoursePrice("9".repeat(MAX_PRICE_LENGTH + 1));

  assert.equal(result.valid, false);
  assert.match(result.reason, /at most/);
});

test("an accepted price is one the rest of the app can read", () => {
  // The contract that was broken: whatever is stored has to render as a label
  // and classify as paid without anybody having to special-case it.
  const result = parseCoursePrice("Rs. 1,299");

  assert.equal(isPaidPrice(result.normalized), true);
  assert.equal(formatPriceLabel(result.normalized), "1299");
});

/* ------------------------------------------------------------------ *
 * the category placeholder
 * ------------------------------------------------------------------ */

test("the dropdown's placeholder is not a category", () => {
  assert.equal(isCategoryPlaceholder("Select categories"), true);
  assert.equal(isCategoryPlaceholder("select categories"), true);
  assert.equal(isCategoryPlaceholder("  Select   categories  "), true);
  assert.equal(isCategoryPlaceholder("Select a category"), true);
});

test("a real category is not mistaken for the placeholder", () => {
  for (const category of [...COURSE_CATEGORIES, "Engineering", "Web"]) {
    assert.equal(isCategoryPlaceholder(category), false, category);
  }
});

test("the category is not restricted to the three the dropdown offers", () => {
  // Deliberate. C_categories is free-form throughout the app and an allow-list
  // would reject courses that are correctly categorised today.
  const result = validateCourseSubmission(
    submission({ body: { C_categories: "Engineering" } }),
  );

  assert.equal(result.valid, true);
  assert.equal(result.value.C_categories, "Engineering");
});

test("a category's whitespace is collapsed so the filter can match it", () => {
  assert.equal(normalizeCourseCategory("IT  &   Software"), "IT & Software");
  assert.equal(normalizeCourseCategory("  Web  "), "Web");
  assert.equal(normalizeCourseCategory(null), "");
});

/* ------------------------------------------------------------------ *
 * validateCourseSubmission
 * ------------------------------------------------------------------ */

test("a course cannot be published at a price that is not a price", () => {
  const result = validateCourseSubmission(
    submission({ body: { C_price: "abc" } }),
  );

  assert.equal(result.valid, false);
  assert.ok(result.errors.C_price);
  assert.equal(result.value, undefined);
});

test("a negative price is refused rather than charged", () => {
  const result = validateCourseSubmission(
    submission({ body: { C_price: "-500" } }),
  );

  assert.equal(result.valid, false);
  assert.ok(result.errors.C_price);
});

test("an untouched category dropdown is refused", () => {
  const result = validateCourseSubmission(
    submission({ body: { C_categories: "Select categories" } }),
  );

  assert.equal(result.valid, false);
  assert.equal(result.errors.C_categories, categoryErrorMessage());
});

test("a blank category is still refused, with its original message", () => {
  const result = validateCourseSubmission(
    submission({ body: { C_categories: "   " } }),
  );

  assert.equal(result.valid, false);
  assert.match(result.errors.C_categories, /required/i);
});

test("both bad fields are reported together, not one at a time", () => {
  const result = validateCourseSubmission(
    submission({
      body: { C_price: "abc", C_categories: "Select categories" },
    }),
  );

  assert.equal(result.valid, false);
  assert.ok(result.errors.C_price);
  assert.ok(result.errors.C_categories);
});

test("a valid submission stores the normalised price", () => {
  const result = validateCourseSubmission(
    submission({ body: { C_price: "Rs. 1,299" } }),
  );

  assert.equal(result.valid, true);
  assert.equal(result.value.C_price, "1299");
});

test("a free submission still stores the free label", () => {
  for (const price of ["0", "0.00", "", "free"]) {
    const result = validateCourseSubmission(
      submission({ body: { C_price: price } }),
    );

    assert.equal(result.valid, true, price);
    assert.equal(result.value.C_price, "free");
  }
});

test("the price is read through the repeated-field guard", () => {
  // A repeated multipart field arrives as an array. "abc" hiding behind a
  // valid first value must not reach the database, and a valid first value
  // must still be read.
  const result = validateCourseSubmission(
    submission({ body: { C_price: ["499", "abc"] } }),
  );

  assert.equal(result.valid, true);
  assert.equal(result.value.C_price, "499");

  const rejected = validateCourseSubmission(
    submission({ body: { C_price: ["abc", "499"] } }),
  );

  assert.equal(rejected.valid, false);
});
