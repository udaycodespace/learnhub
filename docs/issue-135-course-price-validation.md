# What a course may be priced and filed under (#135)

## The defect

`POST /api/user/addcourse` validated the title, the category, the description
and the section videos. It did not validate the price at all, and it accepted
the category dropdown's placeholder as a real category.

### The price

`validateCourseSubmission` handed `C_price` straight to the normaliser:

```js
C_price: normalizeCoursePrice(asTrimmedString(body.C_price)),
```

and `normalizeCoursePrice` only ever asked whether the value read as free:

```js
function normalizeCoursePrice(value, { maxLength = MAX_PRICE_LENGTH } = {}) {
  if (isFreePrice(value)) return FREE_PRICE_LABEL;

  return String(value).trim().slice(0, maxLength);
}
```

Anything not free was stored verbatim. `C_price` is a bare `String` on
`courseModel` with no `required`, no `match` and no validator, so nothing
downstream caught it either:

```
submitted                      stored                        card shows                   classified
"abc"                          "abc"                         "abc"                        paid
"-500"                         "-500"                        "-500"                       paid
"1e9"                          "1e9"                         "1e9"                        paid
"99.99.99"                     "99.99.99"                    "99.99.99"                   paid
"<script>alert(1)</script>"    "<script>…"                   "<script>…"                  paid
```

This is not the free/paid confusion #114 fixed. That unified *which* rule
decides free versus paid, and the rule is consistent now — it simply has no
opinion about whether a paid price is a number.

The consequence runs the length of the app. The catalogue card renders the
string through `formatPriceLabel`. The Enroll button classifies it paid and
opens the payment modal. On enrolment `enrollCourseController` writes

```js
amount: requiresPayment ? String(course.C_price) : "free",
```

so the payments collection accumulates rows whose `amount` is `"abc"`, and the
admin Payment Records screen — the one place the platform's takings are
totalled — reports them as given. A negative price is the interesting one: it
reads as paid, demands card details, and records a negative amount against the
learner.

### The category

The dropdown offered its own placeholder as a selectable option with **no
`value`**, so its value was its label:

```jsx
<Form.Select value={addCourse.C_categories} onChange={handleCourseTypeChange}>
   <option>Select categories</option>
   <option>IT &amp; Software</option>
```

`validateCourseSubmission` required only a non-empty string, which
`"Select categories"` is. A teacher who filled in everything else and never
opened the dropdown published a course filed under the literal category
**"Select categories"**, and `buildCourseFilter` would then happily filter the
catalogue to it.

## The fix

### `parseCoursePrice`

`backend/utils/coursePricing.js` gains the question that was never asked.
`normalizeCoursePrice` answers "what do we store"; this answers "may we store
it at all".

```js
const PRICE_PATTERN = /^\d+(?:\.\d{1,2})?$/;
```

Digits, optionally a decimal point and one or two places. No sign — a negative
price is not a discount, it is a course that pays the student — and no
exponent, because `1e9` is a number JavaScript understands and not a price
anybody typed.

Thousands separators and a leading currency symbol are stripped before the
pattern is applied, because that is how people write prices and refusing them
would be pedantry. They are not part of what is stored, so `"Rs. 1,299"` and
`"1299"` produce the same string and the price column can be compared.

A free price is valid, has an amount of 0, and normalises to the free label —
`parseCoursePrice` defers to `isFreePrice` and does not second-guess it. The
one seam worth naming: `"0.000"` matches the free pattern's `0+(\.0+)?` branch
but not the two-decimal-place limit above, so it is explicitly claimed as free
rather than falling between the two rules and being refused.

There is a ceiling, `MAX_COURSE_PRICE`. Not a business rule so much as a bound:
without one, `"999999999999"` is a valid price and the dashboard totals it.

### The category

`backend/utils/courseCategories.js` refuses the placeholder, and **not** any
category outside the three the dropdown offers.

That restraint is deliberate and it is the main design decision here.
`C_categories` is free-form throughout the codebase — the fixtures alone use
`"Web"`, `"Programming"`, `"Engineering"`, `"Backend Development"` — and an
allow-list of three would reject courses that are correctly categorised today
and break eight existing tests. The defect is that a *placeholder* is accepted
as an answer, so that is what is refused. Narrowing the vocabulary is a
data-migration question and separate work.

The placeholder list is matched case- and whitespace-insensitively and holds
both the old label and the new one, so a course created against the old build
cannot keep it either.

Categories are also whitespace-collapsed. That is not a validation decision —
the catalogue's category filter is an exact match, so `"IT  &  Software"`
stored with a double space is a course nobody can filter to.

### The browser

`frontend/src/lib/coursePricing.js` and `courseCategories.js` mirror both
rules, for the same reason `courseUpload.js` already mirrors the file rules
(#106): Add Course builds one `FormData` for the whole course, so a price the
server is going to refuse must be caught before several hundred megabytes of
video go up. The server check stays authoritative and is unchanged by anything
on this side.

`validateCourseUpload` runs the detail check **first**, before the sections,
because the upload is what costs minutes.

In the form, the placeholder option now carries `value=""` so it cannot be
submitted at all and `required` catches it, the option list is generated from
the shared constant rather than written inline, and price and category errors
are marked on the fields themselves through `isInvalid` and
`Form.Control.Feedback`. The API's own per-field errors are read out of the
rejection and marked the same way, so a server-side refusal points at the field
rather than only printing a sentence.

## What is covered

`backend/tests/course-details-validation.test.js` — 20 tests. The first is the
list of prices that were accepted verbatim before this change, all now refused.
Then: ordinary prices stored as typed; separators and symbols stripped; every
free form still free; `"0.000"` not falling between the rules; the ceiling; the
length cap; an accepted price still reading as paid and rendering as a label;
the placeholder refused in four spellings; a real category — including one
outside the dropdown — accepted; both bad fields reported together rather than
one at a time; and the repeated-multipart-field guard, where `"abc"` hiding
behind a valid first value must not reach the database.

`frontend/src/lib/courseDetails.test.js` — 15 tests, asserting the same tables
character-for-character. If the two sides drift, one of the two files fails.

`frontend/src/lib/courseUpload.test.js` gains a `course()` fixture so the
existing section tests keep testing sections.

## Not addressed here

The price is still a `String` on `courseModel`, and existing documents still
hold whatever they hold — this validates the way in, it does not migrate what
is already stored. The catalogue and the payments dashboard therefore still
have to render a price they did not validate, which they already do safely.
Making `C_price` a `Number` is a schema migration and separate work.
