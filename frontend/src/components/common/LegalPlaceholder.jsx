import React from "react";
import { Link } from "react-router-dom";

const LegalPlaceholder = ({ title }) => (
  <main className="legal-page">
    <Link to="/" className="legal-back">
      ← Back to LearnHub
    </Link>
    <p className="eyebrow">LEGAL</p>
    <h1>{title}</h1>
    <p>
      This page structure is ready. The final legal content is coming soon and
      will be added in a separate update.
    </p>
  </main>
);

export default LegalPlaceholder;
