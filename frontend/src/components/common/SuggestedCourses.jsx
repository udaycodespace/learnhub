import React, { useCallback, useEffect, useState } from "react";
import axiosInstance from "./AxiosInstance";
import { getToken } from "./AxiosInstance";
import "./RecentlyViewed.css";

const formatPrice = (price) => {
  const num = Number(price);
  if (!num || num === 0) return "Free";
  return `₹${num}`;
};

const SuggestedCourses = () => {
  const token = getToken();
  const [courses, setCourses] = useState([]);
  const [basedOn, setBasedOn] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!token) { setLoading(false); return; }
    setLoading(true);
    try {
      const res = await axiosInstance.get("/api/suggested-courses?limit=6");
      setCourses(res.data.data || []);
      setBasedOn(res.data.basedOn || null);
    } catch { /* silently fail */ }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  if (!token || loading || courses.length === 0) return null;

  return (
    <section className="recently-viewed" aria-labelledby="suggested-title">
      <h3 id="suggested-title">
        {basedOn
          ? `More in ${basedOn.slice(0, 2).join(" & ")}`
          : "You might also like"}
      </h3>
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
            <p className="rv-viewed">{c.enrolled || 0} enrolled</p>
          </a>
        ))}
      </div>
    </section>
  );
};

export default SuggestedCourses;
