// Progress arithmetic for an enrolment, in one place.
//
// `enrolledCourseModel.progress` is an append-only array of `{ sectionId }`.
// Two things make a naive `progress.length` the wrong number:
//
//   * rows written before #39 had no uniqueness guard, so the same sectionId
//     can appear more than once and the count overstates completion;
//   * a section can be removed from a course after a student completed it, so
//     the array can hold ids the course no longer has and the count overstates
//     completion again — enough to unlock a certificate early.
//
// enrolledCoursesController has counted this correctly since #65. The course
// player did its own `completedModule.length === courseContent.length` and got
// both cases wrong, so the two disagreed about the same enrolment. The rule
// lives here now and both read it.

const { countSections, normalizeSections } = require("./courseSections");

/**
 * The set of distinct completed section ids, as strings.
 *
 * Ids are compared as strings deliberately: `normalizeSectionId` stores an
 * index as a Number and a section `_id` as a String, and an enrolment can hold
 * both if a course changed shape underneath it.
 *
 * @param {unknown} progress the raw `progress` array from an enrolment
 * @returns {Set<string>}
 */
function completedSectionIds(progress) {
  const completed = new Set();

  if (!Array.isArray(progress)) return completed;

  for (const entry of progress) {
    if (!entry || entry.sectionId === undefined || entry.sectionId === null) {
      continue;
    }

    completed.add(String(entry.sectionId));
  }

  return completed;
}

/**
 * Number of distinct completed sections.
 *
 * @param {unknown} progress the raw `progress` array from an enrolment
 * @returns {number}
 */
function countCompletedSections(progress) {
  return completedSectionIds(progress).size;
}

/**
 * The progress summary the clients render.
 *
 * `completed` is capped at `total` so a stale duplicate cannot report 120%,
 * and `total` comes from the enrolment rather than the course so a course that
 * gained a section shows a lower percentage rather than a stale 100%.
 *
 * @param {object} enrollment an enrolment document or lean object
 * @returns {{ completed: number, total: number, percent: number }}
 */
function buildProgressSummary(enrollment = {}) {
  const total = Number.isFinite(enrollment.course_Length)
    ? Math.max(0, enrollment.course_Length)
    : 0;
  const completed = Math.min(countCompletedSections(enrollment.progress), total);
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100);

  return { completed, total, percent };
}

/**
 * True when every section of the enrolment has been completed.
 *
 * A `total` of zero is not complete. An enrolment in a course that had no
 * sections would otherwise read as finished the moment it was created, which
 * is the case `courseInput` rejects at creation time and this guards at read
 * time for the documents that predate it.
 *
 * @param {object} enrollment
 * @returns {boolean}
 */
function isEnrollmentComplete(enrollment = {}) {
  const { completed, total } = buildProgressSummary(enrollment);

  return total > 0 && completed >= total;
}

/**
 * Describes each section of a course for the player: its position, its stable
 * id when it has one, whether it carries a video, and whether this enrolment
 * has completed it.
 *
 * The `completed` flag is resolved against both addressing schemes, because
 * `progressController.normalizeSectionId` accepts an index or a section `_id`
 * and older rows were written with whichever the client sent.
 *
 * @param {unknown} sections raw `course.sections`
 * @param {unknown} progress raw `enrollment.progress`
 * @returns {Array<object>}
 */
function describeSections(sections, progress) {
  const completed = completedSectionIds(progress);

  return normalizeSections(sections).map((section, index) => {
    const source = section && typeof section === "object" ? section : {};
    const sectionId = source._id || source.id || null;
    const content = source.S_content;

    return {
      index,
      sectionId: sectionId ? String(sectionId) : null,
      S_title: source.S_title || `Section ${index + 1}`,
      S_description: source.S_description || "",
      // The player needs to know a video exists to decide whether to render a
      // player, and it must not use that to decide whether the section can be
      // completed — which is the bug in #93.
      hasVideo: Boolean(content && (content.path || content.filename)),
      S_content: content || null,
      completed:
        completed.has(String(index)) ||
        (sectionId ? completed.has(String(sectionId)) : false),
    };
  });
}

module.exports = {
  buildProgressSummary,
  completedSectionIds,
  countCompletedSections,
  countSections,
  describeSections,
  isEnrollmentComplete,
};
