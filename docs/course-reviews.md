# Course ratings and reviews

## API

Public:

```http
GET /api/reviews/:courseId
GET /api/reviews/:courseId/summary
```

Authenticated:

```http
GET    /api/reviews/:courseId/mine
POST   /api/reviews/:courseId
PUT    /api/reviews/review/:reviewId
DELETE /api/reviews/review/:reviewId
```

Authenticated requests require:

```http
Authorization: Bearer <token>
```

## Rules

- Only enrolled users can create reviews.
- One review is allowed per user/course combination.
- Rating must be an integer from 1 through 5.
- Review text is optional and limited to 1000 characters.
- A user may update or delete only their own review.
- Public responses expose only reviewer names, not emails or credentials.
- A compound unique MongoDB index enforces one review per course per student.

## Frontend integration

In `CourseContent.jsx`:

```jsx
import CourseReviews from "../../reviews/CourseReviews";
```

Render near the bottom of the page:

```jsx
<CourseReviews courseId={courseId} courseTitle={courseTitle} />
```

In `AllCourses.jsx`:

```jsx
import CourseRatingBadge from "../reviews/CourseRatingBadge";
```

Render within each course card:

```jsx
<CourseRatingBadge courseId={course._id} compact />
```

Adjust the relative import if your UI-redesign branch has moved either component.

## Manual testing

1. Seed the database.
2. Sign in as a student who is not enrolled.
3. Confirm the review form is not available.
4. Enroll in a course.
5. Submit a 1–5 star review.
6. Confirm a second review returns `409`.
7. Edit the existing review.
8. Delete the review.
9. Test all four sort modes.
10. Create at least six reviews and test pagination.
11. Verify the course card average and review count.
12. Verify no email, password, or token appears in public review responses.
