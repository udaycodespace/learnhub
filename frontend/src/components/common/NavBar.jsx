import React, { useContext, useState, useEffect, useRef } from 'react'
import { Navbar, Nav, Button, Container } from 'react-bootstrap';
import { UserContext } from '../../App';
import { NavLink } from 'react-router-dom';
import SavedCoursesNavLink from "../bookmarks/SavedCoursesNavLink";

const NavBar = ({ setSelectedComponent }) => {

   const user = useContext(UserContext)
   const [darkMode, setDarkMode] = useState(false);
   const [settingsOpen, setSettingsOpen] = useState(false);
   const settingsRef = useRef();

   useEffect(() => {
      // On mount, set dark mode from localStorage
      const isDark = localStorage.getItem('darkMode') === 'true';
      setDarkMode(isDark);
      if (isDark) {
        document.body.classList.add('dark-mode');
      } else {
        document.body.classList.remove('dark-mode');
      }
   }, []);

   const toggleDarkMode = () => {
      setDarkMode((prev) => {
        const newMode = !prev;
        if (newMode) {
          document.body.classList.add('dark-mode');
        } else {
          document.body.classList.remove('dark-mode');
        }
        localStorage.setItem('darkMode', newMode);
        return newMode;
      });
   };

   // Close settings dropdown on outside click
   useEffect(() => {
      function handleClickOutside(event) {
        if (settingsRef.current && !settingsRef.current.contains(event.target)) {
          setSettingsOpen(false);
        }
      }
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
   }, []);

   if (!user) {
      return null
   }


   const handleLogout = () => {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      window.location.href = "/";
   }
   const handleOptionClick = (component) => {
      setSelectedComponent(component);
   };

   return (
      <Navbar expand="lg" className="premium-navbar" style={{backdropFilter:'blur(12px) saturate(1.2)', background:'rgba(30,41,59,0.82)', borderRadius:'0 0 18px 18px', boxShadow:'0 4px 24px #00e0ff22'}}>
         <Container fluid>
            <Navbar.Brand>
               <span className="brand-premium"><span className="brand-premium-L">L</span><span style={{color:'#0a2342', fontWeight:'bold'}}>earnhub</span></span>
            </Navbar.Brand>
            <Navbar.Toggle aria-controls="navbarScroll" />
            <Navbar.Collapse id="navbarScroll">
            <Nav className="me-auto my-2 my-lg-0 premium-nav-links" style={{ maxHeight: '100px', alignItems:'center', position: 'relative', zIndex: 1050 }} navbarScroll>
               <a className="premium-btn" href="/dashboard" style={{zIndex: 1051}}>Home</a>
               <div ref={settingsRef} style={{display:'inline-flex', alignItems:'center', position:'relative', zIndex: 1051}}>
                 <button
                   className="premium-btn"
                   style={{marginLeft: 8, marginRight: 8, borderRadius: 8, border: 'none', background: '#232526', color: '#fff', fontWeight: 700, padding: '6px 14px', boxShadow: '0 2px 8px #00e0ff33', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, zIndex: 1051}}
                   onClick={() => setSettingsOpen((open) => !open)}
                   aria-haspopup="true"
                   aria-expanded={settingsOpen}
                   tabIndex={0}
                 >
                   <span style={{fontSize: '1.3rem'}}>⚙️</span> <span className="d-none d-md-inline">Settings</span>
                 </button>
                 {settingsOpen && (
                   <div style={{position:'absolute', top:'110%', left:0, background:'#232526', color:'#fff', borderRadius:10, boxShadow:'0 2px 12px #00e0ff33', minWidth:180, zIndex:2000, padding:'12px 0', animation:'fadeInDropdown 0.25s cubic-bezier(.4,0,.2,1)'}}>
                     <button
                       className="darkmode-toggle-btn"
                       style={{width:'100%', background:'none', color:'#fff', border:'none', textAlign:'left', padding:'8px 18px', fontWeight:700, display:'flex', alignItems:'center', gap:8, cursor:'pointer'}}
                       onClick={() => { toggleDarkMode(); setSettingsOpen(false); }}
                     >
                       <span style={{fontSize:'1.2rem'}}>{darkMode ? '🌞' : '🌙'}</span> {darkMode ? 'Light Mode' : 'Dark Mode'}
                     </button>
                     <button
                       className="brightness-toggle-btn"
                       style={{width:'100%', background:'none', color:'#fff', border:'none', textAlign:'left', padding:'8px 18px', fontWeight:700, display:'flex', alignItems:'center', gap:8, cursor:'pointer'}}
                       onClick={() => {
                         const current = document.body.style.filter || '';
                         if (current.includes('brightness(1.2)')) {
                           document.body.style.filter = '';
                         } else {
                           document.body.style.filter = 'brightness(1.2)';
                         }
                         setSettingsOpen(false);
                       }}
                     >
                       <span style={{fontSize:'1.2rem'}}>💡</span> Toggle Brightness
                     </button>
                   </div>
                 )}
               </div>
                  {user.userData.type === 'Teacher' && (
                     <NavLink className="premium-btn" onClick={() => handleOptionClick('addcourse')}>Add Course</NavLink>
                  )}
                  {user.userData.type === 'Admin' && (
                     <NavLink className="premium-btn" onClick={() => handleOptionClick('cousres')}>Courses</NavLink>
                  )}
                  {user.userData.type === 'Student' && (
                     <NavLink className="premium-btn" onClick={() => handleOptionClick('enrolledcourese')}>Enrolled Courses</NavLink>
                  )}
               </Nav>
               <Nav className="premium-nav-links" style={{alignItems:'center'}}>
                  <h5 className='mx-3' style={{color:'#00e0ff', fontWeight:700, textShadow:'0 2px 12px #00e0ff55'}}>Hi {user.userData.name}</h5>
                  <Button onClick={handleLogout} size='sm' className='premium-btn' style={{background:'linear-gradient(90deg,#ff5858 0%,#f09819 100%)', color:'#fff', border:'none', boxShadow:'0 0 12px #ff585855'}}>
                    Log Out
                  </Button>
               </Nav>
               <SavedCoursesNavLink />
            </Navbar.Collapse>
         </Container>
      </Navbar>
   )
}

export default NavBar

