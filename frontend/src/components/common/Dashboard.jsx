import React, { useContext } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Container } from 'react-bootstrap';

import NavBar from './NavBar';
import UserHome from './UserHome';
import AddCourse from '../user/teacher/AddCourse';
import EnrolledCourses from '../user/student/EnrolledCourses';
import AllCourses from '../admin/AllCourses';
import AccountPanel from './AccountPanel';
import { UserContext } from '../../App';
import { PANELS, readPanelFromSearch, resolvePanel } from '../../lib/dashboardPanels';

// #105. The panel used to live in this component's useState, and the setter was
// handed to NavBar as a prop:
//
//   const [selectedComponent, setSelectedComponent] = useState('home');
//   <NavBar setSelectedComponent={setSelectedComponent} />
//
// Only this file passed it, so the same navbar rendered from CourseContent.jsx
// threw on every one of those links. The panel is read from the query string
// now: the navbar navigates like anything else, works wherever it is rendered,
// and each panel has an address a reload can restore.
//
// resolvePanel does what the old switch did through its `default:` and its two
// role guards — an unknown panel, or one this account may not use, falls back
// to home. It matters more now, because the value can be typed into the address
// bar rather than only coming from a click.
//
// The old switch also carried a `case 'cousreSection': return <CourseContent />`
// that nothing could reach: no caller ever set that name, and CourseContent
// reads :courseId and :courseTitle from the route, which /dashboard does not
// have. It is gone rather than ported. The course player is reached at
// /courseSection/:courseId/:courseTitle, as it already was.

const Dashboard = () => {
   const user = useContext(UserContext);
   const [searchParams] = useSearchParams();

   const panel = resolvePanel(
      readPanelFromSearch(searchParams),
      user?.userData,
   );

   const renderPanel = () => {
      switch (panel) {
         case PANELS.ADD_COURSE:
            return <AddCourse />;

         case PANELS.ENROLLED:
            return <EnrolledCourses />;

         case PANELS.COURSES:
            return <AllCourses />;

         case PANELS.ACCOUNT:
            return <AccountPanel />;

         case PANELS.HOME:
         default:
            return <UserHome />;
      }
   };

   return (
      <>
         <NavBar />
         <Container
            className='my-3 dashboard-glass'
            style={{
               maxWidth: '1100px',
               borderRadius: '22px',
               boxShadow: '0 8px 32px 0 #00e0ff22',
               background: 'rgba(30,41,59,0.82)',
               padding: '32px 24px',
            }}
         >
            {renderPanel()}
         </Container>
      </>
   );
};

export default Dashboard;
