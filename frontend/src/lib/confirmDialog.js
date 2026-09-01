// The shape of a destructive confirmation.
//
// #36 replaced the native dialogs in Login with the Toast component, and
// TeacherHome and CourseContent were converted later. TeacherHome carries the
// reason:
//
//   // The native confirm() blocked the tab and was not announced to assistive
//   // technology. An in-page confirmation is inspectable and dismissible.
//
// Four call sites in three components were never converted (#137). Two of them
// guard a destructive action with `window.confirm`, whose text is a bare
// sentence with no room for consequences, whose buttons say OK and Cancel
// whatever is about to happen, and which blocks the whole tab's event loop
// while it is up.
//
// This module holds the copy and the defaults, so a confirmation is a value
// that can be asserted rather than a string buried in a handler.

export const CONFIRM_TONE = Object.freeze({
  DANGER: 'danger',
  NEUTRAL: 'neutral',
});

/**
 * Builds the request a `<ConfirmDialog>` renders.
 *
 * The `consequence` is the field `window.confirm` had nowhere to put. It is
 * what separates "Delete your review permanently?" from a sentence that also
 * says what is lost and whether it can be undone.
 *
 * @param {object} request
 * @param {string} request.title the question, as a question
 * @param {string} [request.consequence] what happens if it is confirmed
 * @param {string} [request.confirmLabel] names the action, never "OK"
 * @param {string} [request.cancelLabel]
 * @param {string} [request.tone] one of CONFIRM_TONE
 * @param {Function} request.onConfirm
 * @returns {object|null} null when there is nothing to confirm
 */
export function createConfirmRequest({
  title = '',
  consequence = '',
  confirmLabel = '',
  cancelLabel = 'Cancel',
  tone = CONFIRM_TONE.DANGER,
  onConfirm = null,
} = {}) {
  if (!title || typeof onConfirm !== 'function') return null;

  return {
    title,
    consequence,
    // Never "OK". A confirm button that names its action is the difference
    // between reading the sentence and not having to.
    confirmLabel: confirmLabel || 'Confirm',
    cancelLabel: cancelLabel || 'Cancel',
    tone: Object.values(CONFIRM_TONE).includes(tone)
      ? tone
      : CONFIRM_TONE.DANGER,
    onConfirm,
  };
}

/**
 * Where the outcome of an enrolment attempt should be reported.
 *
 * `AllCourses.handleSubmit` reported a failure two different ways for the same
 * failure: a paid course kept the payment form open with the message on it,
 * and a free course — which has no modal to put a message in — raised an
 * `alert`. The alert was the only error path free enrolment had, and it was
 * gone the moment it was dismissed.
 *
 * Both go to the toast now; the paid course additionally keeps its inline copy,
 * because the form is still open and the message belongs beside the fields.
 *
 * @param {object} outcome
 * @param {boolean} outcome.success
 * @param {string} outcome.message
 * @param {boolean} outcome.hasOpenForm whether a payment modal is open
 * @returns {{toast: {message: string, type: string}, inlineError: string}}
 */
export function routeEnrollmentFeedback({
  success = false,
  message = '',
  hasOpenForm = false,
} = {}) {
  const text = String(message || '').trim();

  if (success) {
    return {
      toast: {
        message: text || 'You are enrolled.',
        type: 'success',
      },
      inlineError: '',
    };
  }

  const failure = text || 'The enrolment could not be completed.';

  return {
    toast: { message: failure, type: 'error' },
    // Only where there is a form still on screen to put it beside.
    inlineError: hasOpenForm ? failure : '',
  };
}
