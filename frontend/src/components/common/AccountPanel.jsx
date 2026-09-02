import { useCallback, useEffect, useState } from 'react';

import axiosInstance, { USER_STORAGE_KEY } from './AxiosInstance';
import Toast from './Toast';
import { useAuth } from '../../auth/authContext';
import '../../styles/account.css';
import { roleLabel } from '../../lib/roles';
import {
  isEditable,
  mergeAccountIntoUser,
  readAccount,
  readAccountError,
  validatePasswordChange,
  validateProfile,
} from '../../lib/account';

// #126. The screen that did not exist.
//
// The ⚙️ Settings dropdown held one control, a theme toggle. There was no
// account page, no way to see what the application stores about you, and no way
// to change a password without signing out and completing the emailed reset
// flow — which also marks the address verified and discards any pending OTP,
// side effects a routine rotation has no business causing.

const EMPTY_TOAST = { message: '', type: 'info' };

const emptyPasswordForm = () => ({
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
});

const AccountPanel = () => {
  const { refresh } = useAuth();

  const [account, setAccount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [toast, setToast] = useState(EMPTY_TOAST);

  const [name, setName] = useState('');
  const [profileErrors, setProfileErrors] = useState({});
  const [savingProfile, setSavingProfile] = useState(false);

  const [passwordForm, setPasswordForm] = useState(emptyPasswordForm);
  const [passwordErrors, setPasswordErrors] = useState({});
  const [changingPassword, setChangingPassword] = useState(false);

  const dismissToast = useCallback(() => setToast(EMPTY_TOAST), []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');

    try {
      const response = await axiosInstance.get('/api/user/account');
      const data = readAccount(response.data);

      if (!data) {
        setLoadError('Your account could not be loaded.');
        return;
      }

      setAccount(data);
      setName(data.name || '');
    } catch (error) {
      setLoadError(
        readAccountError(error, 'Your account could not be loaded.').message,
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleProfileSubmit = async (event) => {
    event.preventDefault();

    const { valid, errors } = validateProfile({ name });

    setProfileErrors(errors);
    if (!valid) return;

    setSavingProfile(true);

    try {
      const response = await axiosInstance.put('/api/user/account', { name });
      const data = readAccount(response.data);

      if (data) setAccount(data);

      // The navbar greeting, the certificate and every review byline read
      // `name` off the stored session user, so it has to move with the account
      // or the old name shows until the next sign-in.
      try {
        const stored = JSON.parse(
          window.localStorage.getItem(USER_STORAGE_KEY) || 'null',
        );
        const merged = mergeAccountIntoUser(stored, data);

        if (merged) {
          window.localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(merged));
          refresh();
        }
      } catch {
        // Unreadable storage is not a reason to report a failed save; the
        // server accepted the change. The next sign-in will pick it up.
      }

      setProfileErrors({});
      setToast({
        message: response.data?.message || 'Your details were updated.',
        type: 'success',
      });
    } catch (error) {
      const { message, errors: fieldErrors } = readAccountError(
        error,
        'Your details could not be updated.',
      );

      setProfileErrors(fieldErrors);
      setToast({ message, type: 'error' });
    } finally {
      setSavingProfile(false);
    }
  };

  const handlePasswordChange = (event) => {
    const { name: field, value } = event.target;

    setPasswordForm((current) => ({ ...current, [field]: value }));

    // Clear a field's marker as soon as it is edited, so a corrected input
    // stops being flagged before the form is submitted again (#114).
    setPasswordErrors((current) => {
      if (!current[field]) return current;

      const next = { ...current };
      delete next[field];
      return next;
    });
  };

  const handlePasswordSubmit = async (event) => {
    event.preventDefault();

    const { valid, errors } = validatePasswordChange(passwordForm);

    setPasswordErrors(errors);
    if (!valid) return;

    setChangingPassword(true);

    try {
      const response = await axiosInstance.post('/api/user/change-password', {
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
      });

      setPasswordForm(emptyPasswordForm());
      setPasswordErrors({});
      setToast({
        message: response.data?.message || 'Your password was changed.',
        type: 'success',
      });
    } catch (error) {
      const { message, errors: fieldErrors } = readAccountError(
        error,
        'Your password could not be changed.',
      );

      setPasswordErrors(fieldErrors);
      setToast({ message, type: 'error' });
    } finally {
      setChangingPassword(false);
    }
  };

  if (loading) {
    return (
      <div className="course-state" role="status">
        <span className="catalog-loader" aria-hidden="true" />
        <h3>Loading your account…</h3>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="course-state course-state-error" role="alert">
        <h3>Your account could not be loaded</h3>
        <p>{loadError}</p>
        <button type="button" className="button button-ink" onClick={load}>
          Try again
        </button>
      </div>
    );
  }

  const editable = isEditable(account);

  return (
    <div className="account-panel">
      <Toast message={toast.message} type={toast.type} onClose={dismissToast} />

      <h2 className="account-heading">Your account</h2>

      {/* What the application stores. There was no screen that said so. */}
      <dl className="account-summary">
        <div>
          <dt>Email</dt>
          <dd>{account?.email || 'Not recorded'}</dd>
        </div>
        <div>
          <dt>Role</dt>
          <dd>{roleLabel(account?.type) || 'Unknown'}</dd>
        </div>
        <div>
          <dt>Email verified</dt>
          <dd>{account?.isVerified ? 'Yes' : 'No'}</dd>
        </div>
      </dl>

      <p className="account-note">
        Your email address is your sign-in identity and cannot be changed here.
      </p>

      {!editable && (
        <p className="course-state" role="status">
          This is the administrator account. Its credentials are configured on
          the server and cannot be edited from the application.
        </p>
      )}

      {editable && (
        <>
          <section className="account-section">
            <h3>Display name</h3>

            <form onSubmit={handleProfileSubmit} noValidate>
              <label className="account-field">
                <span>Name</span>
                <input
                  type="text"
                  name="name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  aria-invalid={Boolean(profileErrors.name)}
                  autoComplete="name"
                />
                {profileErrors.name && (
                  <small className="account-field-error" role="alert">
                    {profileErrors.name}
                  </small>
                )}
              </label>

              <button
                type="submit"
                className="button button-ink"
                disabled={savingProfile}
              >
                {savingProfile ? 'Saving…' : 'Save name'}
              </button>
            </form>
          </section>

          <section className="account-section">
            <h3>Change password</h3>

            <p className="account-note">
              Your current password is required. Signing out to use the emailed
              reset code is only for when you cannot sign in.
            </p>

            <form onSubmit={handlePasswordSubmit} noValidate>
              <label className="account-field">
                <span>Current password</span>
                <input
                  type="password"
                  name="currentPassword"
                  value={passwordForm.currentPassword}
                  onChange={handlePasswordChange}
                  aria-invalid={Boolean(passwordErrors.currentPassword)}
                  autoComplete="current-password"
                />
                {passwordErrors.currentPassword && (
                  <small className="account-field-error" role="alert">
                    {passwordErrors.currentPassword}
                  </small>
                )}
              </label>

              <label className="account-field">
                <span>New password</span>
                <input
                  type="password"
                  name="newPassword"
                  value={passwordForm.newPassword}
                  onChange={handlePasswordChange}
                  aria-invalid={Boolean(passwordErrors.newPassword)}
                  autoComplete="new-password"
                />
                {passwordErrors.newPassword && (
                  <small className="account-field-error" role="alert">
                    {passwordErrors.newPassword}
                  </small>
                )}
              </label>

              <label className="account-field">
                <span>Confirm new password</span>
                <input
                  type="password"
                  name="confirmPassword"
                  value={passwordForm.confirmPassword}
                  onChange={handlePasswordChange}
                  aria-invalid={Boolean(passwordErrors.confirmPassword)}
                  autoComplete="new-password"
                />
                {passwordErrors.confirmPassword && (
                  <small className="account-field-error" role="alert">
                    {passwordErrors.confirmPassword}
                  </small>
                )}
              </label>

              <button
                type="submit"
                className="button button-ink"
                disabled={changingPassword}
              >
                {changingPassword ? 'Changing…' : 'Change password'}
              </button>
            </form>
          </section>
        </>
      )}
    </div>
  );
};

export default AccountPanel;
