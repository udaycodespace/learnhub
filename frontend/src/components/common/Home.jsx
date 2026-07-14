import React from 'react'
import { Link } from 'react-router-dom'
import { Container, Nav, Button, Navbar, Row, Col } from 'react-bootstrap';

const Home = () => {
   return (
      <>
         <Navbar expand="lg" className="premium-navbar">
            <Container fluid>
               <Navbar.Brand style={{display:'flex', flexDirection:'column', alignItems:'flex-start'}}>
                 <span className="brand-premium"><span className="brand-premium-L">L</span>earnhub</span>
                 <span className="brand-quote-premium">your center for skill enhancement</span>
               </Navbar.Brand>
               <Navbar.Toggle aria-controls="navbarScroll" />
               <Navbar.Collapse id="navbarScroll">
                  <Nav className="ms-auto premium-nav-links">
                     <Link className="premium-btn" to={'/'}>Home</Link>
                     <Link className="premium-btn" to={'/login'}>Login</Link>
                     <Link className="premium-btn premium-btn-register" to={'/register'}>Register</Link>
                  </Nav>
               </Navbar.Collapse>
            </Container>
         </Navbar>

         {/* Hero Section */}
         <div id='home-container' className='first-container'>
            <div className="content-home">
               <h1 className="hero-title">Small App, Big Dreams</h1>
               <p className="hero-subtitle">Elevating Your Education with Interactive Courses, Expert Instructors, and a Community of Learners</p>
               <div className="hero-actions">
                  <Link to={'/register'}><Button variant='warning' className='hero-btn-primary' size='lg'>Get Started Free</Button></Link>
                  <Link to={'/login'}><Button variant='outline-light' className='hero-btn-secondary' size='lg'>Sign In</Button></Link>
               </div>
               <div className="hero-stats">
                  <div className="hero-stat">
                     <span className="hero-stat-number">500+</span>
                     <span className="hero-stat-label">Courses</span>
                  </div>
                  <div className="hero-stat">
                     <span className="hero-stat-number">10K+</span>
                     <span className="hero-stat-label">Students</span>
                  </div>
                  <div className="hero-stat">
                     <span className="hero-stat-number">50+</span>
                     <span className="hero-stat-label">Instructors</span>
                  </div>
               </div>
            </div>
         </div>

         {/* Features Section */}
         <Container className="features-section">
            <h2 className="section-title">Why Choose LearnHub?</h2>
            <Row className="g-4 mt-2">
               <Col md={4}>
                  <div className="feature-card">
                     <div className="feature-icon">📚</div>
                     <h3>Interactive Courses</h3>
                     <p>Engage with hands-on projects, quizzes, and real-world assignments designed by industry professionals.</p>
                  </div>
               </Col>
               <Col md={4}>
                  <div className="feature-card">
                     <div className="feature-icon">🎓</div>
                     <h3>Expert Instructors</h3>
                     <p>Learn from experienced educators who bring practical knowledge and mentorship to every lesson.</p>
                  </div>
               </Col>
               <Col md={4}>
                  <div className="feature-card">
                     <div className="feature-icon">🚀</div>
                     <h3>Career Growth</h3>
                     <p>Build skills that matter. Track your progress and earn certificates to showcase your achievements.</p>
                  </div>
               </Col>
            </Row>
         </Container>

         {/* Trending Courses */}
         <Container className="second-container">
            <h2 className="text-center my-4 section-title">Trending Courses</h2>
            <AllCourses />
         </Container>

         {/* CTA Section */}
         <div className="cta-section">
            <Container>
               <h2 className="cta-title">Ready to Start Learning?</h2>
               <p className="cta-subtitle">Join thousands of students already building their future with LearnHub.</p>
               <Link to={'/register'}><Button variant='warning' className='hero-btn-primary' size='lg'>Create Free Account</Button></Link>
            </Container>
         </div>
      </>
   )
}

export default Home
