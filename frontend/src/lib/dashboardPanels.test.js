import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PANELS,
  PANEL_LINKS,
  PANEL_QUERY_KEY,
  canSeePanel,
  normalizePanel,
  panelPath,
  readPanelFromSearch,
  resolvePanel,
  visiblePanelLinks,
} from './dashboardPanels.js';

const student = { type: 'student' };
const teacher = { type: 'teacher' };
const admin = { type: 'admin' };

// -- names -------------------------------------------------------------------

test('a canonical name passes through', () => {
  assert.equal(normalizePanel('addcourse'), PANELS.ADD_COURSE);
  assert.equal(normalizePanel('home'), PANELS.HOME);
});

// These three have been in setSelectedComponent calls since the dashboard was
// written. Accepting them means nothing has to be coordinated across a deploy.
test('the old misspelled names are accepted as aliases', () => {
  assert.equal(normalizePanel('cousres'), PANELS.COURSES);
  assert.equal(normalizePanel('enrolledcourese'), PANELS.ENROLLED);
});

test('a name is matched case-insensitively and trimmed', () => {
  assert.equal(normalizePanel('  AddCourse '), PANELS.ADD_COURSE);
});

// The value now arrives from the query string, so it is untrusted.
test('an unrecognised name is rejected rather than passed through', () => {
  assert.equal(normalizePanel('admin-secrets'), '');
  assert.equal(normalizePanel('<script>'), '');
  assert.equal(normalizePanel(''), '');
  assert.equal(normalizePanel(null), '');
  assert.equal(normalizePanel(42), '');
});

// -- permission --------------------------------------------------------------

test('home is everyone\'s panel', () => {
  assert.equal(canSeePanel(PANELS.HOME, student), true);
  assert.equal(canSeePanel(PANELS.HOME, null), true);
});

test('add course is for educators and admins', () => {
  assert.equal(canSeePanel(PANELS.ADD_COURSE, teacher), true);
  assert.equal(canSeePanel(PANELS.ADD_COURSE, admin), true);
  assert.equal(canSeePanel(PANELS.ADD_COURSE, student), false);
});

test('the admin course table is for admins only', () => {
  assert.equal(canSeePanel(PANELS.COURSES, admin), true);
  assert.equal(canSeePanel(PANELS.COURSES, teacher), false);
});

test('enrolled courses is for students', () => {
  assert.equal(canSeePanel(PANELS.ENROLLED, student), true);
  assert.equal(canSeePanel(PANELS.ENROLLED, teacher), false);
});

// The API stores the role lowercase but documents written before #55 may hold
// "Teacher". lib/roles owns that comparison rule; this must go through it.
test('a legacy capitalised role still matches', () => {
  assert.equal(canSeePanel(PANELS.ADD_COURSE, { type: 'Teacher' }), true);
});

test('an unknown panel is nobody\'s', () => {
  assert.equal(canSeePanel('nonsense', admin), false);
});

// -- resolving ---------------------------------------------------------------

test('a permitted panel resolves to itself', () => {
  assert.equal(resolvePanel('addcourse', teacher), PANELS.ADD_COURSE);
});

// This is what the old switch did through its role guards, and it has to keep
// doing it now that the value can be typed into the address bar.
test('a panel the account may not use falls back to home', () => {
  assert.equal(resolvePanel('addcourse', student), PANELS.HOME);
  assert.equal(resolvePanel('courses', teacher), PANELS.HOME);
});

test('an unknown or missing panel falls back to home', () => {
  assert.equal(resolvePanel('nonsense', admin), PANELS.HOME);
  assert.equal(resolvePanel(undefined, admin), PANELS.HOME);
  assert.equal(resolvePanel('', admin), PANELS.HOME);
});

test('a signed-out visitor gets home rather than an error', () => {
  assert.equal(resolvePanel('addcourse', null), PANELS.HOME);
});

// -- the links ---------------------------------------------------------------

