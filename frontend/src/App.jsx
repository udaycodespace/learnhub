import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { createContext, useMemo } from "react";
import "./App.css";

import Home from "./components/common/Home";
import Login from "./components/common/Login";
import Register from "./components/common/Register";
import Dashboard from "./components/common/Dashboard";
import CourseContent from "./components/user/student/CourseContent";
import SiteFooter from "./components/common/SiteFooter";
import LegalPlaceholder from "./components/common/LegalPlaceholder";
import NotFound from "./components/common/NotFound";
import {
  BookmarksProvider,
} from "./context/BookmarksContext";

import SavedCourses from "./components/bookmarks/SavedCourses";
import AdminLogin from "./components/admin/AdminLogin";

import { AuthProvider } from "./auth/AuthProvider";
import { ThemeProvider } from "./theme/ThemeProvider";
import { useAuth } from "./auth/authContext";
import { ProtectedRoute, PublicOnlyRoute } from "./auth/ProtectedRoute";
import { BOOKMARK_ROLES } from "./lib/bookmarkAccess";

// Still exported with its original { userData, userLoggedIn } shape: NavBar,
// Dashboard, UserHome, AllCourses, AddCourse and CourseContent all read it and
// none of them needed to change. It is now fed from the validated session
// rather than from whatever happened to be in localStorage.
export const UserContext = createContext();

function AppRoutes() {
  const { user, isAuthenticated } = useAuth();

  const legacyUserValue = useMemo(
    () => ({ userData: user, userLoggedIn: isAuthenticated }),
    [user, isAuthenticated],
  );

  return (
    <UserContext.Provider value={legacyUserValue}>
      <div className="content">
        <Routes>
          <Route path="/" element={<Home />} />

          <Route
            path="/login"
            element={
              <PublicOnlyRoute>
                <Login />
              </PublicOnlyRoute>
            }
          />
          <Route
            path="/register"
            element={
              <PublicOnlyRoute>
                <Register />
              </PublicOnlyRoute>
            }
          />

          {/* #125. The admin dashboard had no way in. POST /api/admin/login is
              the only issuer of a token carrying role: "admin", and nothing
              called it — no route, no form, no link — while #55 stopped any
              registered account from holding the role. PublicOnlyRoute, like
              /login, so a signed-in visitor is sent on rather than shown a
              second sign-in form. */}
          <Route
            path="/admin/login"
            element={
              <PublicOnlyRoute>
                <AdminLogin />
              </PublicOnlyRoute>
            }
          />

          <Route
            path="/privacy"
            element={<LegalPlaceholder title="Privacy Policy" />}
          />
          <Route
            path="/terms"
            element={<LegalPlaceholder title="Terms & Conditions" />}
          />

          {/* Bookmarks are a student-only feature on the API side, so the
              route says so instead of letting the page mount and fail. The
              list comes from lib/bookmarkAccess rather than being written out
              here, because the navbar and the provider read the same value —
              a guard that disagrees with what the UI offers is #115. */}
          <Route
            path="/saved-courses"
            element={
              <ProtectedRoute allowedRoles={BOOKMARK_ROLES}>
                <SavedCourses />
              </ProtectedRoute>
            }
          />

          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/courseSection/:courseId/:courseTitle"
            element={
              <ProtectedRoute>
                <CourseContent />
              </ProtectedRoute>
            }
          />

          <Route path="*" element={<NotFound />} />
        </Routes>
      </div>
      <SiteFooter />
    </UserContext.Provider>
  );
}

function App() {
  return (
    <div className="App">
      {/* Outermost, because the theme applies to every page including the
          ones that render no navbar at all — which is why dark mode did not
          exist for a signed-out visitor. */}
      <ThemeProvider>
        <AuthProvider>
          <BookmarksProvider>
            <Router>
              <AppRoutes />
            </Router>
          </BookmarksProvider>
        </AuthProvider>
      </ThemeProvider>
    </div>
  );
}

export default App;
