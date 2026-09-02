// What "free" means, in the browser.
//
// The mirror of `backend/utils/coursePricing.js`. The rule has to exist on
// both sides — the card renders a label and decides whether to open the
// payment modal without asking the server, and the server decides whether to
// charge without asking the browser — so the only thing that can keep them
// together is that they are the same rule, stated twice, with a test on each
// side asserting the same table.
//
// Before #114 there were three rules, and the disagreement was visible:
//
//   price     catalogue  checkout  wishlist
//   "0"       free       free      paid
//   "0.00"    free       paid      paid
//   ""        paid       free      free
//
// A course priced "0.00" rendered ACCESS: Free, so clicking Enroll skipped the
// payment modal, so the request carried four empty strings, so the server —
// following the middle column — rejected it for having no card details. There
// was no way to reach the payment form, because the UI did not believe there
// was anything to pay.

export const FREE_PRICE_LABEL = 'free';

// Trailing zeros and repeated leading zeros both count: "0", "00", "0.0" and
// "0.00" are the same number. Kept character-for-character in step with
// FREE_PRICE_PATTERN in backend/utils/coursePricing.js.
export const FREE_PRICE_PATTERN = /^\s*(?:free|0+(?:\.0+)?)\s*$/i;

/**
 * Whether a price costs nothing.
 *
 * An absent or blank price is free, because that is what the server actually
 * charges for it — `enrollCourseController` records `amount: "free"` and asks
 * for no card details. The old client rule was inconsistent with itself here:
 * `undefined` and `null` returned early as free while `""` fell through to the
 * pattern and came out paid, so a course with no price rendered `ACCESS:`
 * followed by nothing and opened a payment form anyway.
 *
 * @param {unknown} price the raw `C_price` off a course
 * @returns {boolean}
 */
export function isFreePrice(price) {
  if (price === undefined || price === null) return true;

  const text = String(price).trim();

  if (!text) return true;

  return FREE_PRICE_PATTERN.test(text);
}

/**
 * @param {unknown} price
 * @returns {boolean}
 */
export function isPaidPrice(price) {
  return !isFreePrice(price);
}

/**
 * @param {object|null|undefined} course
 * @returns {boolean}
 */
export function isFreeCourse(course) {
  return isFreePrice(course?.C_price);
}

/**
 * Whether enrolling in this course should ask for card details.
 *
 * This is the predicate `AllCourses` branches on, so it is the one that has to
 * agree with `isFreeCourse` in `backend/utils/paymentDetails.js`. When they
 * disagree the course becomes unenrollable in one direction and asks for a
 * card it will never charge in the other.
 *
 * @param {object|null|undefined} course
 * @returns {boolean}
 */
export function isPaidCourse(course) {
  return !isFreeCourse(course);
}

/**
 * How a price is shown on a card.
 *
 * A free course reads "Free" rather than the stored "free", and a course with
 * no price reads "Free" rather than as an empty cell.
 *
 * @param {unknown} price
 * @returns {string}
 */
export function formatPriceLabel(price) {
  if (isFreePrice(price)) return 'Free';

  return String(price).trim();
}

/**
 * The label for a course, for the call sites holding a document rather than a
 * price.
 *
 * @param {object|null|undefined} course
 * @returns {string}
 */
export function coursePriceLabel(course) {
  return formatPriceLabel(course?.C_price);
}

/**
 * Pulls something a learner can act on out of a rejected enrolment.
 *
 * `AllCourses` used to answer every failure with one string:
 *
 *   alert("Enrollment could not be completed. Please try again.");
 *
 * The server does better than that. `buildPaymentSummary` returns a per-field
 * `errors` object and `formatPaymentMessage` joins it into a sentence, and
 * both are on the 400 body. Discarding them is what turned the pricing
 * mismatch from a confusing charge into an unexplained dead end.
 *
 * @param {unknown} error an axios error
 * @returns {string}
 */
export function readEnrollmentError(error) {
  const data = error?.response?.data;
  const message = typeof data?.message === 'string' ? data.message.trim() : '';

  if (message) return message;

  if (error?.response?.status === 401) {
    return 'Please sign in again to enroll.';
  }

  return 'Enrollment could not be completed. Please try again.';
}

/**
 * The per-field errors from a rejected enrolment, so the payment form can mark
 * the inputs that were wrong rather than only printing a sentence.
 *
 * @param {unknown} error an axios error
 * @returns {object} field name → message, empty when there are none
 */
export function readEnrollmentFieldErrors(error) {
  const errors = error?.response?.data?.errors;

  if (!errors || typeof errors !== 'object' || Array.isArray(errors)) {
    return {};
  }

  const fields = {};

  for (const [field, message] of Object.entries(errors)) {
    if (typeof message === 'string' && message.trim()) {
      fields[field] = message.trim();
    }
  }

  return fields;
}

// ---------------------------------------------------------------------------
// What a paid price is allowed to be (#135).
//
// The mirror of `parseCoursePrice` in backend/utils/coursePricing.js, for the
// same reason the free rule is mirrored: Add Course has to refuse a bad price
// before it spends several minutes uploading video, and the server has to
// refuse it regardless of what the browser did. The server check is the
// authoritative one and is unchanged by anything here.
//
// Before this, `normalizeCoursePrice` stored any non-free string verbatim, so
// a course could be published priced "abc" or "-500" and would then be
// advertised on its catalogue card, classified paid, put through the payment
// modal, and recorded as the `amount` on the payments row the admin dashboard
// totals.

export const MAX_COURSE_PRICE = 1000000;
export const MAX_PRICE_LENGTH = 40;

// Digits, optionally a decimal point and one or two places. No sign and no
// exponent. Kept character-for-character in step with PRICE_PATTERN in
// backend/utils/coursePricing.js.
export const PRICE_PATTERN = /^\d+(?:\.\d{1,2})?$/;

const PRICE_NOISE_PATTERN = /[\s,₹$€£]|(?:^rs\.?)/gi;

const priceFailure = (reason) => ({
  valid: false,
  free: false,
  amount: null,
  normalized: null,
  reason,
});

const freePrice = () => ({
  valid: true,
  free: true,
  amount: 0,
  normalized: FREE_PRICE_LABEL,
  reason: null,
});

/**
 * Whether a submitted price is one the platform can charge.
 *
 * @param {unknown} value
 * @param {object} [options]
 * @param {number} [options.max]
 * @returns {{valid: boolean, free: boolean, amount: number|null,
 *            normalized: string|null, reason: string|null}}
 */
export function parseCoursePrice(value, { max = MAX_COURSE_PRICE } = {}) {
  if (isFreePrice(value)) return freePrice();

  const raw = String(value).trim();

  if (raw.length > MAX_PRICE_LENGTH) {
    return priceFailure(`Price must be at most ${MAX_PRICE_LENGTH} characters`);
  }

  const cleaned = raw.replace(PRICE_NOISE_PATTERN, '');

  if (!PRICE_PATTERN.test(cleaned)) {
    return priceFailure(
      'Price must be a number, for example 499 or 499.00. Enter 0 for a free course',
    );
  }

  const amount = Number(cleaned);

  if (!Number.isFinite(amount)) {
    return priceFailure('Price is not a number this platform can charge');
  }

  if (amount > max) {
    return priceFailure(`Price must be at most ${max}`);
  }

  // isFreePrice has already claimed everything reading as zero; a form like
  // "0.000" that its one-or-more-zeros branch missed lands here and is free.
  if (amount === 0) return freePrice();

  return {
    valid: true,
    free: false,
    amount,
    normalized: cleaned,
    reason: null,
  };
}
