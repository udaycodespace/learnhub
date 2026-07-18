import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom';
import { Container } from 'react-bootstrap';
import Avatar from '@mui/material/Avatar';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Grid from '@mui/material/Grid';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import axiosInstance from './AxiosInstance';
import PublicNavBar from './PublicNavBar';

const Login = () => {
   const navigate = useNavigate()
   const [viewMode, setViewMode] = useState('login'); // 'login', 'forgot', 'reset'
   const [data, setData] = useState({
      email: "",
      password: "",
   })
   const [forgotEmail, setForgotEmail] = useState('');
   const [resetToken, setResetToken] = useState('');
   const [newPassword, setNewPassword] = useState('');

   const handleChange = (e) => {
      const { name, value } = e.target;
      setData({ ...data, [name]: value });
   };

   const handleSubmit = (e) => {
      e.preventDefault();

      if (!data?.email || !data?.password) {
         return alert("Please fill all fields");
      } else {
         axiosInstance.post('/api/user/login', data)
            .then((res) => {
               if (res.data.success) {
                  alert(res.data.message)

                  localStorage.setItem("token", res.data.token);
                  localStorage.setItem("user", JSON.stringify(res.data.userData));
                  navigate('/dashboard')
                  setTimeout(() => {
                     window.location.reload()
                  }, 1000)
               } else {
                  alert(res.data.message)
               }
            })
            .catch((err) => {
               if (err.response && err.response.status === 401) {
                  alert("User doesn't exist");
               }
               navigate("/login");
            });
      }
   };

   const handleForgotSubmit = (e) => {
      e.preventDefault();
      if (!forgotEmail) return alert("Please enter email");
      axiosInstance.post('/api/user/forgot-password', { email: forgotEmail })
         .then((res) => {
            alert(res.data.message);
            setViewMode('reset');
         })
         .catch((err) => {
            console.log(err);
            alert("Error sending reset email");
         });
   };

   const handleResetSubmit = (e) => {
      e.preventDefault();
      if (!forgotEmail || !resetToken || !newPassword) {
         return alert("Please fill all fields");
      }
      axiosInstance.post('/api/user/reset-password', {
         email: forgotEmail,
         token: resetToken,
         newPassword: newPassword
      })
         .then((res) => {
            if (res.data.success) {
               alert(res.data.message);
               setViewMode('login');
            } else {
               alert(res.data.message || "Failed to reset password");
            }
         })
         .catch((err) => {
            console.log(err);
            alert("Reset failed. Please verify code and password requirements.");
         });
   };

   return (
      <>

         <PublicNavBar />

         <div className='first-container premium-bg'>
            <Container component="main" className="premium-login-container">
               <Box className="premium-login-box">
                  <Avatar sx={{ bgcolor: 'secondary.main' }}>
                  </Avatar>
                  <Typography component="h1" variant="h5">
                     {viewMode === 'login' && "Sign In"}
                     {viewMode === 'forgot' && "Forgot Password"}
                     {viewMode === 'reset' && "Reset Password"}
                  </Typography>

                  {viewMode === 'login' && (
                     <Box component="form" onSubmit={handleSubmit} noValidate>
                        <TextField
                           margin="normal"
                           fullWidth
                           id="email"
                           label="Email Address"
                           name="email"
                           value={data.email}
                           onChange={handleChange}
                           autoComplete="email"
                           autoFocus
                        />
                        <TextField
                           margin="normal"
                           fullWidth
                           name="password"
                           value={data.password}
                           onChange={handleChange}
                           label="Password"
                           type="password"
                           id="password"
                           autoComplete="current-password"
                        />
                        <Box mt={2}>
                           <Button
                              type="submit"
                              variant="contained"
                              sx={{ mt: 3, mb: 2 }}
                              style={{ width: '200px' }}
                           >
                              Sign In
                           </Button>
                        </Box>
                        <Grid container justifyContent="space-between">
                           <Grid item>
                              <Link style={{ color: "blue" }} to={'/register'} variant="body2">
                                 {"Sign Up"}
                              </Link>
                           </Grid>
                           <Grid item>
                              <span style={{ color: "blue", cursor: "pointer" }} onClick={() => setViewMode('forgot')}>
                                 {"Forgot password?"}
                              </span>
                           </Grid>
                        </Grid>
                     </Box>
                  )}

                  {viewMode === 'forgot' && (
                     <Box component="form" onSubmit={handleForgotSubmit} noValidate>
                        <TextField
                           margin="normal"
                           fullWidth
                           id="forgotEmail"
                           label="Email Address"
                           value={forgotEmail}
                           onChange={(e) => setForgotEmail(e.target.value)}
                           autoComplete="email"
                           autoFocus
                        />
                        <Box mt={2}>
                           <Button
                              type="submit"
                              variant="contained"
                              sx={{ mt: 3, mb: 2 }}
                              style={{ width: '200px' }}
                           >
                              Send Reset Code
                           </Button>
                        </Box>
                        <span style={{ color: "blue", cursor: "pointer" }} onClick={() => setViewMode('login')}>
                           {"Back to Login"}
                        </span>
                     </Box>
                  )}

                  {viewMode === 'reset' && (
                     <Box component="form" onSubmit={handleResetSubmit} noValidate>
                        <TextField
                           margin="normal"
                           fullWidth
                           id="forgotEmail"
                           label="Email Address"
                           value={forgotEmail}
                           onChange={(e) => setForgotEmail(e.target.value)}
                           autoComplete="email"
                        />
                        <TextField
                           margin="normal"
                           fullWidth
                           id="resetToken"
                           label="Reset Code (OTP)"
                           value={resetToken}
                           onChange={(e) => setResetToken(e.target.value)}
                        />
                        <TextField
                           margin="normal"
                           fullWidth
                           id="newPassword"
                           label="New Password"
                           type="password"
                           value={newPassword}
                           onChange={(e) => setNewPassword(e.target.value)}
                        />
                        <Box mt={2}>
                           <Button
                              type="submit"
                              variant="contained"
                              sx={{ mt: 3, mb: 2 }}
                              style={{ width: '200px' }}
                           >
                              Update Password
                           </Button>
                        </Box>
                        <span style={{ color: "blue", cursor: "pointer" }} onClick={() => setViewMode('login')}>
                           {"Cancel"}
                        </span>
                     </Box>
                  )}
               </Box>
            </Container>
         </div>

      </>
   )
}

export default Login



