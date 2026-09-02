import test from 'node:test';
import assert from 'node:assert/strict';

import { describeReviewsLink } from './reviewAccess.js';

// #136. The badge on every catalogue card is the entry point to a course's
// reviews, and it used to be an inert div. Its label is the whole sentence,
// because the stars, the average and the count are three separate nodes and a
// control should say what activating it does.

/* ------------------------------------------------------------------ *
 * the catalogue entry point
 * ------------------------------------------------------------------ */

test('the badge label reads as a sentence and says what it opens', () => {
  // The stars, the average and the count render as three separate nodes, so
  // the accessible name has to carry the whole thing.
  const label = describeReviewsLink(
    { averageRating: 4.6, totalReviews: 23 },
    'Intro to Testing',
  );

  assert.match(label, /4\.6/);
  assert.match(label, /23 reviews/);
  assert.match(label, /Intro to Testing/);
  assert.match(label, /open reviews/i);
});

test('one review is singular', () => {
  const label = describeReviewsLink({ averageRating: 5, totalReviews: 1 });

  assert.match(label, /1 review\b/);
  assert.doesNotMatch(label, /1 reviews/);
});

test('an unreviewed course says so rather than reading "0 reviews"', () => {
  const label = describeReviewsLink({ averageRating: 0, totalReviews: 0 });

  assert.match(label, /no reviews yet/i);
  assert.match(label, /open reviews/i);
});

test('a missing summary does not produce NaN in the label', () => {
  for (const summary of [undefined, {}, { totalReviews: null }]) {
    const label = describeReviewsLink(summary);

    assert.doesNotMatch(label, /NaN|undefined/);
  }
});

test('the course title is optional', () => {
  const label = describeReviewsLink({ averageRating: 4, totalReviews: 2 });

  assert.doesNotMatch(label, /\bfor\b/);
  assert.match(label, /2 reviews/);
});
