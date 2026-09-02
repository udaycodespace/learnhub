import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ALLOWED_VIDEO_EXTENSION,
  DEFAULT_MAX_SECTION_VIDEOS,
  DEFAULT_MAX_VIDEO_SIZE_MB,
  VIDEO_ACCEPT_ATTRIBUTE,
  buildCourseFormData,
  describeFileProblem,
  describeUploadRules,
  fileExtension,
  formatFileSize,
  isAllowedVideoFile,
  isAllowedVideoType,
  uploadLimits,
  validateCourseUpload,
  validateSection,
} from './courseUpload.js';

const MB = 1024 * 1024;

const videoFile = (overrides = {}) => ({
  name: 'lecture-01.mp4',
  type: 'video/mp4',
  size: 12 * MB,
  ...overrides,
});

const section = (overrides = {}) => ({
  S_title: 'Getting started',
  S_description: 'What this section covers',
  S_content: videoFile(),
  ...overrides,
});

// validateCourseUpload checks the course-level fields too since #135, so the
// section tests below supply a valid price and category and go on testing
// sections. The detail rules have their own file, lib/courseDetails.test.js.
const course = (overrides = {}) => ({
  C_title: 'Intro to Testing',
  C_categories: 'IT & Software',
  C_price: '499',
  C_description: 'A short course.',
  ...overrides,
});

// -- the rules mirror the server's -------------------------------------------

// backend/utils/videoUpload.js: extension === ".mp4" && ALLOWED_MP4_MIME_TYPES
// .has(mimeType). Both halves, or the two answers can disagree.
test('an mp4 with an mp4 type is accepted', () => {
  assert.equal(isAllowedVideoFile(videoFile()), true);
  assert.equal(
    isAllowedVideoFile(videoFile({ type: 'application/mp4' })),
    true,
  );
});

test('the formats the old picker offered are rejected', () => {
  for (const [name, type] of [
    ['lecture.mov', 'video/quicktime'],
    ['lecture.webm', 'video/webm'],
    ['lecture.mkv', 'video/x-matroska'],
    ['lecture.avi', 'video/x-msvideo'],
    ['slide.png', 'image/png'],
    ['slide.jpg', 'image/jpeg'],
  ]) {
    assert.equal(
      isAllowedVideoFile(videoFile({ name, type })),
      false,
      `${name} should be rejected`,
    );
  }
});

// A browser leaves the type blank for an extension it does not recognise, and
// the API rejects a blank mimetype outright.
test('an empty type is unknown, not a pass', () => {
  assert.equal(isAllowedVideoType(''), false);
  assert.equal(isAllowedVideoType(undefined), false);
  assert.equal(isAllowedVideoFile(videoFile({ type: '' })), false);
});

test('an mp4 extension with someone else\'s type is rejected', () => {
  assert.equal(
    isAllowedVideoFile(videoFile({ name: 'x.mp4', type: 'image/png' })),
    false,
  );
});

test('an mp4 type on a file that is not an mp4 is rejected', () => {
  assert.equal(
    isAllowedVideoFile(videoFile({ name: 'x.png', type: 'video/mp4' })),
    false,
  );
});

test('the extension check is case-insensitive and handles dotted names', () => {
  assert.equal(fileExtension('LECTURE.MP4'), ALLOWED_VIDEO_EXTENSION);
  assert.equal(fileExtension('part.1.final.mp4'), '.mp4');
  assert.equal(fileExtension('noextension'), '');
  assert.equal(fileExtension('.hidden'), '');
  assert.equal(fileExtension('trailing.'), '');
  assert.equal(fileExtension(undefined), '');
});

test('the picker offers what the API accepts, and nothing else', () => {
  assert.equal(VIDEO_ACCEPT_ATTRIBUTE.includes('.mp4'), true);
  assert.equal(VIDEO_ACCEPT_ATTRIBUTE.includes('image'), false);
  assert.equal(VIDEO_ACCEPT_ATTRIBUTE.includes('video/*'), false);
});

// -- limits ------------------------------------------------------------------

test('the defaults are the server\'s defaults', () => {
  const limits = uploadLimits();

  assert.equal(limits.maxVideoSizeMb, DEFAULT_MAX_VIDEO_SIZE_MB);
  assert.equal(limits.maxSectionVideos, DEFAULT_MAX_SECTION_VIDEOS);
  assert.equal(limits.maxVideoBytes, DEFAULT_MAX_VIDEO_SIZE_MB * MB);
});

test('a deployment that lowers the limits is honoured', () => {
  const limits = uploadLimits({ maxVideoSizeMb: 50, maxSectionVideos: 5 });

  assert.equal(limits.maxVideoSizeMb, 50);
  assert.equal(limits.maxVideoBytes, 50 * MB);
  assert.equal(limits.maxSectionVideos, 5);
});

test('nonsense overrides fall back rather than producing NaN', () => {
  const limits = uploadLimits({ maxVideoSizeMb: -1, maxSectionVideos: 'ten' });

  assert.equal(limits.maxVideoSizeMb, DEFAULT_MAX_VIDEO_SIZE_MB);
  assert.equal(limits.maxSectionVideos, DEFAULT_MAX_SECTION_VIDEOS);
});

// -- messages ----------------------------------------------------------------

test('a good file has no problem', () => {
  assert.equal(describeFileProblem(videoFile()), null);
});

// The old failure said only that some file, somewhere, was wrong.
test('the wrong format is named, and so is the file', () => {
  const message = describeFileProblem(
    videoFile({ name: 'lecture.mov', type: 'video/quicktime' }),
  );

  assert.match(message, /lecture\.mov/);
  assert.match(message, /\.mp4/);
});

