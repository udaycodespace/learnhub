import test from 'node:test';
import assert from 'node:assert/strict';

import {
  REVIEW_DENIAL,
  canShowReviewForm,
  readEligibility,
  reviewDenialMessage,
} from './reviewEligibility.js';

// #117. The component had two states and one sentence for everything that was
// not "you may review". An educator on their own course was told to enrol —
// advice that leads nowhere, because they can enrol and the review is still
// refused.

test('a signed-out visitor is asked to sign in', () => {
  assert.match(
    reviewDenialMessage({ isAuthenticated: false, reason: null }),
    /Sign in/,
  );
});

test('a signed-in student who has not enrolled is asked to enrol', () => {
  assert.match(
    reviewDenialMessage({
      isAuthenticated: true,
      reason: REVIEW_DENIAL.NOT_ENROLLED,
    }),
    /Enroll in this course/,
  );
});

test('an author is told they created it, and not told to enrol', () => {
  const message = reviewDenialMessage({
    isAuthenticated: true,
    reason: REVIEW_DENIAL.OWN_COURSE,
  });

  assert.match(message, /You created this course/);
  assert.doesNotMatch(message, /Enroll/i);
});

test('no reason means no message, because the form is shown instead', () => {
  assert.equal(reviewDenialMessage({ isAuthenticated: true, reason: null }), '');
  assert.equal(reviewDenialMessage({ isAuthenticated: true }), '');
});

test('an unrecognised reason still says something', () => {
  // A newer server, or a field that did not survive a proxy. The enrolment
  // prompt is never actively wrong for a signed-in non-author.
  assert.match(
    reviewDenialMessage({ isAuthenticated: true, reason: 'something-new' }),
    /Enroll in this course/,
  );
});

test('signed-out wins over any reason', () => {
  assert.match(
    reviewDenialMessage({
      isAuthenticated: false,
      reason: REVIEW_DENIAL.OWN_COURSE,
    }),
    /Sign in/,
  );
});

// -- the form ----------------------------------------------------------------

test('the form shows only for a signed-in account that may review', () => {
  assert.equal(canShowReviewForm({ isAuthenticated: true, canReview: true }), true);
  assert.equal(canShowReviewForm({ isAuthenticated: true, canReview: false }), false);
  assert.equal(canShowReviewForm({ isAuthenticated: false, canReview: true }), false);
  assert.equal(canShowReviewForm({}), false);
});

// -- reading the response ----------------------------------------------------

test('an author is recognised from the reason alone', () => {
  assert.deepEqual(readEligibility({ canReview: false, reason: 'own-course' }), {
    canReview: false,
    reason: 'own-course',
    isAuthor: true,
  });
});

test('an eligible student has no reason', () => {
  assert.deepEqual(readEligibility({ canReview: true, reason: null }), {
    canReview: true,
    reason: null,
    isAuthor: false,
  });
});

test('an older server sending only canReview still produces a reason', () => {
  assert.deepEqual(readEligibility({ canReview: false }), {
    canReview: false,
    reason: REVIEW_DENIAL.NOT_ENROLLED,
    isAuthor: false,
  });
});

test('a missing or malformed body is not eligible', () => {
  assert.equal(readEligibility(undefined).canReview, false);
  assert.equal(readEligibility(null).reason, REVIEW_DENIAL.NOT_ENROLLED);
  assert.equal(readEligibility({}).isAuthor, false);
});
