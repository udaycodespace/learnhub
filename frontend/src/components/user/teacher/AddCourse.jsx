import React, { useMemo, useState, useContext } from 'react';
import { Button, Form, Col, Row } from 'react-bootstrap';
import { UserContext } from '../../../App';
import axiosInstance from '../../common/AxiosInstance';
import Toast from '../../common/Toast';
import {
   VIDEO_ACCEPT_ATTRIBUTE,
   buildCourseFormData,
   describeFileProblem,
   describeUploadRules,
   formatFileSize,
   uploadLimits,
   validateCourseUpload,
} from '../../../lib/courseUpload';
import {
   CATEGORY_PLACEHOLDER,
   COURSE_CATEGORIES,
} from '../../../lib/courseCategories';

// #106. The form and the API disagreed about what a section video is. The
// picker said `accept="video/*,image/*"` and the label said "Video or Image";
// the API takes .mp4 with a video/mp4 or application/mp4 type and nothing else,
// which is the rule #44 deliberately tightened. A .mov, a .webm or a .png was
// accepted here, uploaded in full, and rejected by Multer at the end.
//
// Size and count were the same shape: the server enforces MAX_VIDEO_SIZE_MB and
// MAX_SECTION_VIDEOS and maps each to a specific 413 or 400, and nothing here
// checked either, so a teacher with eight 300 MB lectures uploaded 2.4 GB to be
// told at the end that one file was too big — without being told which one.
//
// And because the whole course goes up as one FormData, a single bad file
// discarded the entire submission including every file input, which cannot be
// repopulated programmatically. Every valid video had to be picked again.
//
// The rules now live in lib/courseUpload, mirrored from the server's, and a file
// is refused against the section it belongs to at the moment it is chosen. The
// server check is untouched and stays authoritative.

const EMPTY_TOAST = { message: '', type: 'info' };

const emptyCourse = () => ({
   C_title: '',
   C_categories: '',
   C_price: '',
   C_description: '',
   sections: [],
});

const emptySection = () => ({
   S_title: '',
   S_description: '',
   S_content: null,
});

