import React, { useCallback, useEffect, useState } from "react";
import axiosInstance, { getToken } from "../common/AxiosInstance";
import "./CourseForum.css";

const emptyStats = {
  totalQuestions: 0,
  resolved: 0,
  unanswered: 0,
  totalAnswers: 0,
  totalViews: 0,
};

const formatDate = (value) =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

const formatRelativeTime = (value) => {
  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(value);
};

const CourseForum = ({ courseId, courseTitle }) => {
  const token = getToken();

  // ── List state ─────────────────────────────────────
  const [view, setView] = useState("list");
  const [questions, setQuestions] = useState([]);
  const [stats, setStats] = useState(emptyStats);
  const [pagination, setPagination] = useState({
    page: 1,
    totalPages: 1,
    totalItems: 0,
    hasPreviousPage: false,
    hasNextPage: false,
  });
  const [sort, setSort] = useState("newest");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // ── Detail state ───────────────────────────────────
  const [selectedQuestion, setSelectedQuestion] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [answerBody, setAnswerBody] = useState("");
  const [answerSaving, setAnswerSaving] = useState(false);

  // ── New question form ──────────────────────────────
  const [showNewForm, setShowNewForm] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newBody, setNewBody] = useState("");
  const [newTags, setNewTags] = useState("");
  const [saving, setSaving] = useState(false);

  // ── Load list ──────────────────────────────────────

  const loadStats = useCallback(async () => {
    if (!courseId) return;
    try {
      const res = await axiosInstance.get(`/api/forum/stats/${courseId}`);
      setStats(res.data.data || emptyStats);
    } catch {
      /* stats are non-critical */
    }
  }, [courseId]);

  const loadQuestions = useCallback(async () => {
    if (!courseId) return;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: "10",
        sort,
      });
      if (search.trim()) params.set("search", search.trim());

      const res = await axiosInstance.get(
        `/api/forum/${courseId}?${params.toString()}`,
      );
      setQuestions(res.data.data || []);
      setPagination(res.data.pagination);
      await loadStats();
    } catch (err) {
      setError(err.response?.data?.message || "Could not load discussions.");
    } finally {
      setLoading(false);
    }
  }, [courseId, page, sort, search, loadStats]);

  useEffect(() => {
    loadQuestions();
  }, [loadQuestions]);

  // ── Load single question detail ────────────────────

  const openQuestion = async (questionId) => {
    setDetailLoading(true);
    setError("");
    setNotice("");
    try {
      const res = await axiosInstance.get(`/api/forum/q/${questionId}`);
      setSelectedQuestion(res.data.data);
      setAnswerBody("");
      setView("detail");
    } catch (err) {
      setError(err.response?.data?.message || "Could not load question.");
    } finally {
      setDetailLoading(false);
    }
  };

  // ── Create question ────────────────────────────────

  const submitQuestion = async (event) => {
    event.preventDefault();
    setError("");
    setNotice("");

    if (newTitle.trim().length < 5) {
      setError("Title must be at least 5 characters.");
      return;
    }
    if (newBody.trim().length < 10) {
      setError("Body must be at least 10 characters.");
      return;
    }

    setSaving(true);
    try {
      const tags = newTags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);

      const res = await axiosInstance.post(`/api/forum/${courseId}`, {
        title: newTitle.trim(),
        body: newBody.trim(),
        tags,
      });

      setNotice(res.data.message);
      setShowNewForm(false);
      setNewTitle("");
      setNewBody("");
      setNewTags("");
      setPage(1);
      setSort("newest");
      await loadQuestions();
    } catch (err) {
      setError(err.response?.data?.message || "Could not post question.");
    } finally {
      setSaving(false);
    }
  };

  // ── Submit answer ──────────────────────────────────

  const submitAnswer = async (event) => {
    event.preventDefault();
    if (!selectedQuestion) return;
    setError("");

    if (answerBody.trim().length < 5) {
      setError("Answer must be at least 5 characters.");
      return;
    }

    setAnswerSaving(true);
    try {
      await axiosInstance.post(
        `/api/forum/q/${selectedQuestion.id}/answers`,
        { body: answerBody.trim() },
      );
      setAnswerBody("");
      await openQuestion(selectedQuestion.id);
    } catch (err) {
      setError(err.response?.data?.message || "Could not post answer.");
    } finally {
      setAnswerSaving(false);
    }
  };

  // ── Delete question ────────────────────────────────

  const deleteQuestion = async (questionId) => {
    if (!window.confirm("Delete this question permanently?")) return;
    setError("");
    try {
      await axiosInstance.delete(`/api/forum/q/${questionId}`);
      setNotice("Question deleted.");
      setView("list");
      setSelectedQuestion(null);
      await loadQuestions();
    } catch (err) {
      setError(err.response?.data?.message || "Could not delete question.");
    }
  };

  // ── Delete answer ──────────────────────────────────

  const deleteAnswer = async (questionId, answerId) => {
    if (!window.confirm("Delete this answer?")) return;
    setError("");
    try {
      await axiosInstance.delete(
        `/api/forum/q/${questionId}/answers/${answerId}`,
      );
      await openQuestion(questionId);
    } catch (err) {
      setError(err.response?.data?.message || "Could not delete answer.");
    }
  };

  // ── Accept answer ──────────────────────────────────

  const toggleAcceptAnswer = async (questionId, answerId) => {
    setError("");
    try {
      await axiosInstance.put(
        `/api/forum/q/${questionId}/answers/${answerId}/accept`,
      );
      await openQuestion(questionId);
    } catch (err) {
      setError(
        err.response?.data?.message || "Could not update acceptance.",
      );
    }
  };

  // ── Upvote answer ──────────────────────────────────

  const toggleUpvoteAnswer = async (questionId, answerId) => {
    if (!token) return;
    setError("");
    try {
      await axiosInstance.post(
        `/api/forum/q/${questionId}/answers/${answerId}/upvote`,
      );
      await openQuestion(questionId);
    } catch (err) {
      setError(err.response?.data?.message || "Could not update upvote.");
    }
  };

  // ── Helpers ────────────────────────────────────────

  const getAnswerCountClass = (question) => {
    if (question.isResolved) return "has-accepted";
    if (question.answerCount > 0) return "has-answers";
    return "";
  };

  const canDelete = (question) => {
    if (!token || !question) return false;
    const userId = JSON.parse(localStorage.getItem("user") || "{}")?._id;
    return (
      question.isOwner || question.user.id === userId
    );
  };

  const goBack = () => {
    setView("list");
    setSelectedQuestion(null);
    setError("");
    setNotice("");
  };

  // ── Render: List View ──────────────────────────────

  if (view === "detail") {
    return (
      <section className="course-forum" aria-labelledby="forum-detail-title">
        <button className="forum-back-link" onClick={goBack}>
          ← Back to discussions
        </button>

        {detailLoading ? (
          <div className="forum-loading" role="status">
            Loading question…
          </div>
        ) : !selectedQuestion ? (
          <div className="forum-error" role="alert">
            Question not found.
          </div>
        ) : (
          <article className="forum-question-detail">
            <div className="forum-detail-header">
              <div style={{ flex: 1 }}>
                <h2 id="forum-detail-title" className="forum-detail-title">
                  {selectedQuestion.title}
                </h2>
                <div className="forum-question-footer" style={{ marginTop: "0.5rem" }}>
                  {selectedQuestion.tags.map((tag) => (
                    <span key={tag} className="forum-tag">{tag}</span>
                  ))}
                  {selectedQuestion.isResolved && (
                    <span className="forum-resolved-badge">✓ Resolved</span>
                  )}
                  <span className="forum-question-author">
                    Asked by <strong>{selectedQuestion.user.name}</strong>{" "}
                    · {formatRelativeTime(selectedQuestion.createdAt)}{" "}
                    · {selectedQuestion.viewCount} views
                  </span>
                </div>
              </div>

              {canDelete(selectedQuestion) && (
                <div className="forum-detail-actions">
                  <button
                    className="forum-btn forum-btn-ghost"
                    onClick={() => deleteQuestion(selectedQuestion.id)}
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>

            <p className="forum-detail-body">{selectedQuestion.body}</p>

            {error && (
              <div className="forum-error" role="alert">{error}</div>
            )}
            {notice && (
              <div className="forum-notice" role="status">{notice}</div>
            )}

            <h3 className="forum-answers-header">
              {selectedQuestion.answers.length}{" "}
              {selectedQuestion.answers.length === 1 ? "Answer" : "Answers"}
            </h3>

            {selectedQuestion.answers.map((answer) => (
              <article
                key={answer.id}
                className={`forum-answer-card${answer.isAccepted ? " accepted" : ""}`}
              >
                <div className="forum-answer-header">
                  <span>
                    <strong>{answer.user.name}</strong> ·{" "}
                    {formatRelativeTime(answer.createdAt)}
                    {answer.user.type === "teacher" && (
                      <span className="forum-tag" style={{ marginLeft: 6 }}>
                        Instructor
                      </span>
                    )}
                  </span>
                </div>

                <p className="forum-answer-body">{answer.body}</p>

                <div className="forum-answer-actions">
                  {token && (
                    <button
                      className={`forum-upvote-btn${answer.hasUpvoted ? " active" : ""}`}
                      onClick={() =>
                        toggleUpvoteAnswer(selectedQuestion.id, answer.id)
                      }
                    >
                      ▲ {answer.upvotes}
                    </button>
                  )}

                  {selectedQuestion.isOwner && (
                    <button
                      className={`forum-accept-btn${answer.isAccepted ? " accepted" : ""}`}
                      onClick={() =>
                        toggleAcceptAnswer(selectedQuestion.id, answer.id)
                      }
                    >
                      {answer.isAccepted ? "✓ Accepted" : "Accept"}
                    </button>
                  )}

                  {answer.isOwner && (
                    <button
                      className="forum-btn forum-btn-ghost"
                      style={{ fontSize: "0.8rem", padding: "0.2rem 0.5rem" }}
                      onClick={() =>
                        deleteAnswer(selectedQuestion.id, answer.id)
                      }
                    >
                      Delete
                    </button>
                  )}
                </div>
              </article>
            ))}

            {token ? (
              <div className="forum-post-answer">
                <h3>Your Answer</h3>
                <form onSubmit={submitAnswer}>
                  <textarea
                    value={answerBody}
                    onChange={(e) =>
                      setAnswerBody(e.target.value.slice(0, 2000))
                    }
                    placeholder="Write your answer here…"
                  />
                  <small>{answerBody.length}/2000</small>
                  <div className="forum-form-actions">
                    <button
                      type="submit"
                      className="forum-btn forum-btn-primary"
                      disabled={answerSaving}
                    >
                      {answerSaving ? "Posting…" : "Post Answer"}
                    </button>
                  </div>
                </form>
              </div>
            ) : (
              <div className="forum-auth-message">
                Sign in to post an answer.
              </div>
            )}
          </article>
        )}
      </section>
    );
  }

  // ── Render: List View ──────────────────────────────

  return (
    <section className="course-forum" aria-labelledby="forum-title">
      <header className="course-forum-header">
        <div>
          <p style={{ fontSize: "0.75rem", textTransform: "uppercase", color: "#6b7280", margin: 0 }}>
            COURSE Q&A
          </p>
          <h2 id="forum-title">
            Discussions for {courseTitle || "this course"}
          </h2>
        </div>

        <div className="forum-stats-bar">
          <div className="forum-stat">
            <strong>{stats.totalQuestions}</strong>
            <span>Questions</span>
          </div>
          <div className="forum-stat">
            <strong>{stats.resolved}</strong>
            <span>Resolved</span>
          </div>
          <div className="forum-stat">
            <strong>{stats.totalAnswers}</strong>
            <span>Answers</span>
          </div>
        </div>
      </header>

      {token ? (
        <div className="forum-new-question">
          {showNewForm ? (
            <form onSubmit={submitQuestion}>
              <label>
                <span>Title</span>
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value.slice(0, 200))}
                  placeholder="What's your question?"
                  maxLength={200}
                />
              </label>
              <label>
                <span>Details</span>
                <textarea
                  value={newBody}
                  onChange={(e) => setNewBody(e.target.value.slice(0, 5000))}
                  placeholder="Provide as much detail as possible…"
                  rows={4}
                  maxLength={5000}
                />
                <small>{newBody.length}/5000</small>
              </label>
              <label>
                <span>Tags (comma-separated, optional)</span>
                <input
                  type="text"
                  value={newTags}
                  onChange={(e) => setNewTags(e.target.value)}
                  placeholder="e.g. javascript, react, debugging"
                />
              </label>
              <div className="forum-form-actions">
                <button
                  type="button"
                  className="forum-btn forum-btn-ghost"
                  onClick={() => {
                    setShowNewForm(false);
                    setNewTitle("");
                    setNewBody("");
                    setNewTags("");
                    setError("");
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="forum-btn forum-btn-primary"
                  disabled={saving}
                >
                  {saving ? "Posting…" : "Post Question"}
                </button>
              </div>
            </form>
          ) : (
            <button
              className="forum-btn forum-btn-primary"
              onClick={() => setShowNewForm(true)}
            >
              Ask a Question
            </button>
          )}
        </div>
      ) : (
        <div className="forum-auth-message">
          Sign in with an enrolled account to ask questions or post answers.
        </div>
      )}

      <div className="forum-toolbar">
        <input
          type="search"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Search discussions…"
        />
        <select
          value={sort}
          onChange={(e) => {
            setSort(e.target.value);
            setPage(1);
          }}
        >
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
          <option value="unanswered">Unanswered</option>
          <option value="popular">Most viewed</option>
        </select>
      </div>

      {error && (
        <div className="forum-error" role="alert">{error}</div>
      )}

      {notice && (
        <div className="forum-notice" role="status">{notice}</div>
      )}

      {loading ? (
        <div className="forum-loading" role="status">Loading discussions…</div>
      ) : questions.length === 0 ? (
        <div className="forum-empty">
          <strong>No questions yet</strong>
          <p>Be the first to start a discussion about this course.</p>
        </div>
      ) : (
        <div className="forum-question-list">
          {questions.map((q) => (
            <article
              key={q.id}
              className={`forum-question-card${q.isResolved ? " resolved" : ""}`}
              onClick={() => openQuestion(q.id)}
            >
              <div className="forum-question-meta">
                <span className={`answer-count ${getAnswerCountClass(q)}`}>
                  {q.answerCount}
                </span>
                <span>answers</span>
              </div>

              <div className="forum-question-body">
                <h4>
                  <a href="#" onClick={(e) => e.preventDefault()}>
                    {q.title}
                  </a>
                </h4>
                <p className="forum-question-snippet">{q.body}</p>
                <div className="forum-question-footer">
                  {q.tags.map((tag) => (
                    <span key={tag} className="forum-tag">{tag}</span>
                  ))}
                  {q.isResolved && (
                    <span className="forum-resolved-badge">✓ Resolved</span>
                  )}
                  <span className="forum-question-author">
                    {q.user.name} · {formatRelativeTime(q.createdAt)}
                  </span>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {pagination.totalPages > 1 && (
        <nav className="forum-pagination" aria-label="Discussion pages">
          <button
            disabled={!pagination.hasPreviousPage}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            ← Previous
          </button>
          <span>
            Page {pagination.page} of {pagination.totalPages}
          </span>
          <button
            disabled={!pagination.hasNextPage}
            onClick={() => setPage((p) => p + 1)}
          >
            Next →
          </button>
        </nav>
      )}
    </section>
  );
};

export default CourseForum;
