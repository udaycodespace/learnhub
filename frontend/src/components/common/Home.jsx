import React from "react";
import { Link } from "react-router-dom";
import AllCourses from "./AllCourses";

const learningTracks = [
  {
    number: "01",
    title: "Learn with direction",
    text: "Browse practical courses shaped around clear outcomes, not endless playlists.",
  },
  {
    number: "02",
    title: "Build steady momentum",
    text: "Move through lectures at your own pace and keep progress visible.",
  },
  {
    number: "03",
    title: "Finish with proof",
    text: "Complete a course and download a certificate that marks the work you did.",
  },
];

const Home = () => {
  const scrollToCourses = () => {
    document
      .getElementById("course-catalog")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <main className="landing-page">
      <header className="landing-nav">
        <Link className="landing-brand" to="/" aria-label="LearnHub home">
          <span className="landing-brand-mark" aria-hidden="true">
            L
          </span>
          <span>
            <strong>LearnHub</strong>
            <small>Skills that move with you</small>
          </span>
        </Link>

        <nav className="landing-nav-links" aria-label="Primary navigation">
          <button type="button" className="nav-text-link" onClick={scrollToCourses}>
            Courses
          </button>
          <a className="nav-text-link" href="#about">
            About
          </a>
          <a className="nav-text-link" href="#contact">
            Contact
          </a>
        </nav>

        <div className="landing-nav-actions">
          <Link className="button button-quiet" to="/login">
            Sign in
          </Link>
          <Link className="button button-ink" to="/register">
            Start learning
          </Link>
        </div>
      </header>

      <section className="landing-hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <p className="eyebrow">
            A learning space for students, builders, and curious minds
          </p>
          <h1 id="hero-title">
            Turn spare hours into
            <span> useful skills.</span>
          </h1>
          <p className="hero-description">
            LearnHub brings video courses, progress tracking, and completion
            certificates into one focused workspace—so you can choose a path,
            keep moving, and finish what you start.
          </p>

          <div className="hero-actions">
            <button type="button" className="button button-coral" onClick={scrollToCourses}>
              Explore the catalog
              <span aria-hidden="true">↘</span>
            </button>
            <Link className="button button-outline" to="/register">
              Create free account
            </Link>
          </div>

          <div className="hero-proof" aria-label="Platform highlights">
            <div>
              <strong>Video-first</strong>
              <span>Learn by watching and doing</span>
            </div>
            <div>
              <strong>Self-paced</strong>
              <span>Pick up where you left off</span>
            </div>
            <div>
              <strong>Completion proof</strong>
              <span>Downloadable certificates</span>
            </div>
          </div>
        </div>

        <div className="hero-art" aria-label="A visual preview of learning on LearnHub">
          <div className="hero-orbit hero-orbit-one" aria-hidden="true" />
          <div className="hero-orbit hero-orbit-two" aria-hidden="true" />

          <article className="hero-feature-card">
            <div className="hero-feature-topline">
              <span className="mini-label">CURRENT PATH</span>
              <span className="mini-status">IN PROGRESS</span>
            </div>
            <div className="hero-course-illustration" aria-hidden="true">
              <span className="illustration-grid" />
              <span className="illustration-disc" />
              <span className="illustration-arrow">↗</span>
            </div>
            <p className="hero-course-category">DEVELOPMENT · 12 LESSONS</p>
            <h2>Build modern web experiences</h2>
            <div className="progress-row">
              <span>7 lessons completed</span>
              <strong>58%</strong>
            </div>
            <div className="progress-track">
              <span style={{ width: "58%" }} />
            </div>
          </article>

          <div className="floating-note floating-note-top">
            <span aria-hidden="true">✦</span>
            <div>
              <strong>One clear next step</strong>
              <small>Continue lesson 08</small>
            </div>
          </div>

          <div className="floating-note floating-note-bottom">
            <span className="certificate-seal" aria-hidden="true">✓</span>
            <div>
              <strong>Finish with proof</strong>
              <small>Certificates on completion</small>
            </div>
          </div>
        </div>
      </section>

      <section className="learning-method" id="about" aria-labelledby="method-title">
        <div className="section-heading compact">
          <p className="eyebrow">A SMALLER, BETTER LEARNING LOOP</p>
          <h2 id="method-title">Choose. Continue. Complete.</h2>
        </div>

        <div className="method-grid">
          {learningTracks.map((track) => (
            <article key={track.number} className="method-card">
              <span>{track.number}</span>
              <h3>{track.title}</h3>
              <p>{track.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="course-catalog" className="catalog-section" aria-labelledby="catalog-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">TRENDING NOW</p>
            <h2 id="catalog-title">Find your next useful skill.</h2>
          </div>
          <p>
            A focused catalog of practical courses from educators who want to
            help you make real progress.
          </p>
        </div>

        <AllCourses />
      </section>

      <section className="landing-cta" aria-labelledby="cta-title">
        <div>
          <p className="eyebrow">YOUR NEXT CHAPTER CAN START SMALL</p>
          <h2 id="cta-title">One course. One hour. One step forward.</h2>
        </div>
        <Link className="button button-paper" to="/register">
          Join LearnHub
          <span aria-hidden="true">→</span>
        </Link>
      </section>
    </main>
  );
};

export default Home;
