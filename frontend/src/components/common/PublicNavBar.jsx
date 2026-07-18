import React from 'react'
import { NavLink } from 'react-router-dom';
import Navbar from 'react-bootstrap/Navbar';
import { Container, Nav } from 'react-bootstrap';

const PublicNavBar = () => {
   return (
      <Navbar expand="lg" className="landing-nav-wrapper">
         <Container fluid className="landing-nav">
            <Navbar.Brand href="/" className="landing-brand">
               <span className="landing-brand-mark">L</span>
               <span>
                  <strong>LearnHub</strong>
                  <small>Skills that move with you</small>
               </span>
            </Navbar.Brand>
            <Navbar.Toggle aria-controls="publicNavbarScroll" />
            <Navbar.Collapse id="publicNavbarScroll">
               <Nav className="landing-nav-actions ms-auto">
                  <NavLink className="nav-text-link" to={'/'}>Home</NavLink>
                  <NavLink className="nav-text-link" to={'/login'}>Login</NavLink>
                  <NavLink className="nav-text-link" to={'/register'}>Register</NavLink>
               </Nav>
            </Navbar.Collapse>
         </Container>
      </Navbar>
   )
}

export default PublicNavBar