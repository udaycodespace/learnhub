import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Container } from 'react-bootstrap';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import axiosInstance from '../common/AxiosInstance';
import PublicNavBar from '../common/PublicNavBar';
import Toast from '../common/Toast';
import { useAuth } from '../../auth/authContext';
import { writeSession } from '../../auth/session';
import {
  ADMIN_HOME_PATH,
  ADMIN_LOGIN_URL,
  describeAdminLoginError,
  readAdminLogin,
} from '../../lib/adminSession';

// #125. The screen that was missing.
//
// `POST /api/admin/login` is the only issuer of a token carrying
// `role: "admin"`, and nothing in the application called it: no route, no form,
// no link. The admin dashboard — the users table, the payment records, the
// activity log viewer and the admin course list — was unreachable, and no
// account created through `/register` can hold the role either, because #55
// deliberately stopped clients choosing their own.
//
// This posts the credentials, writes the session through the same helper the
// learner sign-in uses, and tells `AuthProvider` to re-read it so the redirect
// lands on a dashboard that already knows who is signed in.

const AdminLogin = () => {
  const navigate = useNavigate();
  const { refresh } = useAuth();

  const [credentials, setCredentials] = useState({
    username: '',
    password: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState({ message: '', type: 'info' });

  const closeToast = () => setToast({ message: '', type: 'info' });

  const handleChange = (event) => {
    const { name, value } = event.target;

    setCredentials((current) => ({ ...current, [name]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!credentials.username || !credentials.password) {
      setToast({ message: 'Please fill all fields', type: 'error' });
      return;
    }

    setSubmitting(true);

    try {
      const response = await axiosInstance.post(ADMIN_LOGIN_URL, credentials);
      const result = readAdminLogin(response.data);

      if (!result.ok) {
        setToast({ message: result.message, type: 'error' });
        return;
      }

      // The same two keys the learner sign-in writes, through the same helper,
      // so there is one place that knows what a stored session looks like.
      writeSession(result.token, result.user);

      // AuthProvider reads storage on mount and on the `storage` event, which
      // only fires in *other* tabs. Without this the redirect would arrive
      // before the provider knew there was a session and ProtectedRoute would
      // bounce it straight back here.
      refresh();

      navigate(ADMIN_HOME_PATH, { replace: true });
    } catch (error) {
      setToast({ message: describeAdminLoginError(error), type: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Toast message={toast.message} type={toast.type} onClose={closeToast} />

      <PublicNavBar />

      <div className="first-container premium-bg">
        <Container component="main" className="premium-login-container">
          <Box className="premium-login-box">
            <Typography component="h1" variant="h5">
              Administrator Sign In
            </Typography>

            <Typography
              variant="body2"
              sx={{ mt: 1, mb: 1, textAlign: 'center', opacity: 0.8 }}
            >
              For the operator account configured on the server. Learners and
              educators sign in on the main login page.
            </Typography>

            <Box component="form" onSubmit={handleSubmit} noValidate>
              <TextField
                margin="normal"
                fullWidth
                id="admin-username"
                label="Admin Username"
                name="username"
                value={credentials.username}
                onChange={handleChange}
                autoComplete="username"
                autoFocus
              />
              <TextField
                margin="normal"
                fullWidth
                id="admin-password"
                label="Password"
                name="password"
                type="password"
                value={credentials.password}
                onChange={handleChange}
                autoComplete="current-password"
              />
              <Box mt={2}>
                <Button
                  type="submit"
                  variant="contained"
                  disabled={submitting}
                  sx={{ mt: 3, mb: 2 }}
                  style={{ width: '200px' }}
                >
                  {submitting ? 'Signing in…' : 'Sign In'}
                </Button>
              </Box>
            </Box>
          </Box>
        </Container>
      </div>
    </>
  );
};

export default AdminLogin;
