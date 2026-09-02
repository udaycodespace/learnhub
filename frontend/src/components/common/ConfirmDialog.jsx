import { useEffect, useRef } from 'react';
import PropTypes from 'prop-types';

import { CONFIRM_TONE } from '../../lib/confirmDialog';
import './ConfirmDialog.css';

// Lifted from the panel TeacherHome already had, rather than written a third
// and fourth time for SavedCourses and CourseReviews (#137).
//
// What this has that `window.confirm` does not: a place to say what the
// consequence is, buttons that name the action instead of saying OK, the
// site's theme, focus that starts on Cancel, Escape to dismiss, and — the
// point — no blocking of the tab's event loop while it is up.

const ConfirmDialog = ({ request, onCancel, busy = false }) => {
  const cancelRef = useRef(null);

  useEffect(() => {
    if (!request) return undefined;

    // Focus the safe option, not the destructive one.
    cancelRef.current?.focus();

    const onKeyDown = (event) => {
      if (event.key === 'Escape') onCancel();
    };

    document.addEventListener('keydown', onKeyDown);

    return () => document.removeEventListener('keydown', onKeyDown);
  }, [request, onCancel]);

  if (!request) return null;

  const { title, consequence, confirmLabel, cancelLabel, tone, onConfirm } =
    request;

  return (
    <div
      className="confirm-dialog"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      aria-describedby={consequence ? 'confirm-dialog-body' : undefined}
      // A click on the backdrop is a dismissal, but a click that started
      // inside the panel and ended here is a drag, not a dismissal.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div className="confirm-dialog-panel">
        <h3 id="confirm-dialog-title">{title}</h3>

        {consequence ? <p id="confirm-dialog-body">{consequence}</p> : null}

        <div className="confirm-dialog-actions">
          <button
            type="button"
            ref={cancelRef}
            className="confirm-dialog-cancel"
            onClick={onCancel}
            disabled={busy}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={
              tone === CONFIRM_TONE.DANGER
                ? 'confirm-dialog-confirm is-danger'
                : 'confirm-dialog-confirm'
            }
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

ConfirmDialog.propTypes = {
  request: PropTypes.shape({
    title: PropTypes.string.isRequired,
    consequence: PropTypes.string,
    confirmLabel: PropTypes.string.isRequired,
    cancelLabel: PropTypes.string.isRequired,
    tone: PropTypes.string,
    onConfirm: PropTypes.func.isRequired,
  }),
  onCancel: PropTypes.func.isRequired,
  busy: PropTypes.bool,
};

export default ConfirmDialog;
