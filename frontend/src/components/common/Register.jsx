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
import Dropdown from 'react-bootstrap/Dropdown';




const Register = () => {
   const navigate = useNavigate()
   const [selectedOption, setSelectedOption] = useState('Select User');
   const [showOtpInput, setShowOtpInput] = useState(false);
   const [otp, setOtp] = useState('');
   const [data, setData] = useState({
      name: "",
      email: "",
      password: "",
      type: "",
   })

   const handleSelect = (eventKey) => {
      setSelectedOption(eventKey);
      setData({ ...data, type: eventKey });
   };

   const handleChange = (e) => {
      const { name, value } = e.target;
      setData({ ...data, [name]: value });
   };

   const handleSubmit = (e) => {
      e.preventDefault()
      if (!data?.name || !data?.email || !data?.password || !data?.type) return alert("Please fill all fields");
      else {
         axiosInstance.post('/api/user/register', data)
            .then((response) => {
               if (response.data.success) {
                  alert(response.data.message)
                  setShowOtpInput(true)
               } else {
                  alert(response.data.message || 'Registration failed. Please try again.');
               }
            })
            .catch((error) => {
               console.log("Error", error);
            });
      }
   };

   const handleOtpSubmit = (e) => {
      e.preventDefault();
      if (!otp) return alert("Please enter the 6-digit OTP");
      axiosInstance.post('/api/user/verify-otp', { email: data.email, otp })
         .then((response) => {
            if (response.data.success) {
               alert(response.data.message);
               navigate('/login');
            } else {
               alert(response.data.message || 'OTP verification failed');
            }
         })
         .catch((error) => {
            console.log("Error", error);
            alert("Verification error, please try again.");
         });
   };


   return (
      <>

         <PublicNavBar />
         <div className="first-container premium-bg">
            <Container component="main" className="premium-login-container">
               <Box className="premium-login-box">
                  <Avatar sx={{ bgcolor: 'secondary.main' }}>
                     {/* <LockOutlinedIcon /> */}
                  </Avatar>
                  <Typography component="h1" variant="h5">
                     {showOtpInput ? "Verify Email" : "Register"}
                  </Typography>
                  {showOtpInput ? (
                     <Box component="form" onSubmit={handleOtpSubmit} noValidate>
                        <Typography variant="body2" sx={{ my: 2 }}>
                           Please enter the 6-digit OTP code sent to <strong>{data.email}</strong>.
                        </Typography>
                        <TextField
                           margin="normal"
                           fullWidth
                           id="otp"
                           label="Enter 6-digit OTP"
                           name="otp"
                           value={otp}
                           onChange={(e) => setOtp(e.target.value)}
                           autoFocus
                        />
                        <Button
                           type="submit"
                           variant="contained"
                           sx={{ mt: 3, mb: 2 }}
                           style={{ width: '200px' }}
                        >
                           Verify OTP
                        </Button>
                     </Box>
                  ) : (
                     <Box component="form" onSubmit={handleSubmit} noValidate>
                        <TextField
                           margin="normal"
                           fullWidth
                           id="name"
                           label="Full Name"
                           name="name"
                           value={data.name}
                           onChange={handleChange}
                           autoComplete="name"
                           autoFocus
                        />
                        <TextField
                           margin="normal"
                           fullWidth
                           id="email"
                           label="Email Address"
                           name="email"
                           value={data.email}
                           onChange={handleChange}
                           autoComplete="email"
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
                        <Dropdown className='my-3'>
                           <Dropdown.Toggle variant="outline-secondary" id="dropdown-basic">
                              {selectedOption}
                           </Dropdown.Toggle>

                           <Dropdown.Menu>
                              <Dropdown.Item onClick={() => handleSelect("Student")}>Student</Dropdown.Item>
                              <Dropdown.Item onClick={() => handleSelect("Teacher")}>Teacher</Dropdown.Item>
                           </Dropdown.Menu>
                        </Dropdown>
                        <Box mt={2}>
                           <Button
                              type="submit"
                              variant="contained"
                              sx={{ mt: 3, mb: 2 }}
                              style={{ width: '200px' }}
                           >
                              Sign Up
                           </Button>
                        </Box>
                        <Grid container>
                           <Grid item>Have an account?
                              <Link style={{ color: "blue" }} to={'/login'} variant="body2">
                                 {" Sign In"}
                              </Link>
                           </Grid>
                        </Grid>
                     </Box>
                  )}
               </Box>
            </Container>
         </div>

      </>
   )
}

export default Register