test('each role sees only its own links', () => {
  // Account is on every list: #126 gave every signed-in account a screen, and
  // before that there was nowhere to see what is stored or change a password.
  assert.deepEqual(
    visiblePanelLinks(teacher).map((link) => link.panel),
    [PANELS.ADD_COURSE, PANELS.ACCOUNT],
  );
  assert.deepEqual(
    visiblePanelLinks(student).map((link) => link.panel),
    [PANELS.ENROLLED, PANELS.ACCOUNT],
  );
  assert.deepEqual(
    visiblePanelLinks(admin).map((link) => link.panel),
    [PANELS.ADD_COURSE, PANELS.COURSES, PANELS.ACCOUNT],
  );
});

test('every role, and only a real role, may open the account panel', () => {
  for (const user of [student, teacher, admin]) {
    assert.equal(resolvePanel('account', user), PANELS.ACCOUNT);
  }

  // An unreadable role falls back to home rather than being handed a screen
  // that would immediately fail to load.
  assert.equal(resolvePanel('account', { type: 'ghost' }), PANELS.HOME);
  assert.equal(resolvePanel('account', null), PANELS.HOME);
});

test('the older `profile` spelling opens the account panel', () => {
  assert.equal(resolvePanel('profile', student), PANELS.ACCOUNT);
});

test('an account with no usable role sees no panel links', () => {
  assert.deepEqual(visiblePanelLinks(null), []);
  assert.deepEqual(visiblePanelLinks({ type: 'ghost' }), []);
});

// The navbar renders from PANEL_LINKS and the dashboard validates against it,
// so a panel cannot be linked without also being resolvable.
test('every advertised link resolves for the role it is advertised to', () => {
  for (const link of PANEL_LINKS) {
    for (const role of link.roles) {
      assert.equal(resolvePanel(link.panel, { type: role }), link.panel);
    }
  }
});

// -- addresses ---------------------------------------------------------------

test('a panel has an address', () => {
  assert.equal(panelPath(PANELS.ADD_COURSE), '/dashboard?panel=addcourse');
  assert.equal(panelPath(PANELS.ENROLLED), '/dashboard?panel=enrolled');
});

test('home is the bare path, not ?panel=home', () => {
  assert.equal(panelPath(PANELS.HOME), '/dashboard');
  assert.equal(panelPath(''), '/dashboard');
  assert.equal(panelPath(undefined), '/dashboard');
});

test('an alias addresses the canonical panel', () => {
  assert.equal(panelPath('cousres'), '/dashboard?panel=courses');
});

test('an unknown panel addresses the dashboard rather than a broken URL', () => {
  assert.equal(panelPath('nonsense'), '/dashboard');
});

// -- reading the URL back ----------------------------------------------------

test('the panel is read out of a search string', () => {
  assert.equal(readPanelFromSearch('?panel=addcourse'), PANELS.ADD_COURSE);
  assert.equal(readPanelFromSearch('panel=courses'), PANELS.COURSES);
});

test('the panel is read out of URLSearchParams', () => {
  const params = new URLSearchParams({ [PANEL_QUERY_KEY]: 'enrolled' });

  assert.equal(readPanelFromSearch(params), PANELS.ENROLLED);
});

test('no query string means no panel', () => {
  assert.equal(readPanelFromSearch(''), '');
  assert.equal(readPanelFromSearch(undefined), '');
  assert.equal(readPanelFromSearch('?other=1'), '');
});

test('a hand-typed junk panel reads as none rather than as itself', () => {
  assert.equal(readPanelFromSearch('?panel=../../etc/passwd'), '');
});

// A path built by panelPath has to be readable by readPanelFromSearch.
test('an address round-trips back to the panel it names', () => {
  for (const panel of Object.values(PANELS)) {
    const path = panelPath(panel);
    const search = path.includes('?') ? path.slice(path.indexOf('?')) : '';

    assert.equal(readPanelFromSearch(search) || PANELS.HOME, panel);
  }
});
