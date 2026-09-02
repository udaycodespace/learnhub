import React, { useCallback, useEffect, useState } from "react";
import axiosInstance from "./AxiosInstance";
import { getToken } from "./AxiosInstance";
import "./RecentlyViewed.css";

const formatRelativeTime = (value) => {
  const diff = Date.now() - new Date(value).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
};

const formatPrice = (price) => {
  const num = Number(price);
  if (!num || num === 0) return "Free";
  return `₹${num}`;
};

const RecentlyViewed = () => {
  const token = getToken();
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!token) { setLoading(false); return; }
    setLoading(true);
    try {
      const res = await axiosInstance.get("/api/recently-viewed?limit=10");
      setCourses(res.data.data || []);
    } catch { /* silently fail */ }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const handleClear = async () => {
    if (!window.confirm("Clear your recently viewed list?")) return;
    try {
      await axiosInstance.delete("/api/recently-viewed");
      setCourses([]);
    } catch { /* ignore */ }
  };

  if (!token || loading || courses.length === 0) return null;

  return (
    <section className="recently-viewed" aria-labelledby="recently-viewed-title">
      <h3 id="recently-viewed-title">Recently Viewed</h3>
      <button className="recently-viewed-clear" onClick={handleClear}>Clear</button>
      <div className="recently-viewed-list" role="list">
        {courses.map((c) => (
          <a
            key={c.id}
            className="recently-viewed-card"
            href={`/courseSection/${c.id}/${encodeURIComponent(c.title)}`}
            role="listitem"
          >
            <h4>{c.title}</h4>
            <p className="rv-meta">{c.educator} · {c.category}</p>
            <span className="rv-price">{formatPrice(c.price)}</span>
            <p className="rv-viewed">Viewed {formatRelativeTime(c.viewedAt)}</p>
          </a>
        ))}
      </div>
    </section>
  );
};

export default RecentlyViewed;
