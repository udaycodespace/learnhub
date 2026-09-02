import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CONFIRM_TONE,
  createConfirmRequest,
  routeEnrollmentFeedback,
} from './confirmDialog.js';

// #137. Five blocking native dialogs remained after #36 converted Login.
// `window.confirm` halts the tab's event loop, is not announced as page
// content, cannot be themed, says OK and Cancel whatever is about to happen,
// and has nowhere to put the consequence of the thing it is asking about.

test('a confirmation carries its consequence and names its action', () => {
  const request = createConfirmRequest({
    title: 'Delete your review?',
    consequence: 'The course average will be recalculated without it.',
    confirmLabel: 'Delete review',
    onConfirm: () => {},
  });

  assert.equal(request.title, 'Delete your review?');
  assert.match(request.consequence, /recalculated/);
  assert.equal(request.confirmLabel, 'Delete review');
  assert.equal(request.cancelLabel, 'Cancel');
  assert.equal(request.tone, CONFIRM_TONE.DANGER);
});

test('a confirm button never says OK', () => {
  // The whole difference between this and window.confirm's default.
  const request = createConfirmRequest({
    title: 'Do the thing?',
    onConfirm: () => {},
  });

  assert.notEqual(request.confirmLabel, 'OK');
  assert.equal(request.confirmLabel, 'Confirm');
});

test('destructive is the default tone', () => {
  const request = createConfirmRequest({
    title: 'Remove it?',
    onConfirm: () => {},
  });

  assert.equal(request.tone, CONFIRM_TONE.DANGER);
});

test('an unknown tone falls back to destructive rather than rendering plain', () => {
  const request = createConfirmRequest({
    title: 'Remove it?',
    tone: 'chartreuse',
    onConfirm: () => {},
  });

  assert.equal(request.tone, CONFIRM_TONE.DANGER);
});

test('a neutral tone is kept when it is asked for', () => {
  const request = createConfirmRequest({
    title: 'Leave this page?',
    tone: CONFIRM_TONE.NEUTRAL,
    onConfirm: () => {},
  });

  assert.equal(request.tone, CONFIRM_TONE.NEUTRAL);
});

test('a request with nothing to do is not a request', () => {
  // The dialog renders on a truthy request, so a malformed one must be null
  // rather than a panel whose confirm button throws.
  assert.equal(createConfirmRequest({ title: 'No handler' }), null);
  assert.equal(createConfirmRequest({ onConfirm: () => {} }), null);
  assert.equal(createConfirmRequest({ title: 'x', onConfirm: 'nope' }), null);
  assert.equal(createConfirmRequest(), null);
});

test('the handler is carried through unchanged', () => {
  let called = 0;
  const request = createConfirmRequest({
    title: 'Go?',
    onConfirm: () => {
      called += 1;
    },
  });

  request.onConfirm();

  assert.equal(called, 1);
});

/* ------------------------------------------------------------------ *
 * enrolment feedback
 * ------------------------------------------------------------------ */

test('a successful enrolment is a toast, not a blocking dialog', () => {
  const feedback = routeEnrollmentFeedback({
    success: true,
    message: 'Enroll Successfully',
  });

  assert.equal(feedback.toast.message, 'Enroll Successfully');
  assert.equal(feedback.toast.type, 'success');
  assert.equal(feedback.inlineError, '');
});

test('a free course failure is reported somewhere it can be re-read', () => {
  // The regression. A free course has no payment modal, so its only error path
  // was an alert() that was gone the moment it was dismissed.
  const feedback = routeEnrollmentFeedback({
    success: false,
    message: 'This course is not ready for enrolment yet',
    hasOpenForm: false,
  });

  assert.equal(feedback.toast.type, 'error');
  assert.match(feedback.toast.message, /not ready/);
  // No form on screen, so nowhere to put an inline copy.
  assert.equal(feedback.inlineError, '');
});

test('a paid course failure keeps its inline copy beside the fields', () => {
  const feedback = routeEnrollmentFeedback({
    success: false,
    message: 'Card number is not valid',
    hasOpenForm: true,
  });

  assert.equal(feedback.inlineError, 'Card number is not valid');
  assert.equal(feedback.toast.message, 'Card number is not valid');
  assert.equal(feedback.toast.type, 'error');
});

test('both halves of the flow report the same failure the same way', () => {
  // The two were in different registers: inline and re-readable for a paid
  // course, a vanishing dialog for a free one, for the identical failure.
  const message = 'Course Not Found!';

  const free = routeEnrollmentFeedback({ success: false, message });
  const paid = routeEnrollmentFeedback({
    success: false,
    message,
    hasOpenForm: true,
  });

  assert.deepEqual(free.toast, paid.toast);
});

test('a silent failure still says something', () => {
  const feedback = routeEnrollmentFeedback({ success: false, message: '' });

  assert.ok(feedback.toast.message.length > 0);
  assert.equal(feedback.toast.type, 'error');
});

test('a silent success still says something', () => {
  const feedback = routeEnrollmentFeedback({ success: true, message: '   ' });

  assert.ok(feedback.toast.message.length > 0);
  assert.equal(feedback.toast.type, 'success');
});

test('no outcome at all is treated as a failure rather than throwing', () => {
  const feedback = routeEnrollmentFeedback();

  assert.equal(feedback.toast.type, 'error');
  assert.ok(feedback.toast.message.length > 0);
});
