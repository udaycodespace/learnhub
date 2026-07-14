// import React, { useState } from 'react';
// import NavBar from './NavBar';
// import UserHome from "./UserHome"
// import { Container } from 'react-bootstrap';
// import AddCourse from '../user/teacher/AddCourse';

// const Dashboard = () => {
//    const [selectedComponent, setSelectedComponent] = useState('home');

//    const renderSelectedComponent = () => {
//       switch (selectedComponent) {
//          case 'home':
//             return <UserHome />
//          case 'addcourse':
//            return <AddCourse />
//          default:
//             return <UserHome />

//       }
//    };

//    return (
//       <>
//          <NavBar setSelectedComponent={setSelectedComponent} />
//          <Container className='my-3'>
//             {renderSelectedComponent()}
//          </Container>
//       </>
//    );
// };

// export default Dashboard;


import React, { useContext, useState } from 'react';
import NavBar from './NavBar';
import UserHome from "./UserHome"
import { Container } from 'react-bootstrap';
import AddCourse from '../user/teacher/AddCourse';
import StudentHome from '../user/student/StudentHome';
import AdminHome from '../admin/AdminHome';
import { UserContext } from '../../App';
import EnrolledCourses from '../user/student/EnrolledCourses';
import CourseContent from '../user/student/CourseContent';
import AllCourses from '../admin/AllCourses';


const Dashboard = () => {
   const user = useContext(UserContext)
   const [selectedComponent, setSelectedComponent] = useState('home');

   const renderSelectedComponent = () => {
      const userType = user?.userData?.type;
      switch (selectedComponent) {
         case 'home':
            return <UserHome />
         case 'addcourse':
            if (userType === 'Teacher' || userType === 'Admin') {
               return <AddCourse />
            }
            return <UserHome />
         case 'enrolledcourese':
            return <EnrolledCourses />
         case 'cousreSection':
            return <CourseContent />
         case 'cousres':
            if (userType === 'Admin') {
               return <AllCourses />
            }
            return <UserHome />
         default:
            return <UserHome />

      }
   };
   return (
      <>
         <NavBar setSelectedComponent={setSelectedComponent} />
         <Container className='my-3 dashboard-glass' style={{maxWidth:'1100px', borderRadius:'22px', boxShadow:'0 8px 32px 0 #00e0ff22', background:'rgba(30,41,59,0.82)', padding:'32px 24px'}}>
            {renderSelectedComponent()}
         </Container>
      </>
   );
};

export default Dashboard;


