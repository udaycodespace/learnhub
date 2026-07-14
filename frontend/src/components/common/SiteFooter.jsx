import React from "react";
import { Link } from "react-router-dom";

const SiteFooter = () => {
  const year = new Date().getFullYear();

  return (
    <footer className="site-footer" id="contact">
      <div className="site-footer-top">
        <div className="footer-brand-column">
          <Link className="footer-brand" to="/">
            <span aria-hidden="true">L</span>
            <strong>LearnHub</strong>
          </Link>
          <p>
            A practical video-learning platform for students who want to keep
            moving, finish courses, and show what they learned.
          </p>
        </div>

        <div className="footer-column">
          <h2>Explore</h2>
          <a href="/#course-catalog">Courses</a>
          <Link to="/register">Create account</Link>
          <Link to="/login">Sign in</Link>
        </div>

        <div className="footer-column">
          <h2>LearnHub</h2>
          <a href="/#about">About</a>
          <a href="mailto:hello@learnhub.example">Contact</a>
          <a
            href="https://github.com/udaycodespace/learnhub"
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>
        </div>

        <div className="footer-column">
          <h2>Legal</h2>
          <Link to="/privacy">Privacy Policy</Link>
          <Link to="/terms">Terms & Conditions</Link>
          <span className="coming-soon">Legal content coming soon</span>
        </div>
      </div>

      <div className="site-footer-bottom">
        <span>© {year} LearnHub</span>
        <span>Built for learners who finish what they start.</span>
      </div>
    </footer>
  );
};

export default SiteFooter;
