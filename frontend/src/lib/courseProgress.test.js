import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PROGRESS_STATES,
  describeProgress,
  formatCertificateDate,
  progressState,
  readCertificateDate,
  readIsComplete,
  readProgress,
  readSection,
  readSections,
  readPlaybackToken,
  readStreamUrl,
  sectionAddress,
} from './courseProgress.js';

test('reads the summary the server sent', () => {
  assert.deepEqual(
    readProgress({ progress: { completed: 1, total: 4, percent: 25 } }),
    { completed: 1, total: 4, percent: 25 },
  );
});

test('a missing or malformed summary reads as zero, not as complete', () => {
  assert.deepEqual(readProgress(null), { completed: 0, total: 0, percent: 0 });
  assert.deepEqual(readProgress({}), { completed: 0, total: 0, percent: 0 });
  assert.deepEqual(readProgress({ progress: 'x' }), {
    completed: 0,
    total: 0,
    percent: 0,
  });
});

test('completed is capped at the total and percent at 100', () => {
  assert.deepEqual(
    readProgress({ progress: { completed: 9, total: 2, percent: 450 } }),
    { completed: 2, total: 2, percent: 100 },
  );
});

test('a negative or non-numeric count is floored at zero', () => {
  assert.deepEqual(
    readProgress({ progress: { completed: -3, total: 'four', percent: null } }),
    { completed: 0, total: 0, percent: 0 },
  );
});

test('progressState distinguishes empty, started and finished', () => {
  assert.equal(
    progressState({ completed: 0, total: 0 }),
    PROGRESS_STATES.NOT_STARTED,
  );
  assert.equal(
    progressState({ completed: 0, total: 3 }),
    PROGRESS_STATES.NOT_STARTED,
  );
  assert.equal(
    progressState({ completed: 1, total: 3 }),
    PROGRESS_STATES.IN_PROGRESS,
  );
  assert.equal(
    progressState({ completed: 3, total: 3 }),
    PROGRESS_STATES.COMPLETE,
  );
});

test('describeProgress reads as a sentence', () => {
  assert.equal(
    describeProgress({ completed: 1, total: 4 }),
    '1 of 4 sections complete',
  );
  assert.equal(describeProgress({ completed: 0, total: 0 }), 'No sections yet');
});

test('a section without a video is still completable', () => {
  const section = readSection(
    { index: 1, S_title: 'Reading', hasVideo: false, completed: false },
    1,
  );

  assert.equal(section.hasVideo, false);
  assert.equal(section.streamUrl, '');
  assert.equal(section.title, 'Reading');
  // Nothing about hasVideo may gate this.
  assert.equal(section.completed, false);
});

test('a section falls back to its position for a title', () => {
  assert.equal(readSection({}, 2).title, 'Section 3');
  assert.equal(readSection(null, 0).title, 'Section 1');
});

test('readSections tolerates a response with no sections', () => {
  assert.deepEqual(readSections(null), []);
  assert.deepEqual(readSections({ courseContent: 'x' }), []);
  assert.equal(readSections({ courseContent: [{}, {}] }).length, 2);
});

test('a section reads the guarded stream URL the server sent', () => {
  assert.equal(
    readStreamUrl({ streamUrl: '/api/user/coursevideo/abc/0' }),
    '/api/user/coursevideo/abc/0',
  );
  assert.equal(readStreamUrl(null), '');
  assert.equal(readStreamUrl({}), '');
  // The storage path is no longer sent, and must not be resurrected as a URL:
  // /uploads is not served any more (#76).
  assert.equal(readStreamUrl({ path: '/uploads/a.mp4' }), '');
  assert.equal(readStreamUrl({ streamUrl: 42 }), '');
});

test('a section with no video is still a readable section', () => {
  const section = readSection({ S_title: 'Intro', S_content: null }, 0);

  assert.equal(section.streamUrl, '');
  assert.equal(section.hasVideo, false);
  assert.equal(section.title, 'Intro');
});

test('readPlaybackToken takes the token off the payload', () => {
  assert.equal(readPlaybackToken({ playbackToken: 'tok' }), 'tok');
  assert.equal(readPlaybackToken({ playbackToken: '' }), '');
  assert.equal(readPlaybackToken({}), '');
  assert.equal(readPlaybackToken(null), '');
});

test('a section is addressed by its _id when it has one', () => {
  assert.equal(sectionAddress({ index: 2, sectionId: 'abc' }), 'abc');
  assert.equal(sectionAddress({ index: 2, sectionId: null }), 2);
  assert.equal(sectionAddress({ index: 0, sectionId: null }), 0);
});

test('readIsComplete trusts the server flag', () => {
  assert.equal(readIsComplete({ isComplete: true }), true);
  assert.equal(
    readIsComplete({
      isComplete: false,
      progress: { completed: 3, total: 3, percent: 100 },
    }),
    false,
  );
});

test('readIsComplete falls back to the summary, never to a bare length', () => {
  assert.equal(
    readIsComplete({ progress: { completed: 2, total: 2, percent: 100 } }),
    true,
  );
  assert.equal(
    readIsComplete({ progress: { completed: 1, total: 2, percent: 50 } }),
    false,
  );
  // An empty course is not a finished one.
  assert.equal(
    readIsComplete({ progress: { completed: 0, total: 0, percent: 0 } }),
    false,
  );
  assert.equal(readIsComplete({}), false);
});

test('the certificate date is parsed, and absent when unset', () => {
  const date = readCertificateDate({
    certificateDate: '2026-03-04T09:30:00.000Z',
  });

  assert.ok(date instanceof Date);
  assert.equal(date.toISOString(), '2026-03-04T09:30:00.000Z');
  assert.equal(readCertificateDate({ certificateDate: null }), null);
  assert.equal(readCertificateDate({}), null);
  assert.equal(readCertificateDate({ certificateDate: 'not a date' }), null);
});

test('formatCertificateDate returns an empty string for no date', () => {
  assert.equal(formatCertificateDate(null), '');
  assert.ok(formatCertificateDate(new Date('2026-03-04T09:30:00.000Z')).length > 0);
});
