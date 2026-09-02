import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_SECTION_TITLE_LENGTH,
  MAX_TITLE_LENGTH,
  hasChanges,
  readEditError,
  toEditForm,
  toUpdatePayload,
  validateEditForm,
} from './courseEdit.js';

// #127. There was no edit form because there was no endpoint. Correcting a typo
// in a title meant deleting the course, which removes every section video from
// disk and then every enrolment, payment, review and bookmark that pointed at
// it (#74).
//
// These are the browser's half of the rules; `backend/utils/courseEdit.js`
// enforces the same ones. Nothing can import across the wire, so the same
// table is asserted on both sides — the pattern #114 established.

const loaded = () => ({
  _id: '64b000000000000000000001',
  C_title: 'Introduciton to CSS',
  C_categories: 'Design',
  C_price: '499',
  C_description: 'A course about CSS.',
  C_educator: 'An Educator',
  sections: [
    { index: 0, S_title: 'Selectors', S_description: 'How selectors work.', hasVideo: true },
    { index: 1, S_title: 'The cascade', S_description: 'Specificity.', hasVideo: true },
  ],
});

// -- filling the form --------------------------------------------------------

test('the form is filled from the edit response', () => {
  const form = toEditForm(loaded());

  assert.equal(form.C_title, 'Introduciton to CSS');
  assert.equal(form.C_price, '499');
  assert.equal(form.sections.length, 2);
  assert.equal(form.sections[0].S_title, 'Selectors');
  assert.equal(form.sections[0].hasVideo, true);
});

test('a missing or unusable course still produces a usable form', () => {
  for (const value of [null, undefined, 'nope', 42, []]) {
    const form = toEditForm(value);

    assert.equal(form.C_title, '');
    assert.deepEqual(form.sections, []);
  }
});

test('a course whose sections are not an array does not throw', () => {
  // The schema declares `sections: {}`, so the collection holds whatever was
  // written; one such document blanked the whole educator dashboard in #94.
  assert.deepEqual(toEditForm({ sections: { 0: {} } }).sections, []);
});

// -- validating it -----------------------------------------------------------

test('a filled form is valid', () => {
  assert.equal(validateEditForm(toEditForm(loaded())).valid, true);
});

test('the three required fields cannot be blanked', () => {
  for (const field of ['C_title', 'C_categories', 'C_description']) {
    const form = { ...toEditForm(loaded()), [field]: '   ' };
    const result = validateEditForm(form);

    assert.equal(result.valid, false, field);
    assert.ok(result.errors[field], field);
  }
});

test('a blank price is a value, not a mistake', () => {
  // #114 settled that a blank price means free, so the form must not demand one.
  const form = { ...toEditForm(loaded()), C_price: '' };

  assert.equal(validateEditForm(form).valid, true);
});

test('the length limits match the ones the server enforces', () => {
  assert.equal(MAX_TITLE_LENGTH, 120);
  assert.equal(MAX_SECTION_TITLE_LENGTH, 150);

  const form = { ...toEditForm(loaded()), C_title: 'x'.repeat(MAX_TITLE_LENGTH + 1) };
  assert.equal(validateEditForm(form).valid, false);

  const atLimit = { ...toEditForm(loaded()), C_title: 'x'.repeat(MAX_TITLE_LENGTH) };
  assert.equal(validateEditForm(atLimit).valid, true);
});

test('a section title cannot be blanked, and the error names the section', () => {
  const form = toEditForm(loaded());
  form.sections[1] = { ...form.sections[1], S_title: '' };

  const result = validateEditForm(form);

  assert.equal(result.valid, false);
  assert.match(result.errors['sections.1.S_title'], /Section 2/);
});

// -- what gets sent ----------------------------------------------------------

test('the payload carries the editable fields and section text only', () => {
  const payload = toUpdatePayload(toEditForm(loaded()));

  assert.deepEqual(Object.keys(payload).sort(), [
    'C_categories',
    'C_description',
    'C_price',
    'C_title',
    'sections',
  ]);

  // No `hasVideo`, no `index`, and nothing resembling a stored file path.
  assert.deepEqual(Object.keys(payload.sections[0]).sort(), [
    'S_description',
    'S_title',
  ]);
});

test('the payload is trimmed', () => {
  const payload = toUpdatePayload({
    C_title: '  Introduction to CSS  ',
    C_categories: ' Design ',
    C_price: ' 499 ',
    C_description: ' A course. ',
    sections: [{ S_title: '  Selectors  ', S_description: ' Text. ' }],
  });

  assert.equal(payload.C_title, 'Introduction to CSS');
  assert.equal(payload.sections[0].S_title, 'Selectors');
});

// -- keeping Save honest -----------------------------------------------------

test('an untouched form reports no changes', () => {
  // The server answers a body with nothing editable in it "No editable fields
  // were supplied", which is a sentence nobody should have to read.
  const form = toEditForm(loaded());

  assert.equal(hasChanges(form, form), false);
  assert.equal(hasChanges(toEditForm(loaded()), toEditForm(loaded())), false);
});

test('an edited field reports a change', () => {
  const original = toEditForm(loaded());
  const edited = { ...original, C_title: 'Introduction to CSS' };

  assert.equal(hasChanges(edited, original), true);
});

test('an edited section reports a change', () => {
  const original = toEditForm(loaded());
  const sections = [...original.sections];
  sections[0] = { ...sections[0], S_description: 'Rewritten.' };

  assert.equal(hasChanges({ ...original, sections }, original), true);
});

test('whitespace alone is not a change', () => {
  const original = toEditForm(loaded());
  const padded = { ...original, C_title: `  ${original.C_title}  ` };

  assert.equal(hasChanges(padded, original), false);
});

// -- reporting a failure -----------------------------------------------------

test('the server sentence and its per-field markers are both read', () => {
  const { message, errors } = readEditError({
    response: {
      status: 400,
      data: {
        message: 'Course title is required',
        errors: { C_title: 'Course title is required' },
      },
    },
  });

  assert.equal(message, 'Course title is required');
  assert.ok(errors.C_title);
});

test('the section-count refusal comes through as a whole sentence', () => {
  const { errors } = readEditError({
    response: {
      status: 400,
      data: {
        message: 'This course has 2 sections. Adding or removing one is not possible here.',
        errors: { sections: 'This course has 2 sections. Adding or removing one is not possible here.' },
      },
    },
  });

  assert.match(errors.sections, /2 sections/);
});

test('a request that never reached the server says so', () => {
  const { message } = readEditError(new Error('Network Error'));

  assert.match(message, /could not be reached/i);
});

test('a response with no message falls back rather than showing nothing', () => {
  const { message, errors } = readEditError({ response: { status: 500, data: {} } });

  assert.match(message, /could not be updated/i);
  assert.deepEqual(errors, {});
});