test('an oversized file is refused before it is uploaded, with both numbers', () => {
  const message = describeFileProblem(videoFile({ size: 300 * MB }));

  assert.match(message, /300 MB/);
  assert.match(message, /250 MB/);
});

test('a file exactly at the limit is allowed', () => {
  assert.equal(
    describeFileProblem(videoFile({ size: DEFAULT_MAX_VIDEO_SIZE_MB * MB })),
    null,
  );
});

test('a lowered limit refuses a file the default would allow', () => {
  const limits = uploadLimits({ maxVideoSizeMb: 10 });

  assert.equal(describeFileProblem(videoFile({ size: 12 * MB }), limits) !== null, true);
  assert.equal(describeFileProblem(videoFile({ size: 12 * MB })), null);
});

test('an empty file is refused', () => {
  assert.match(describeFileProblem(videoFile({ size: 0 })), /empty/);
});

test('no file at all asks for one', () => {
  assert.match(describeFileProblem(undefined), /Choose an \.mp4/);
  assert.match(describeFileProblem(null), /Choose an \.mp4/);
});

test('sizes are rendered for a person', () => {
  assert.equal(formatFileSize(512), '512 B');
  assert.equal(formatFileSize(2048), '2.0 KB');
  assert.equal(formatFileSize(12 * MB), '12 MB');
  assert.equal(formatFileSize(2.5 * 1024 * MB), '2.5 GB');
  assert.equal(formatFileSize(undefined), 'unknown size');
});

test('the rules are stated before a file is picked', () => {
  const text = describeUploadRules();

  assert.match(text, /\.mp4/);
  assert.match(text, /250 MB/);
  assert.match(text, /20 sections/);
});

// -- section validation ------------------------------------------------------

test('a complete section is valid', () => {
  assert.deepEqual(validateSection(section()), {});
});

test('a section missing its text says which field', () => {
  const errors = validateSection(
    section({ S_title: '  ', S_description: '' }),
  );

  assert.ok(errors.S_title);
  assert.ok(errors.S_description);
  assert.equal(errors.S_content, undefined);
});

test('a section with a bad file reports it against the file field', () => {
  const errors = validateSection(
    section({ S_content: videoFile({ name: 'a.png', type: 'image/png' }) }),
  );

  assert.ok(errors.S_content);
  assert.equal(errors.S_title, undefined);
});

// -- the whole submission ----------------------------------------------------

test('a valid course passes', () => {
  const result = validateCourseUpload(
    course({ sections: [section(), section()] }),
  );

  assert.equal(result.valid, true);
  assert.equal(result.formError, '');
  assert.deepEqual(result.sectionErrors, {});
});

test('a course with no sections is refused', () => {
  const result = validateCourseUpload(course({ sections: [] }));

  assert.equal(result.valid, false);
  assert.match(result.formError, /at least one section/);
});

// The 21st section used to be rejected only after all 21 uploads finished.
test('too many sections is caught before anything is uploaded', () => {
  const sections = Array.from(
    { length: DEFAULT_MAX_SECTION_VIDEOS + 3 },
    () => section(),
  );

  const result = validateCourseUpload(course({ sections }));

  assert.equal(result.valid, false);
  assert.match(result.formError, /at most 20 sections/);
  assert.match(result.formError, /Remove 3/);
});

// The point of the whole change: say which section.
test('one bad section is named by number', () => {
  const result = validateCourseUpload(
    course({
      sections: [
        section(),
        section({ S_content: videoFile({ name: 'b.mov', type: 'video/quicktime' }) }),
        section(),
      ],
    }),
  );

  assert.equal(result.valid, false);
  assert.match(result.formError, /Section 2/);
  assert.ok(result.sectionErrors[1].S_content);
  assert.equal(result.sectionErrors[0], undefined);
  assert.equal(result.sectionErrors[2], undefined);
});

test('several bad sections are all named, not just the first', () => {
  const result = validateCourseUpload(
    course({
      sections: [
        section({ S_title: '' }),
        section(),
        section({ S_content: undefined }),
      ],
    }),
  );

  assert.match(result.formError, /Sections 1, 3/);
  assert.equal(Object.keys(result.sectionErrors).length, 2);
});

test('a missing sections array is refused rather than throwing', () => {
  assert.equal(validateCourseUpload(course()).valid, false);
  assert.equal(validateCourseUpload({}).valid, false);
  assert.equal(validateCourseUpload().valid, false);
});

// -- the multipart body ------------------------------------------------------

// The server pairs each file with the S_title and S_description at the same
// position — position is the only thing tying them together.
test('the three repeated fields stay aligned per section', () => {
  const body = buildCourseFormData(
    {
      C_title: 'Node in practice',
      C_price: '499',
      sections: [
        section({ S_title: 'One', S_description: 'First' }),
        section({ S_title: 'Two', S_description: 'Second' }),
      ],
    },
    { FormDataImpl: FormData },
  );

  assert.deepEqual(body.getAll('S_title'), ['One', 'Two']);
  assert.deepEqual(body.getAll('S_description'), ['First', 'Second']);
  assert.equal(body.getAll('S_content').length, 2);
});

test('the course fields are sent and the sections array is not', () => {
  const body = buildCourseFormData(
    { C_title: 'Node', C_price: '499', sections: [section()] },
    { FormDataImpl: FormData },
  );

  assert.equal(body.get('C_title'), 'Node');
  assert.equal(body.get('C_price'), '499');
  assert.equal(body.get('sections'), null);
});

test('an empty course field is sent as an empty string, not "undefined"', () => {
  const body = buildCourseFormData(
    { C_price: undefined, sections: [] },
    { FormDataImpl: FormData },
  );

  assert.equal(body.get('C_price'), '');
});
