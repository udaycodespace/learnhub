import React, { useContext, useState, useEffect, useRef } from 'react'
import { Navbar, Nav, Button, Container } from 'react-bootstrap';
import { UserContext } from '../../App';
import { Link } from 'react-router-dom';
import SavedCoursesNavLink from "../bookmarks/SavedCoursesNavLink";
import ThemeToggle from "../../theme/ThemeToggle";
import axiosInstance, { clearSession } from "./AxiosInstance";
import { panelPath, visiblePanelLinks } from "../../lib/dashboardPanels";
import { canUseBookmarks } from "../../lib/bookmarkAccess";

// #105. These links used to call a prop:
//
//   const NavBar = ({ setSelectedComponent }) => {
//      const handleOptionClick = (component) => setSelectedComponent(component);
//
// Only Dashboard.jsx passed it. CourseContent.jsx renders `<NavBar />` bare, so
// on the course player every one of them threw `TypeError:
// setSelectedComponent is not a function` on click, and because the handler
// runs before React Router's own click handling nothing navigated either — the
// link was simply dead, on the page a student spends the whole course on.
//
// They were also `<NavLink>` elements with no `to`, which React Router resolves
// against the current location: they rendered as links pointing at the page you
// were already on, unusable by middle click or "open in new tab". `Home` was a
// raw `<a href>`, a full document load that tore down every provider.
//
// The panel is part of the URL now, so the navbar navigates like any other
// link, works on every page that renders it, and needs no prop at all.

const NavBar = () => {

   const user = useContext(UserContext)
   const [settingsOpen, setSettingsOpen] = useState(false);
   const settingsRef = useRef();

   // The theme used to live in this component's local state, applied in a
   // useEffect and stored under a third localStorage key written as a boolean
   // and read back as a string. It belongs to the whole application, not to a
   // navbar that renders for signed-in users only, so it moved to
   // ThemeProvider (#97).

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

   // The context value is always an object, so the old `if (!user)` never
   // fired. What actually needs guarding is userData, which is null whenever
   // there is no session.
   if (!user?.userData) {
      return null
   }


   // Rendered from lib/dashboardPanels, which is the same list Dashboard
   // validates the incoming panel against — the navbar cannot advertise a link
   // the dashboard would refuse to open.
   const panelLinks = visiblePanelLinks(user.userData);

   // The Saved link was the one navbar entry outside the rule the panel links
   // follow. It rendered for every signed-in account, and `/saved-courses` is
   // guarded to students — so an educator clicking it went to the guard and
   // straight back to /dashboard, having also produced a 403 in the console
   // on every page load from BookmarksProvider (#115).
   const showSavedCourses = canUseBookmarks(user.userData);

   const handleLogout = async () => {
      // Tell the server first, so the sign-out is recorded — the activity log
      // has always had a "logout" action and a filter for it, and nothing ever
      // wrote one. Best effort on purpose: signing out locally must not depend
      // on the request succeeding, so a failure is swallowed and the session is
      // cleared either way.
      try {
         await axiosInstance.post("/api/user/logout");
      } catch {
         // Already signed out, offline, or the server is down. Carry on.
      }

      clearSession();
      window.location.href = "/";
   }
   return (
      <Navbar expand="lg" className="premium-navbar" style={{backdropFilter:'blur(12px) saturate(1.2)', background:'rgba(30,41,59,0.82)', borderRadius:'0 0 18px 18px', boxShadow:'0 4px 24px #00e0ff22', position:'relative', zIndex: 1040}}>
         <Container fluid>
            <Navbar.Brand>
               <span className="brand-premium"><span className="brand-premium-L">L</span><span style={{fontWeight:'bold'}}>earnhub</span></span>
            </Navbar.Brand>
            <Navbar.Toggle aria-controls="navbarScroll" />
            <Navbar.Collapse id="navbarScroll">
            <Nav className="me-auto my-2 my-lg-0 premium-nav-links" style={{ maxHeight: '100px', alignItems:'center', position: 'relative', zIndex: 1050 }} navbarScroll>
               {/* A <Link>, not an <a href>. Inside a BrowserRouter the anchor
                   was a full document load that tore down AuthProvider,
                   BookmarksProvider and ThemeProvider and re-fetched
                   everything. */}
               <Link className="premium-btn" to="/dashboard" style={{zIndex: 1051}}>Home</Link>
               <div ref={settingsRef} style={{display:'inline-flex', alignItems:'center', position:'relative', zIndex: 1051}}>
                 <button
                   className="premium-btn settings-btn"
                   style={{marginLeft: 8, marginRight: 8, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, zIndex: 1051}}
                   onClick={() => setSettingsOpen((open) => !open)}
                   aria-haspopup="true"
                   aria-expanded={settingsOpen}
                   tabIndex={0}
                 >
                   <span aria-hidden="true" style={{fontSize: '1.3rem'}}>⚙️</span> <span className="d-none d-md-inline">Settings</span>
                 </button>
                 {settingsOpen && (
                   <div className="settings-dropdown" style={{position:'absolute', top:'110%', left:0, minWidth:200, zIndex:2000}}>
                     <p className="settings-dropdown-heading">Appearance</p>
                     {/* The same control the signed-out navbar renders, so the
                         preference is reachable from every page rather than
                         only from a menu that needs a session. The old
                         "Toggle Brightness" button next to it wrote
                         document.body.style.filter inline, was never
                         persisted, and was undone by any full navigation. */}
                     <ThemeToggle className="theme-toggle-block" />
                   </div>
                 )}
               </div>
                  {/* Real links to real addresses. Each one is reachable by
                      keyboard, can be opened in a new tab, and survives a
                      reload — none of which was true while the panel lived in
                      one component's useState.

                      The role comparison still goes through lib/roles (#84);
                      it has moved into visiblePanelLinks so the navbar and the
                      dashboard cannot disagree about who may see what. */}
                  {panelLinks.map(({ panel, label }) => (
                     <Link
                        key={panel}
                        className="premium-btn"
                        to={panelPath(panel)}
                     >
                        {label}
                     </Link>
                  ))}
               </Nav>
               <Nav className="premium-nav-links" style={{alignItems:'center'}}>
                  <h5 className='mx-3' style={{color:'#00e0ff', fontWeight:700, textShadow:'0 2px 12px #00e0ff55', margin:0, display:'flex', alignItems:'center'}}>Hi {user.userData.name}</h5>
                  {showSavedCourses ? (
                     <SavedCoursesNavLink className="me-3" />
                  ) : null}
                  <Button onClick={handleLogout} size='sm' className='logout-btn' style={{background:'linear-gradient(90deg,#ff5858 0%,#f09819 100%)', color:'#fff', border:'none', boxShadow:'0 0 12px #ff585855'}}>
                    Log Out
                  </Button>
               </Nav>
            </Navbar.Collapse>
         </Container>
      </Navbar>
   )
}

export default NavBar

