// Which panel /dashboard is showing.
//
// The dashboard used to hold that in local state and hand the setter to the
// navbar as a prop:
//
//   const NavBar = ({ setSelectedComponent }) => {
//      const handleOptionClick = (component) => setSelectedComponent(component);
//      ...
//      <NavLink className="premium-btn" onClick={() => handleOptionClick('addcourse')}>Add Course</NavLink>
//
// Only Dashboard.jsx passed it. CourseContent.jsx renders `<NavBar />` bare, so
// on the course player — the page a student spends the whole course on — those
// three links threw `TypeError: setSelectedComponent is not a function` on
// click. The handler runs before React Router's own click handling, so nothing
// navigated either and the link was simply dead (#105).
//
// The same block had two smaller problems. The `<NavLink>` elements carried no
// `to`, so React Router resolved them against the current location and rendered
// links pointing at the page you were already on — unusable by middle click,
// by "open in new tab", or by anything that does not go through the broken
// onClick. And `Home` was a raw `<a href="/dashboard">`, which inside a
// BrowserRouter is a full document load that tears down AuthProvider,
// BookmarksProvider and ThemeProvider and re-fetches everything.
//
// Making the panel a URL concern fixes all of it at once: the navbar navigates
// instead of calling a prop, the links become real anchors, the prop disappears,
// and each panel gets an address a reload can restore.

// Extension included: Vite resolves either form, but `node --test` runs this
// module as plain ESM and will not guess one.
import { ROLES, hasAnyRole } from './roles.js';

export const PANELS = Object.freeze({
  HOME: 'home',
  ADD_COURSE: 'addcourse',
  COURSES: 'courses',
  ENROLLED: 'enrolled',
  // #126. Everyone's, because every account has one and none of them had a
  // screen: no way to see what is stored, no way to correct a name typed wrong
  // at registration, and no way to change a password without signing out.
  ACCOUNT: 'account',
});

export const PANEL_QUERY_KEY = 'panel';

// The names the old switch used. Three of the four were misspelled, and they
// have been in `setSelectedComponent` calls since the dashboard was written, so
// they are accepted as aliases rather than broken. Nothing has to be
// coordinated across a deploy.
const PANEL_ALIASES = Object.freeze({
  home: PANELS.HOME,
  addcourse: PANELS.ADD_COURSE,
  courses: PANELS.COURSES,
  cousres: PANELS.COURSES,
  enrolled: PANELS.ENROLLED,
  enrolledcourese: PANELS.ENROLLED,
  enrolledcourses: PANELS.ENROLLED,
  account: PANELS.ACCOUNT,
  profile: PANELS.ACCOUNT,
});

/**
 * The panels the navbar offers, and who may see each one.
 *
 * Held as data so the navbar renders from the same source the dashboard
 * validates against. The two used to be separate lists of string literals that
 * had to agree by hand.
 */
export const PANEL_LINKS = Object.freeze([
  Object.freeze({
    panel: PANELS.ADD_COURSE,
    label: 'Add Course',
    roles: Object.freeze([ROLES.TEACHER, ROLES.ADMIN]),
  }),
  Object.freeze({
    panel: PANELS.COURSES,
    label: 'Courses',
    roles: Object.freeze([ROLES.ADMIN]),
  }),
  Object.freeze({
    panel: PANELS.ENROLLED,
    label: 'Enrolled Courses',
    roles: Object.freeze([ROLES.STUDENT]),
  }),
  // Listed for every role rather than left unrestricted, so `canSeePanel`
  // keeps its one rule — a panel is visible to the roles it names — and an
  // account whose role is unreadable is still offered nothing.
  Object.freeze({
    panel: PANELS.ACCOUNT,
    label: 'Account',
    roles: Object.freeze([ROLES.STUDENT, ROLES.TEACHER, ROLES.ADMIN]),
  }),
]);

const PANEL_ROLES = new Map(
  PANEL_LINKS.map((link) => [link.panel, link.roles]),
);

/**
 * Reduces anything that might name a panel to a canonical name.
 *
 * The value can arrive from the query string, so it is untrusted: anything
 * unrecognised comes back as '' rather than being passed through.
 *
 * @param {unknown} value
 * @returns {string} a canonical panel name, or ''
 */
export function normalizePanel(value) {
  if (typeof value !== 'string') return '';

  return PANEL_ALIASES[value.trim().toLowerCase()] || '';
}

/**
 * Whether an account may see a panel.
 *
 * `home` is everyone's. A panel with no role list is unrestricted; a panel with
 * one is checked through `lib/roles`, which is where the "Teacher" vs "teacher"
 * comparison rule already lives (#84).
 *
 * @param {string} panel a canonical panel name
 * @param {object|null|undefined} user
 * @returns {boolean}
 */
export function canSeePanel(panel, user) {
  if (panel === PANELS.HOME) return true;

  const roles = PANEL_ROLES.get(panel);

  if (!roles) return false;

  return hasAnyRole(user, roles);
}

/**
 * The panel to render for a request.
 *
 * An unknown name and a name the account may not use both fall back to `home`,
 * which is what the old switch did through its `default:` and its two role
 * guards. Falling back rather than erroring matters because the value now comes
 * from the URL and can be typed by hand.
 *
 * @param {unknown} value
 * @param {object|null|undefined} user
 * @returns {string} a canonical panel name, never ''
 */
export function resolvePanel(value, user) {
  const panel = normalizePanel(value);

  if (!panel || !canSeePanel(panel, user)) return PANELS.HOME;

  return panel;
}

/**
 * The panels this account should actually see links for.
 *
 * @param {object|null|undefined} user
 * @returns {Array<{ panel: string, label: string }>}
 */
export function visiblePanelLinks(user) {
  return PANEL_LINKS.filter((link) => canSeePanel(link.panel, user)).map(
    ({ panel, label }) => ({ panel, label }),
  );
}

/**
 * The address of a panel.
 *
 * `home` is the bare path rather than `?panel=home`, so the dashboard has one
 * canonical URL instead of two that render the same thing.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function panelPath(value) {
  const panel = normalizePanel(value);

  if (!panel || panel === PANELS.HOME) return '/dashboard';

  return `/dashboard?${PANEL_QUERY_KEY}=${encodeURIComponent(panel)}`;
}

/**
 * Reads the panel out of a location's query string.
 *
 * Accepts a `URLSearchParams`, a raw search string with or without its leading
 * `?`, or nothing at all.
 *
 * @param {URLSearchParams|string|null|undefined} search
 * @returns {string} a canonical panel name, or ''
 */
export function readPanelFromSearch(search) {
  if (!search) return '';

  const params =
    typeof search === 'string' ? new URLSearchParams(search) : search;

  if (typeof params?.get !== 'function') return '';

  return normalizePanel(params.get(PANEL_QUERY_KEY));
}
