import { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { Button, Form, Modal } from 'react-bootstrap';

import axiosInstance from '../../common/AxiosInstance';
import {
  hasChanges,
  readEditError,
  toEditForm,
  toUpdatePayload,
  validateEditForm,
} from '../../../lib/courseEdit';

// #127. The educator dashboard offered one action per course, Delete, and
// deleting is destructive by design (#74): it removes every section video from
// disk and then every enrolment, payment, review and bookmark that pointed at
// the course. That was the only way to correct a typo in a title.
//
// This edits the fields that need no upload and invalidate no enrolment. The
// videos, the section count, the learner count and the ownership are untouched
// and are not on the form.

const emptyForm = () => ({
  C_title: '',
  C_categories: '',
  C_price: '',
  C_description: '',
  sections: [],
});

const EditCourse = ({ course, onClose, onSaved }) => {
  const [form, setForm] = useState(emptyForm);
  const [original, setOriginal] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const courseId = course?.id;

  useEffect(() => {
    if (!courseId) return undefined;

    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setLoadError('');

      try {
        const response = await axiosInstance.get(
          `/api/user/editcourse/${courseId}`,
        );

        if (cancelled) return;

        // The educator list endpoint projects section text away (#94), so the
        // form is filled from this response rather than from the card.
        const loaded = toEditForm(response.data?.data);

        setForm(loaded);
        setOriginal(loaded);
      } catch (error) {
        if (!cancelled) setLoadError(readEditError(error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, [courseId]);

  const clearFieldError = (key) => {
    setErrors((current) => {
      if (!current[key]) return current;

      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const handleFieldChange = (event) => {
    const { name, value } = event.target;

    setForm((current) => ({ ...current, [name]: value }));
    clearFieldError(name);
  };

  const handleSectionChange = (index, field, value) => {
    setForm((current) => {
      const sections = [...current.sections];
      sections[index] = { ...sections[index], [field]: value };

      return { ...current, sections };
    });

    clearFieldError(`sections.${index}.${field}`);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    const validation = validateEditForm(form);

    setErrors(validation.errors);
    setFormError('');

    if (!validation.valid) return;

    setSaving(true);

    try {
      const response = await axiosInstance.put(
        `/api/user/editcourse/${courseId}`,
        toUpdatePayload(form),
      );

      onSaved?.(response.data?.message || 'Course updated successfully');
      onClose?.();
    } catch (error) {
      const { message, errors: fieldErrors } = readEditError(error);

      setErrors(fieldErrors);
      setFormError(message);
    } finally {
      setSaving(false);
    }
  };

  const dirty = hasChanges(form, original);

  return (
    <Modal show onHide={onClose} size="lg" scrollable>
      <Modal.Header closeButton>
        <Modal.Title>Edit course</Modal.Title>
      </Modal.Header>

      <Modal.Body>
        {loading && <p role="status">Loading the course…</p>}

        {!loading && loadError && (
          <p className="course-state course-state-error" role="alert">
            {loadError}
          </p>
        )}

        {!loading && !loadError && (
          <Form onSubmit={handleSubmit} noValidate id="edit-course-form">
            {formError && (
              <p className="course-state course-state-error" role="alert">
                {formError}
              </p>
            )}

            <Form.Group className="mb-3">
              <Form.Label htmlFor="edit-title">Title</Form.Label>
              <Form.Control
                id="edit-title"
                name="C_title"
                value={form.C_title}
                onChange={handleFieldChange}
                isInvalid={Boolean(errors.C_title)}
              />
              <Form.Control.Feedback type="invalid">
                {errors.C_title}
              </Form.Control.Feedback>
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label htmlFor="edit-category">Category</Form.Label>
              <Form.Control
                id="edit-category"
                name="C_categories"
                value={form.C_categories}
                onChange={handleFieldChange}
                isInvalid={Boolean(errors.C_categories)}
              />
              <Form.Control.Feedback type="invalid">
                {errors.C_categories}
              </Form.Control.Feedback>
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label htmlFor="edit-price">Price</Form.Label>
              <Form.Control
                id="edit-price"
                name="C_price"
                value={form.C_price}
                onChange={handleFieldChange}
                isInvalid={Boolean(errors.C_price)}
              />
              {/* The rule from #114, said out loud rather than discovered by
                  submitting and being corrected. */}
              <Form.Text>
                Leave blank, or enter 0 or “free”, for a free course.
              </Form.Text>
              <Form.Control.Feedback type="invalid">
                {errors.C_price}
              </Form.Control.Feedback>
            </Form.Group>

            <Form.Group className="mb-4">
              <Form.Label htmlFor="edit-description">Description</Form.Label>
              <Form.Control
                as="textarea"
                rows={4}
                id="edit-description"
                name="C_description"
                value={form.C_description}
                onChange={handleFieldChange}
                isInvalid={Boolean(errors.C_description)}
              />
              <Form.Control.Feedback type="invalid">
                {errors.C_description}
              </Form.Control.Feedback>
            </Form.Group>

            {form.sections.length > 0 && (
              <>
                <h5>Sections</h5>
                <p className="account-note">
                  The videos themselves cannot be changed here. Replacing one
                  means publishing a new course.
                </p>

                {errors.sections && (
                  <p className="course-state course-state-error" role="alert">
                    {errors.sections}
                  </p>
                )}

                {form.sections.map((section, index) => (
                  <fieldset
                    key={index}
                    className="mb-3 p-3"
                    style={{ border: '1px solid var(--line)', borderRadius: 12 }}
                  >
                    <legend className="h6">
                      Section {index + 1}
                      {!section.hasVideo && ' — no video'}
                    </legend>

                    <Form.Group className="mb-2">
                      <Form.Label htmlFor={`edit-section-title-${index}`}>
                        Section title
                      </Form.Label>
                      <Form.Control
                        id={`edit-section-title-${index}`}
                        value={section.S_title}
                        onChange={(event) =>
                          handleSectionChange(index, 'S_title', event.target.value)
                        }
                        isInvalid={Boolean(errors[`sections.${index}.S_title`])}
                      />
                      <Form.Control.Feedback type="invalid">
                        {errors[`sections.${index}.S_title`]}
                      </Form.Control.Feedback>
                    </Form.Group>

                    <Form.Group>
                      <Form.Label htmlFor={`edit-section-description-${index}`}>
                        Section description
                      </Form.Label>
                      <Form.Control
                        as="textarea"
                        rows={2}
                        id={`edit-section-description-${index}`}
                        value={section.S_description}
                        onChange={(event) =>
                          handleSectionChange(
                            index,
                            'S_description',
                            event.target.value,
                          )
                        }
                        isInvalid={Boolean(
                          errors[`sections.${index}.S_description`],
                        )}
                      />
                      <Form.Control.Feedback type="invalid">
                        {errors[`sections.${index}.S_description`]}
                      </Form.Control.Feedback>
                    </Form.Group>
                  </fieldset>
                ))}
              </>
            )}
          </Form>
        )}
      </Modal.Body>

      <Modal.Footer>
        <Button variant="secondary" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          type="submit"
          form="edit-course-form"
          variant="primary"
          // An untouched form would be answered "No editable fields were
          // supplied", which is a sentence nobody should have to read.
          disabled={loading || Boolean(loadError) || saving || !dirty}
        >
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

EditCourse.propTypes = {
  course: PropTypes.shape({
    id: PropTypes.string,
    title: PropTypes.string,
  }),
  onClose: PropTypes.func,
  onSaved: PropTypes.func,
};

export default EditCourse;
