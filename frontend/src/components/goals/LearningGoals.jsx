import React, { useCallback, useEffect, useState } from "react";
import axiosInstance from "../common/AxiosInstance";
import "./LearningGoals.css";

const formatMinutes = (m) => {
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
};

const LearningGoals = () => {
  const [goal, setGoal] = useState(null);
  const [stats, setStats] = useState({ weekMinutes: 0, weekSessions: 0, dailyBreakdown: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [target, setTarget] = useState("120");
  const [duration, setDuration] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [goalRes, statsRes] = await Promise.all([
        axiosInstance.get("/api/goals"),
        axiosInstance.get("/api/goals/stats"),
      ]);
      setGoal(goalRes.data.data);
      setStats(statsRes.data.data);
    } catch {
      setError("Could not load learning goals.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSetGoal = async (e) => {
    e.preventDefault();
    const mins = Number(target);
    if (!mins || mins < 15 || mins > 2100) {
      setError("Target must be between 15 and 2100 minutes."); return;
    }
    setSaving(true); setError(""); setNotice("");
    try {
      await axiosInstance.post("/api/goals", { weeklyMinutesTarget: mins });
      setNotice("Goal updated.");
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "Could not save goal.");
    } finally { setSaving(false); }
  };

  const handleLogSession = async (e) => {
    e.preventDefault();
    const mins = Number(duration);
    if (!mins || mins < 1 || mins > 480) {
      setError("Duration must be 1–480 minutes."); return;
    }
    setSaving(true); setError(""); setNotice("");
    try {
      await axiosInstance.post("/api/goals/log", { durationMinutes: mins, note: note.trim() });
      setDuration(""); setNote("");
      setNotice("Session logged!");
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "Could not log session.");
    } finally { setSaving(false); }
  };

  const handleDeactivate = async () => {
    if (!window.confirm("Deactivate your current goal?")) return;
    setError(""); setNotice("");
    try {
      await axiosInstance.delete("/api/goals");
      setNotice("Goal deactivated.");
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "Could not deactivate goal.");
    }
  };

  if (loading) return <section className="learning-goals"><p>Loading…</p></section>;

  const progress = goal ? Math.min(100, Math.round((stats.weekMinutes / goal.weeklyMinutesTarget) * 100)) : 0;
  const maxDaily = Math.max(1, ...stats.dailyBreakdown.map(d => d.minutes));
  const recentSessions = (goal?.sessions || []).slice(-8).reverse();

  return (
    <section className="learning-goals" aria-labelledby="goals-title">
      <header className="learning-goals-header">
        <h2 id="goals-title">Learning Goals</h2>
        <p>Set a weekly target, log study sessions, and track your streak.</p>
      </header>

      {error && <div className="goals-error" role="alert">{error}</div>}
      {notice && <div className="goals-notice" role="status">{notice}</div>}

      {!goal ? (
        <div className="goals-empty">
          <h3>Set your first goal</h3>
          <p>How many minutes do you want to study per week?</p>
          <form className="goals-set-form" onSubmit={handleSetGoal}>
            <input type="number" min="15" max="2100" value={target} onChange={e => setTarget(e.target.value)} placeholder="e.g. 120" />
            <button type="submit" className="goals-btn goals-btn-primary" disabled={saving}>
              {saving ? "Saving…" : "Set goal"}
            </button>
          </form>
        </div>
      ) : (
        <>
          <div className="goals-stats">
            <div className="goals-stat-card goals-stat-progress">
              <strong>{formatMinutes(stats.weekMinutes)}</strong>
              <span>of {formatMinutes(goal.weeklyMinutesTarget)} this week ({progress}%)</span>
            </div>
            <div className="goals-stat-card goals-stat-streak">
              <strong>{goal.streakDays}🔥</strong>
              <span>day streak</span>
            </div>
            <div className="goals-stat-card">
              <strong>{stats.weekSessions}</strong>
              <span>sessions this week</span>
            </div>
          </div>

          <div className="goals-daily">
            <h3>This week</h3>
            <div className="goals-daily-bars">
              {stats.dailyBreakdown.map(d => (
                <div key={d.day} className="goals-daily-bar">
                  <strong>{d.minutes ? formatMinutes(d.minutes) : ""}</strong>
                  <div className="goals-daily-bar-fill" style={{ height: `${(d.minutes / maxDaily) * 90}px` }} />
                  <span>{d.day}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="goals-log-form">
            <h3>Log a study session</h3>
            <form className="goals-log-row" onSubmit={handleLogSession}>
              <label>
                Minutes
                <input type="number" min="1" max="480" value={duration} onChange={e => setDuration(e.target.value)} placeholder="30" style={{ width: 80 }} />
              </label>
              <label>
                Note (optional)
                <textarea value={note} onChange={e => setNote(e.target.value.slice(0, 200))} placeholder="What did you study?" />
              </label>
              <button type="submit" className="goals-btn goals-btn-primary" disabled={saving}>
                {saving ? "Logging…" : "Log"}
              </button>
            </form>
          </div>

          {recentSessions.length > 0 && (
            <div className="goals-sessions">
              <h3>Recent sessions</h3>
              {recentSessions.map((s, i) => (
                <div key={i} className="goals-session-item">
                  <span>{formatMinutes(s.durationMinutes)} — {new Date(s.date).toLocaleDateString()}</span>
                  {s.note && <span className="note">{s.note}</span>}
                </div>
              ))}
            </div>
          )}

          <div className="goals-actions">
            <form onSubmit={handleSetGoal} style={{ display: "flex", gap: "0.5rem", alignItems: "flex-end" }}>
              <label style={{ fontSize: "0.8rem", fontWeight: 600 }}>
                New weekly target (min)
                <input type="number" min="15" max="2100" value={target} onChange={e => setTarget(e.target.value)} style={{ width: 90, padding: "0.4rem 0.5rem", border: "1px solid #d1d5db", borderRadius: 6, fontSize: "0.85rem", marginLeft: 6 }} />
              </label>
              <button type="submit" className="goals-btn goals-btn-ghost" disabled={saving}>Update target</button>
            </form>
            <button className="goals-btn goals-btn-danger" onClick={handleDeactivate}>Deactivate goal</button>
          </div>
        </>
      )}
    </section>
  );
};

export default LearningGoals;
