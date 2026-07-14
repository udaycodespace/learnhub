import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { useState, useEffect, createContext } from "react";
import "./App.css";

import Home from "./components/common/Home";
import Login from "./components/common/Login";
import Register from "./components/common/Register";
import Dashboard from "./components/common/Dashboard";
import CourseContent from "./components/user/student/CourseContent";
import SiteFooter from "./components/common/SiteFooter";
import LegalPlaceholder from "./components/common/LegalPlaceholder";

export const UserContext = createContext();

function App() {
  const [userData, setUserData] = useState();
  const [userLoggedIn, setUserLoggedIn] = useState(false);

  const getData = async () => {
    try {
      const user = JSON.parse(localStorage.getItem("user"));

      if (user) {
        setUserData(user);
        setUserLoggedIn(true);
      }
    } catch (error) {
      console.log(error);
    }
  };

  useEffect(() => {
    getData();
  }, []);

  return (
    <UserContext.Provider value={{ userData, userLoggedIn }}>
      <div className="App">
        <Router>
          <div className="content">
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />
              <Route
                path="/privacy"
                element={<LegalPlaceholder title="Privacy Policy" />}
              />
              <Route
                path="/terms"
                element={<LegalPlaceholder title="Terms & Conditions" />}
              />

              {userLoggedIn ? (
                <>
                  <Route path="/dashboard" element={<Dashboard />} />
                  <Route
                    path="/courseSection/:courseId/:courseTitle"
                    element={<CourseContent />}
                  />
                </>
              ) : (
                <Route path="/login" element={<Login />} />
              )}
            </Routes>
          </div>
          <SiteFooter />
        </Router>
      </div>
    </UserContext.Provider>
  );
}

export default App;