const AddCourse = () => {
   const user = useContext(UserContext);
   const [submitting, setSubmitting] = useState(false);
   const [formError, setFormError] = useState('');
   const [sectionErrors, setSectionErrors] = useState({});
   // Price and category, marked on the fields themselves rather than only
   // summarised in the form-level message (#135).
   const [detailErrors, setDetailErrors] = useState({});
   const [toast, setToast] = useState(EMPTY_TOAST);

   // The server takes the owner and the educator name from the bearer token, so
   // neither is posted any more. It used to read `userId` straight out of this
   // form, which meant the browser decided who owned the course.
   const [addCourse, setAddCourse] = useState(emptyCourse);

   const limits = useMemo(() => uploadLimits(), []);
   const educatorName = user?.userData?.name || '';
   const atSectionLimit = addCourse.sections.length >= limits.maxSectionVideos;

   const clearSectionError = (index, field) => {
      setSectionErrors((current) => {
         const forSection = current[index];

         if (!forSection?.[field]) return current;

         const next = { ...current };
         const remaining = { ...forSection };

         delete remaining[field];

         if (Object.keys(remaining).length === 0) delete next[index];
         else next[index] = remaining;

         return next;
      });
   };

   const setSectionError = (index, field, message) => {
      setSectionErrors((current) => ({
         ...current,
         [index]: { ...current[index], [field]: message },
      }));
   };

   const clearDetailError = (field) => {
      setDetailErrors((current) => {
         if (!current[field]) return current;

         const next = { ...current };
         delete next[field];

         return next;
      });
   };

   const handleChange = (e) => {
      const { name, value } = e.target;
      setAddCourse({ ...addCourse, [name]: value });
      clearDetailError(name);
   };

   const handleCourseTypeChange = (e) => {
      setAddCourse({ ...addCourse, C_categories: e.target.value });
      clearDetailError('C_categories');
   };

   const addInputGroup = () => {
      if (atSectionLimit) {
         setFormError(
            `A course can have at most ${limits.maxSectionVideos} sections.`,
         );
         return;
      }

      setFormError('');
      setAddCourse({
         ...addCourse,
         sections: [...addCourse.sections, emptySection()],
      });
   };

   const handleChangeSection = (index, e) => {
      const updatedSections = [...addCourse.sections];
      const sectionToUpdate = { ...updatedSections[index] };

      if (e.target.name === 'S_content') {
         const file = e.target.files?.[0] || null;

         // Checked here rather than after the upload. Four minutes of waiting
         // to be told the file was the wrong type is the bug.
         const problem = file ? describeFileProblem(file, limits) : null;

         if (problem) {
            // The input is cleared so the rejected file cannot be submitted,
            // and so the same file can be picked again after being converted.
            e.target.value = '';
            sectionToUpdate.S_content = null;
            setSectionError(index, 'S_content', problem);
         } else {
            sectionToUpdate.S_content = file;
            clearSectionError(index, 'S_content');
         }
      } else {
         sectionToUpdate[e.target.name] = e.target.value;
         clearSectionError(index, e.target.name);
      }

      updatedSections[index] = sectionToUpdate;
      setAddCourse({ ...addCourse, sections: updatedSections });
   };

   const removeInputGroup = (index) => {
      const updatedSections = [...addCourse.sections];
      updatedSections.splice(index, 1);

      // Errors are keyed by position, so they have to move with the sections.
      setSectionErrors((current) => {
         const next = {};

         Object.entries(current).forEach(([key, value]) => {
            const position = Number(key);

            if (position === index) return;

            next[position > index ? position - 1 : position] = value;
         });

         return next;
      });

      setAddCourse({ ...addCourse, sections: updatedSections });
   };

   const handleSubmit = async (e) => {
      e.preventDefault();

      const validation = validateCourseUpload(addCourse, limits);

      if (!validation.valid) {
         setSectionErrors(validation.sectionErrors);
         setDetailErrors(validation.detailErrors || {});
         setFormError(validation.formError);
         return;
      }

      setFormError('');
      setSectionErrors({});
      setDetailErrors({});
      setSubmitting(true);

      try {
         const res = await axiosInstance.post(
            '/api/user/addcourse',
            buildCourseFormData(addCourse),
            { headers: { 'Content-Type': 'multipart/form-data' } },
         );

         if (res.data.success) {
            // The alert fired after an upload that may have taken minutes,
            // blocked the tab, and was then followed by the form being reset —
            // so dismissing it left an empty form and no evidence the course
            // had been created (#137).
            setToast({
               message: res.data.message || 'Course created.',
               type: 'success',
            });
            setAddCourse(emptyCourse());
         } else {
            setFormError(res.data.message || 'Failed to create course.');
         }
      } catch (error) {
         // The API answers 400 with a readable reason, so show it rather than
         // guessing that the upload must have been the wrong file type.
         // The API answers with per-field errors as well as a message, so the
         // price and category it rejected are marked rather than only
         // described.
         const fieldErrors = error.response?.data?.errors;

         if (fieldErrors && typeof fieldErrors === 'object') {
            setDetailErrors({
               ...(fieldErrors.C_price ? { C_price: fieldErrors.C_price } : {}),
               ...(fieldErrors.C_categories
                  ? { C_categories: fieldErrors.C_categories }
                  : {}),
            });
         }

         setFormError(
            error.response?.data?.message ||
               'The course could not be created. Please try again.',
         );
      } finally {
         setSubmitting(false);
      }
   };

   return (
      <div className=''>
         <Form className="mb-3" onSubmit={handleSubmit}>
            <Row className="mb-3">
               <Form.Group as={Col} controlId="formGridJobType">
                  <Form.Label>Course Type</Form.Label>
                  {/* The placeholder carries an empty value now. It had
                      none, so its value was its label and an untouched form
                      published a course filed under "Select categories". */}
                  <Form.Select
                     value={addCourse.C_categories}
                     onChange={handleCourseTypeChange}
                     required
                     isInvalid={Boolean(detailErrors.C_categories)}
                     aria-describedby="categoryError"
                  >
                     <option value="">{CATEGORY_PLACEHOLDER}</option>
                     {COURSE_CATEGORIES.map((category) => (
                        <option key={category} value={category}>
                           {category}
                        </option>
                     ))}
                  </Form.Select>
                  <Form.Control.Feedback type="invalid" id="categoryError">
                     {detailErrors.C_categories}
                  </Form.Control.Feedback>
               </Form.Group>
               <Form.Group as={Col} controlId="formGridTitle">
                  <Form.Label>Course Title</Form.Label>
                  <Form.Control name='C_title' value={addCourse.C_title} onChange={handleChange} type="text" placeholder="Enter Course Title" required />
               </Form.Group>
            </Row>

            <Row className="mb-3">
               <Form.Group as={Col} controlId="formGridEducator">
                  <Form.Label>Course Educator</Form.Label>
                  {/* Read-only: the server credits the signed-in account. The
                      editable version let a course be published under anyone's
                      name. */}
                  <Form.Control
                     value={educatorName}
                     type="text"
                     readOnly
                     disabled
                     aria-describedby="educatorHelp"
                  />
                  <Form.Text id="educatorHelp" muted>
                     Courses are published under your account name.
                  </Form.Text>
               </Form.Group>
               <Form.Group as={Col} controlId="formGridPrice">
                  <Form.Label>Course Price(Rs.)</Form.Label>
                  <Form.Control
                     name='C_price'
                     value={addCourse.C_price}
                     onChange={handleChange}
                     type="text"
                     inputMode="decimal"
                     placeholder="for free course, enter 0"
                     required
                     isInvalid={Boolean(detailErrors.C_price)}
                     aria-describedby="priceError"
                  />
                  <Form.Control.Feedback type="invalid" id="priceError">
                     {detailErrors.C_price}
                  </Form.Control.Feedback>
               </Form.Group>
               <Form.Group as={Col} className="mb-3" controlId="formGridDescription">
                  <Form.Label>Course Description</Form.Label>
                  <Form.Control name='C_description' value={addCourse.C_description} onChange={handleChange} required as={"textarea"} placeholder="Enter Course description" />
               </Form.Group>
            </Row>

            <hr />

            {/* The rule is stated before a file is picked, rather than only
                after one has been rejected. */}
            <p className="text-muted small mb-3">{describeUploadRules(limits)}</p>

            {addCourse.sections.map((section, index) => {
               const errors = sectionErrors[index] || {};
               const file = section.S_content;

               return (
                  <div key={index} className="d-flex flex-column mb-4 border rounded-3 border-3 p-3 position-relative">
                     <Col xs={24} md={12} lg={8}>
                        <span
                           style={{ cursor: 'pointer' }}
                           className="position-absolute top-0 end-0 p-1"
                           onClick={() => removeInputGroup(index)}
                           role="button"
                           aria-label={`Remove section ${index + 1}`}
                        >
                           ❌
                        </span>
                     </Col>
                     <Row className='mb-3'>
                        <Form.Group as={Col} controlId={`sectionTitle-${index}`}>
                           <Form.Label>Section {index + 1} Title</Form.Label>
                           <Form.Control
                              name="S_title"
                              value={section.S_title}
                              onChange={(e) => handleChangeSection(index, e)}
                              type="text"
                              placeholder="Enter Section Title"
                              isInvalid={Boolean(errors.S_title)}
                              required
                           />
                           <Form.Control.Feedback type="invalid">
                              {errors.S_title}
                           </Form.Control.Feedback>
                        </Form.Group>
                        <Form.Group as={Col} controlId={`sectionContent-${index}`}>
                           {/* The label said "Video or Image" while the API has
                               only ever taken .mp4. */}
                           <Form.Label>Section Video (.mp4)</Form.Label>
                           <Form.Control
                              name="S_content"
                              onChange={(e) => handleChangeSection(index, e)}
                              type="file"
                              accept={VIDEO_ACCEPT_ATTRIBUTE}
                              isInvalid={Boolean(errors.S_content)}
                              required
                           />
                           <Form.Control.Feedback type="invalid">
                              {errors.S_content}
                           </Form.Control.Feedback>
                           {file && !errors.S_content ? (
                              <Form.Text muted>
                                 {file.name} — {formatFileSize(file.size)}
                              </Form.Text>
                           ) : null}
                        </Form.Group>

                        <Form.Group className="mb-3" controlId={`sectionDescription-${index}`}>
                           <Form.Label>Section {index + 1} Description</Form.Label>
                           <Form.Control
                              name="S_description"
                              value={section.S_description}
                              onChange={(e) => handleChangeSection(index, e)}
                              as={"textarea"}
                              placeholder="Enter Section description"
                              isInvalid={Boolean(errors.S_description)}
                              required
                           />
                           <Form.Control.Feedback type="invalid">
                              {errors.S_description}
                           </Form.Control.Feedback>
                        </Form.Group>
                     </Row>
                  </div>
               );
            })}

            <Row className="mb-3">
               <Col xs={24} md={12} lg={8}>
                  <Button
                     size='sm'
                     variant='outline-secondary'
                     onClick={addInputGroup}
                     disabled={atSectionLimit}
                     title={
                        atSectionLimit
                           ? `A course can have at most ${limits.maxSectionVideos} sections.`
                           : undefined
                     }
                  >
                     ➕Add Section
                  </Button>
                  <span className="text-muted small ms-2">
                     {addCourse.sections.length} / {limits.maxSectionVideos} sections
                  </span>
               </Col>
            </Row>

            {formError ? (
               <div className="alert alert-danger py-2" role="alert">
                  {formError}
               </div>
            ) : null}

            <Button variant="primary" type="submit" disabled={submitting}>
               {submitting ? 'Creating…' : 'Submit'}
            </Button>
         </Form>

         <Toast
            message={toast.message}
            type={toast.type}
            onClose={() => setToast(EMPTY_TOAST)}
         />
      </div>
   );
};

export default AddCourse;
